/**
 * Fetch a shipped `laabs.transcript.json` from the Audiobookshelf item folder
 * and persist it as a Book Transcript.
 */

import { downloadsApi } from "@/api/downloads-api";
import { findTranscriptLibraryFile } from "@/components/bookComponents/transcript-files";
import {
  getBookTranscriptStatus,
  replaceWithIngestedTranscript,
} from "@/data/sqlite/shadow-db-transcripts";
import type { AudioFile, LibraryFile } from "@/types/absTypes";
import { parseTranscriptArtifact } from "./transcript-artifact";
import {
  decideTranscriptIngest,
  planTranscriptIngest,
  type LibraryTrackRef,
} from "./transcript-ingest-plan";

export type TranscriptIngestOutcome =
  | "absent"
  | "skipped"
  | "deferred"
  | "ingested"
  | "failed";

export type TranscriptIngestResult = {
  outcome: TranscriptIngestOutcome;
  didRecomputeBookTime?: boolean;
  error?: Error;
};

const secondsToMs = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value * 1000)) : 0;

export const libraryTracksFromAudioFiles = (
  audioFiles: AudioFile[] | null | undefined,
): LibraryTrackRef[] =>
  (audioFiles ?? [])
    .filter((file) => Boolean(file?.ino) && Boolean(file.metadata?.filename))
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((file) => ({
      filename: file.metadata.filename,
      ino: file.ino,
      durationMs: secondsToMs(file.duration),
    }));

const TRANSCRIPT_DOWNLOAD_TIMEOUT_MS = 120_000;

export const fetchItemFile = async (itemId: string, fileIno: string): Promise<unknown> => {
  const spec = await downloadsApi.getDownloadSpec(itemId, fileIno);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPT_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(spec.urlWithToken, {
      headers: spec.authHeader,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Transcript download failed (${response.status})`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Transcript file is not valid JSON");
    }
  } finally {
    clearTimeout(timeoutId);
  }
};

type IngestDependencies = {
  fetchFile?: (itemId: string, fileIno: string) => Promise<unknown>;
  readExisting?: typeof getBookTranscriptStatus;
  write?: typeof replaceWithIngestedTranscript;
};

/**
 * Discover, fetch, and persist a shipped Book Transcript when the item folder
 * has one. Skips a second download when an ingested complete row already exists.
 */
export const ingestShippedTranscriptIfNeeded = async ({
  libraryItemId,
  libraryFiles,
  audioFiles,
  fetchFile = fetchItemFile,
  readExisting = getBookTranscriptStatus,
  write = replaceWithIngestedTranscript,
}: {
  libraryItemId: string;
  libraryFiles?: LibraryFile[] | null;
  audioFiles?: AudioFile[] | null;
} & IngestDependencies): Promise<TranscriptIngestResult> => {
  const transcriptFile = findTranscriptLibraryFile({ libraryFiles });
  if (!transcriptFile) return { outcome: "absent" };

  const existing = await readExisting(libraryItemId);
  if (existing?.status === "in_progress") return { outcome: "deferred" };
  if (existing?.origin === "ingested" && existing.status === "complete") {
    return { outcome: "skipped" };
  }

  try {
    const raw = await fetchFile(libraryItemId, transcriptFile.ino);
    const artifact = parseTranscriptArtifact(raw);
    const decision = decideTranscriptIngest(
      existing
        ? { status: existing.status, transcriptId: existing.transcriptId }
        : null,
      artifact.transcriptId,
    );
    if (decision.action === "skip") return { outcome: "skipped" };
    if (decision.action === "defer") return { outcome: "deferred" };

    const plan = planTranscriptIngest({
      artifact,
      libraryItemId,
      libraryTracks: libraryTracksFromAudioFiles(audioFiles),
    });

    await write({
      libraryItemId,
      transcriptId: plan.transcriptId,
      tracksFingerprint: plan.tracksFingerprint,
      localeIdentifier: plan.localeIdentifier,
      sourceStructure: plan.sourceStructure,
      sections: plan.sections,
      bookTitle: plan.bookTitle,
      bookAuthor: plan.bookAuthor,
      asrJson: JSON.stringify(plan.asr),
      tracks: plan.tracks,
      segments: plan.segments,
    });

    return { outcome: "ingested", didRecomputeBookTime: plan.didRecomputeBookTime };
  } catch (error) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[BookTranscript] ingest failed book=${libraryItemId} message=${resolved.message}`,
    );
    return {
      outcome: "failed",
      error: resolved,
    };
  }
};
