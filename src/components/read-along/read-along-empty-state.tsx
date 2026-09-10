import { showTranscriptionBusyAlert } from "@/components/bookComponents/transcribe-controls";
import { selectIsBookFullyDownloaded, useDeviceBooksStore } from "@/store/device-books-store";
import {
  useActiveTranscriptionTask,
  type BookTranscriptionRuntimeStatus,
} from "@/store/transcription-store";
import type { ThemeColors } from "@/theme/use-app-theme";
import type { TranscriptIngestOutcome } from "@/transcription/transcript-ingest";
import {
  describeTranscriptionUnavailable,
  useTranscriptionAvailability,
} from "@/transcription/use-transcription-availability";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

/**
 * What the Read-Along route shows when there is nothing to read yet
 * (`docs/read-along-implementation-plan.md` Phase 4.2).
 *
 * The player's Read Along button is always enabled — the route, not the button,
 * decides what a book without a readable transcript gets. That is this
 * component: the pitch plus a Generate Transcript action when transcription can
 * run here, the reason it cannot when it cannot, and live progress / Resume /
 * Retry while a transcription for this book is in flight or stalled.
 *
 * It never decides when to hand over to the reader. The screen re-queries as the
 * transcription frontier advances; the moment the first section becomes readable
 * the list model gains items and the reader replaces this view.
 *
 * Progress presentation mirrors `transcribe-controls.tsx` (the transcript card on
 * the download sheet) so the two surfaces read the same. The few lines of
 * percentage arithmetic are duplicated rather than shared: the card's version is
 * entangled with its own status/`activeTask` locals, and lifting it out would
 * churn a shipped surface for four lines.
 */

type ReadAlongEmptyStateProps = {
  /** The bound book, or `null` when the route was opened without one. */
  libraryItemId: string | null;
  /** Persisted transcript status for the bound book. */
  status: BookTranscriptionRuntimeStatus;
  errorCode?: string | null;
  themeColors: ThemeColors;
  ingestOutcome?: TranscriptIngestOutcome | null;
  ingestErrorMessage?: string | null;
  onResume: () => void;
  onRetry: () => void;
};

/** One shape for every state so the layout below stays a single pass. */
type EmptyStateBody = {
  headline: string;
  detail?: string;
  showProgress?: boolean;
  footnote?: string;
  action?: { label: string; onPress: () => void };
};

const PITCH_COPY =
  "Read along with the text as it plays. LAABS can transcribe this audiobook on your device.";

const StateButton = ({
  label,
  onPress,
  themeColors,
}: {
  label: string;
  onPress: () => void;
  themeColors: ThemeColors;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => ({
      borderRadius: 999,
      borderCurve: "continuous",
      backgroundColor: themeColors.accent,
      paddingVertical: 10,
      paddingHorizontal: 20,
      opacity: pressed ? 0.85 : 1,
    })}
  >
    <Text style={{ fontSize: 14, fontWeight: "600", color: themeColors.accentForeground }}>
      {label}
    </Text>
  </Pressable>
);

const ProgressBar = ({ percent, themeColors }: { percent: number; themeColors: ThemeColors }) => (
  <View
    style={{
      height: 6,
      width: "100%",
      borderRadius: 999,
      backgroundColor: themeColors.border,
    }}
  >
    <View
      style={{
        height: 6,
        borderRadius: 999,
        backgroundColor: themeColors.accent,
        width: `${percent}%`,
      }}
    />
  </View>
);

