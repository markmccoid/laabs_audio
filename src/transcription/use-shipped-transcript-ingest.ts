import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { findTranscriptLibraryFile } from "@/components/bookComponents/transcript-files";
import { useEffect, useRef, useState } from "react";
import {
  ingestShippedTranscriptIfNeeded,
  type TranscriptIngestOutcome,
} from "./transcript-ingest";

export type ShippedTranscriptIngestPhase = "pending" | "ingesting" | "done";

export type ShippedTranscriptIngestState = {
  phase: ShippedTranscriptIngestPhase;
  outcome: TranscriptIngestOutcome | null;
  errorMessage: string | null;
};

/**
 * When item details include `laabs.transcript.json`, ingest it into SQLite.
 * Safe to call from book detail and Read-Along — a second pass is a no-op
 * once an ingested complete row exists.
 */
export const useShippedTranscriptIngest = (
  libraryItemId: string | null | undefined,
): ShippedTranscriptIngestState => {
  const { data } = useGetItemDetails(libraryItemId ?? undefined);
  const detailsRef = useRef(data);
  detailsRef.current = data;
  const transcriptIno = findTranscriptLibraryFile(data)?.ino ?? null;
  const detailsReady = Boolean(data);
  const [state, setState] = useState<ShippedTranscriptIngestState>({
    phase: "pending",
    outcome: null,
    errorMessage: null,
  });

  useEffect(() => {
    if (!libraryItemId) {
      setState({ phase: "done", outcome: "absent", errorMessage: null });
      return;
    }
    if (!detailsReady) return;

    const details = detailsRef.current;
    if (!transcriptIno || !details) {
      setState({ phase: "done", outcome: "absent", errorMessage: null });
      return;
    }

    let cancelled = false;
    setState({ phase: "ingesting", outcome: null, errorMessage: null });
    void ingestShippedTranscriptIfNeeded({
      libraryItemId,
      libraryFiles: details.libraryFiles,
      audioFiles: details.audioFiles ?? details.media?.audioFiles,
    }).then((result) => {
      if (cancelled) return;
      setState({
        phase: "done",
        outcome: result.outcome,
        errorMessage: result.error?.message ?? null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [libraryItemId, transcriptIno, detailsReady]);

  return state;
};
