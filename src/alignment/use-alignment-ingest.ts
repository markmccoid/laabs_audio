import { hasAlignmentLibraryFile } from "@/components/bookComponents/alignment-files";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { useEffect, useRef, useState } from "react";
import {
  ingestAlignmentMapIfNeeded,
  type AlignmentIngestOutcome,
} from "./alignment-ingest";
import type { AlignmentPairingCheck } from "./alignment-ingest-plan";

export type AlignmentIngestPhase = "idle" | "pending" | "ingesting" | "done";

export type AlignmentIngestState = {
  phase: AlignmentIngestPhase;
  outcome: AlignmentIngestOutcome | null;
  pairing: AlignmentPairingCheck | null;
  errorMessage: string | null;
};

const IDLE: AlignmentIngestState = {
  phase: "idle",
  outcome: null,
  pairing: null,
  errorMessage: null,
};

/**
 * Ingest a book's Alignment Map, on demand.
 *
 * Unlike `useShippedTranscriptIngest`, this does **not** fire from book detail.
 * A transcript is eager because clip text consumes it without anyone opening
 * Read-Along; nothing outside EPUB Read-Along consumes a map, and pulling ~1.4 MB
 * on every book-detail mount for a surface most opens never reach is not worth
 * matching the transcript's eagerness (ADR-0039).
 *
 * So `enabled` is the caller's way of saying "the reader is actually open".
 * While it is false the hook stays `idle` and issues no request — but item
 * details are still read, because `hasAlignmentLibraryFile` is free and is what
 * decides whether the entry point appears at all.
 */
export const useAlignmentIngest = (
  libraryItemId: string | null | undefined,
  { enabled }: { enabled: boolean },
): AlignmentIngestState & { hasMapOnServer: boolean } => {
  const { data } = useGetItemDetails(libraryItemId ?? undefined);
  const detailsRef = useRef(data);
  detailsRef.current = data;

  const hasMapOnServer = hasAlignmentLibraryFile(data);
  const detailsReady = Boolean(data);
  const [state, setState] = useState<AlignmentIngestState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    if (!libraryItemId) {
      setState({ ...IDLE, phase: "done", outcome: "absent" });
      return;
    }
    if (!detailsReady) {
      setState({ ...IDLE, phase: "pending" });
      return;
    }

    const details = detailsRef.current;
    if (!hasMapOnServer || !details) {
      setState({ ...IDLE, phase: "done", outcome: "absent" });
      return;
    }

    let cancelled = false;
    setState({ ...IDLE, phase: "ingesting" });
    void ingestAlignmentMapIfNeeded({
      libraryItemId,
      libraryFiles: details.libraryFiles,
      audioFiles: details.audioFiles ?? details.media?.audioFiles,
      media: details.media,
    })
      .then((result) => {
        if (cancelled) return;
        setState({
          phase: "done",
          outcome: result.outcome,
          pairing: result.pairing ?? null,
          errorMessage: result.error?.message ?? null,
        });
      })
      .catch((error: unknown) => {
        // `ingestAlignmentMapIfNeeded` is meant to resolve with `failed` rather
        // than reject, so reaching here is a bug in it — but an unhandled
        // rejection left this hook in `ingesting` forever, which the surface
        // renders as a bare spinner with no error and nothing in the log. A
        // stuck spinner must never be the way a failure presents.
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[AlignmentMap] ingest threw book=${libraryItemId} ${message}`);
        setState({ phase: "done", outcome: "failed", pairing: null, errorMessage: message });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, libraryItemId, detailsReady, hasMapOnServer]);

  return { ...state, hasMapOnServer };
};