export const ReadAlongEmptyState = ({
  libraryItemId,
  status,
  errorCode,
  ingestOutcome,
  ingestErrorMessage,
  themeColors,
  onResume,
  onRetry,
}: ReadAlongEmptyStateProps) => {
  const availability = useTranscriptionAvailability();
  const activeTask = useActiveTranscriptionTask();
  const isDownloaded = useDeviceBooksStore((state) =>
    libraryItemId ? selectIsBookFullyDownloaded(state, libraryItemId) : false,
  );

  const isActiveBook = Boolean(libraryItemId) && activeTask?.libraryItemId === libraryItemId;
  const isOtherBookActive = Boolean(activeTask) && !isActiveBook;
  // The runtime task is the truth while it runs: SQLite still says `idle` until
  // the transcript row is written (that happens after the speech model is ready).
  const effectiveStatus: BookTranscriptionRuntimeStatus = isActiveBook ? "active" : status;

  const progressPercent = (() => {
    if (!isActiveBook || !activeTask) return 0;
    if (activeTask.phase === "preparing_model") {
      return Math.round((activeTask.modelDownloadProgress ?? 0) * 100);
    }
    if (activeTask.totalTracks <= 0) return 0;
    const completed = Math.min(activeTask.completedTracks, activeTask.totalTracks);
    return Math.round(
      Math.min(1, (completed + activeTask.currentFileFraction) / activeTask.totalTracks) * 100,
    );
  })();

  const handleGenerate = () => {
    if (!libraryItemId) return;
    if (isOtherBookActive) {
      showTranscriptionBusyAlert();
      return;
    }
    router.push({ pathname: "/book-transcribe", params: { libraryItemId } });
  };

  const body: EmptyStateBody = (() => {
    if (!libraryItemId) {
      return { headline: "No book selected", detail: "Start a book to read along with it." };
    }

    if (effectiveStatus === "active" && activeTask) {
      const fileLabel = `Transcribing file ${Math.min(
        activeTask.completedTracks + 1,
        Math.max(activeTask.totalTracks, 1),
      )}/${Math.max(activeTask.totalTracks, 1)}`;
      return {
        headline: activeTask.phase === "preparing_model" ? "Preparing speech model..." : fileLabel,
        detail: "The first chapter appears here as soon as it is transcribed.",
        showProgress: true,
        footnote: "Transcription runs only while the app is open.",
      };
    }

    if (effectiveStatus === "resumable") {
      return {
        headline: "Transcription was interrupted.",
        detail: "It picks up from the next unfinished file.",
        action: { label: "Resume Transcription", onPress: onResume },
      };
    }

    if (effectiveStatus === "failed") {
      return {
        headline: `Transcription failed${errorCode ? ` (${errorCode})` : ""}.`,
        detail: "Nothing was readable before it stopped.",
        action: { label: "Retry Transcription", onPress: onRetry },
      };
    }

    if (effectiveStatus === "complete") {
      // A complete transcript with no readable rows should not happen; say so
      // plainly rather than pitching a transcript the book already has.
      return { headline: "Nothing to read yet", detail: "This transcript has no text in it." };
    }

    if (ingestOutcome === "failed") {
      return {
        headline: "Couldn't load the library transcript",
        detail: ingestErrorMessage
          ? ingestErrorMessage
          : "LAABS found a transcript file for this book but couldn't read it.",
      };
    }

    // `idle` — no transcript for this book. Pitch it, and offer the only action
    // that is actually available here.
    if (availability && !availability.available) {
      return {
        headline: "Read Along",
        detail: PITCH_COPY,
        footnote: describeTranscriptionUnavailable(availability),
      };
    }

    if (!isDownloaded) {
      return {
        headline: "Read Along",
        detail: PITCH_COPY,
        footnote: "Download this book to enable transcription.",
      };
    }

    return {
      headline: "Read Along",
      detail: PITCH_COPY,
      // `availability === null` means the (cached) native check is still in
      // flight. Showing the button is the right bet: it routes to the start
      // sheet, which does its own availability check before anything runs.
      action: { label: "Generate Transcript", onPress: handleGenerate },
    };
  })();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 28,
        paddingBottom: 60,
        gap: 12,
      }}
    >
      <SymbolView name="text.book.closed" size={44} tintColor={themeColors.accent} />
      <Text
        selectable
        style={{
          fontSize: 18,
          fontWeight: "700",
          color: themeColors.text,
          textAlign: "center",
        }}
      >
        {body.headline}
      </Text>
      {body.detail ? (
        <Text
          selectable
          style={{
            fontSize: 14,
            lineHeight: 20,
            color: themeColors.textMuted,
            textAlign: "center",
          }}
        >
          {body.detail}
        </Text>
      ) : null}
      {body.showProgress ? (
        <View style={{ width: "100%", maxWidth: 320, gap: 6 }}>
          <ProgressBar percent={progressPercent} themeColors={themeColors} />
          <Text
            style={{
              fontSize: 13,
              fontWeight: "700",
              color: themeColors.text,
              textAlign: "center",
              fontVariant: ["tabular-nums"],
            }}
          >
            {`${progressPercent}%`}
          </Text>
        </View>
      ) : null}
      {body.action ? (
        <StateButton
          label={body.action.label}
          onPress={body.action.onPress}
          themeColors={themeColors}
        />
      ) : null}
      {body.footnote ? (
        <Text
          selectable
          style={{ fontSize: 12, color: themeColors.textMuted, textAlign: "center" }}
        >
          {body.footnote}
        </Text>
      ) : null}
    </View>
  );
};

export default ReadAlongEmptyState;
