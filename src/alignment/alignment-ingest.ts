/**
 * Fetch a shipped `laabs.<epub stem>.alignment.json` from the Audiobookshelf
 * item folder and persist it as an Alignment Map.
 *
 * Sibling of `transcript-ingest.ts`, with one difference worth naming: a
 * transcript is found by an exact filename, where a map has to be *paired* with
 * an EPUB first (ADR-0038). So the discovery step can succeed and the pairing
 * still fail, and those are different outcomes to the caller.
 */

import { downloadsApi } from "@/api/downloads-api";
import {
  pairAlignmentWithEbook,
  type AlignmentFileSource,
} from "@/components/bookComponents/alignment-files";
import {
  getAlignmentMap,
  replaceAlignmentMap,
  type AlignmentMapRow,
} from "@/data/sqlite/shadow-db-alignment";
import { libraryTracksFromAudioFiles } from "@/transcription/transcript-ingest";
import type { AudioFile, LibraryFile } from "@/types/absTypes";
import { parseAlignmentArtifact } from "./alignment-artifact";
import {
  decideAlignmentIngest,
  planAlignmentIngest,
  type AlignmentPairingCheck,
} from "./alignment-ingest-plan";

export type AlignmentIngestOutcome =
  /** No map listed for this book, or nothing to pair it with. */
  | "absent"
  /** Already stored, same `alignmentId`. */
  | "skipped"
  | "ingested"
  | "failed";

export type AlignmentIngestResult = {
  outcome: AlignmentIngestOutcome;
  didRecomputeBookTime?: boolean;
  /**
   * Present on success. `mismatch` is the Q14 notice — the map may describe a
   * different edition of this EPUB — and is never a reason to withhold the map.
   */
  pairing?: AlignmentPairingCheck;
  error?: Error;
};

/** A map is ~1.4 MB; the same budget the transcript's 6 MB gets. */
const ALIGNMENT_DOWNLOAD_TIMEOUT_MS = 120_000;

export const fetchAlignmentFile = async (itemId: string, fileIno: string): Promise<unknown> => {
  const spec = await downloadsApi.getDownloadSpec(itemId, fileIno);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ALIGNMENT_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(spec.urlWithToken, {
      headers: spec.authHeader,
      signal: controller.signal,
    });
    if (!response.ok) {
      // Seen for real: a rescan can leave `libraryFiles` naming a file that has
      // since been renamed, and the download 404s. The presence check cannot
      // know that, so this is where it surfaces.
      throw new Error(`Alignment download failed (${response.status})`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Alignment file is not valid JSON");
    }
  } finally {
    clearTimeout(timeoutId);
  }
};

type IngestDependencies = {
  fetchFile?: (itemId: string, fileIno: string) => Promise<unknown>;
  readExisting?: (libraryItemId: string) => Promise<AlignmentMapRow | null>;
  write?: typeof replaceAlignmentMap;
};

/**
 * Discover, pair, fetch and persist a shipped Alignment Map.
 *
 * Called on first open of EPUB Read-Along rather than on book detail: unlike a
 * transcript, nothing outside that surface consumes a map, and the presence
 * check that lights up the entry point is free (ADR-0039).
 */
export const ingestAlignmentMapIfNeeded = async ({
  libraryItemId,
  libraryFiles,
  audioFiles,
  media,
  fetchFile = fetchAlignmentFile,
  readExisting = getAlignmentMap,
  write = replaceAlignmentMap,
}: {
  libraryItemId: string;
  libraryFiles?: LibraryFile[] | null;
  audioFiles?: AudioFile[] | null;
  /** `media.ebookFile` breaks the tie when a book has two alignable editions. */
  media?: NonNullable<AlignmentFileSource>["media"];
} & IngestDependencies): Promise<AlignmentIngestResult> => {
  const pairing = pairAlignmentWithEbook({ libraryFiles, media } as AlignmentFileSource);
  if (!pairing) return { outcome: "absent" };

  try {
    // Inside the try, not before it. A SQLite read can throw — a locked database
    // after an unclean exit is the case that bit us — and out here that rejected
    // the promise instead of returning `failed`, which the caller then waited on
    // forever with nothing logged.
    const existing = await readExisting(libraryItemId);

    console.log(
      `[AlignmentMap] ingest start book=${libraryItemId} file=${pairing.file.metadata?.filename ?? pairing.file.ino}`,
    );

    const raw = await fetchFile(libraryItemId, pairing.file.ino);
    const artifact = parseAlignmentArtifact(raw);
    console.log(
      `[AlignmentMap] parsed book=${libraryItemId} units=${artifact.quality.unitCount} resources=${artifact.resources.length}`,
    );

    const decision = decideAlignmentIngest(
      existing
        ? {
            alignmentId: existing.alignmentId,
            epubSha256: existing.epubSha256,
            extractorVersion: existing.extractorVersion,
          }
        : null,
      { alignmentId: artifact.alignmentId },
    );
    if (decision.action === "skip") return { outcome: "skipped" };

    const plan = planAlignmentIngest({
      artifact,
      libraryItemId,
      libraryTracks: libraryTracksFromAudioFiles(audioFiles),
      epubFilename: pairing.ebook.filenameWithExt,
      ebookIno: pairing.ebook.ino,
    });

    console.log(`[AlignmentMap] writing book=${libraryItemId} units=${plan.write.units.length}`);
    await write(plan.write);
    console.log(`[AlignmentMap] wrote book=${libraryItemId}`);

    return {
      outcome: "ingested",
      didRecomputeBookTime: plan.didRecomputeBookTime,
      pairing: plan.pairing,
    };
  } catch (error) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[AlignmentMap] ingest failed book=${libraryItemId} message=${resolved.message}`,
    );
    return { outcome: "failed", error: resolved };
  }
};
