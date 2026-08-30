import {
  selectActiveTranscriptionFraction,
  useTranscriptionStore,
  type BookTranscriptionRuntimeStatus,
} from "@/store/transcription-store";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * The block that stands in for a section above the transcription frontier
 * (`docs/read-along-implementation-plan.md` Phase 3.2).
 *
 * It subscribes to the transcription runtime store **itself** rather than
 * taking progress as a prop: the active task's fraction updates many times a
 * second, and routing that through the screen would re-render the whole list on
 * every progress callback. Only the handful of pending blocks FlashList has
 * mounted pay for it here.
 */

export type ReadAlongPendingPalette = {
  text: string;
  textMuted: string;
  border: string;
  surface: string;
  accent: string;
  accentForeground: string;
};

type ReadAlongPendingBlockProps = {
  boundLibraryItemId: string;
  /** Persisted transcript status for the bound book. */
  transcriptStatus: BookTranscriptionRuntimeStatus;
  /**
   * True for the earliest pending section — the one a running transcription is
   * working on now. Later ones are queued behind it.
   */
  isFirstPending: boolean;
  palette: ReadAlongPendingPalette;
  onResume: () => void;
  onRetry: () => void;
};

const ActionButton = ({
  label,
  onPress,
  palette,
}: {
  label: string;
  onPress: () => void;
  palette: ReadAlongPendingPalette;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => ({
      alignSelf: "flex-start",
      borderRadius: 999,
      borderCurve: "continuous",
      backgroundColor: palette.accent,
      paddingVertical: 8,
      paddingHorizontal: 14,
      opacity: pressed ? 0.8 : 1,
    })}
  >
    <Text style={{ fontSize: 13, fontWeight: "600", color: palette.accentForeground }}>
      {label}
    </Text>
  </Pressable>
);

const ReadAlongPendingBlockBase = ({
  boundLibraryItemId,
  transcriptStatus,
  isFirstPending,
  palette,
  onResume,
  onRetry,
}: ReadAlongPendingBlockProps) => {
  const isThisBookActive = useTranscriptionStore(
    (state) => state.activeTask?.libraryItemId === boundLibraryItemId,
  );
  const isPreparingModel = useTranscriptionStore(
    (state) => state.activeTask?.phase === "preparing_model",
  );
  const fraction = useTranscriptionStore(selectActiveTranscriptionFraction);
  const percent = Math.round(fraction * 100);

  const { headline, detail } = (() => {
    if (isThisBookActive) {
      if (!isFirstPending) {
        return { headline: "Waiting for earlier chapters...", detail: null };
      }
      if (isPreparingModel) {
        return { headline: "Preparing speech model...", detail: null };
      }
      return { headline: "Transcribing this chapter...", detail: `${percent}% of the book` };
    }
    if (transcriptStatus === "failed") {
      return { headline: "Transcription stopped", detail: "Something went wrong partway through." };
    }
    if (transcriptStatus === "resumable") {
      return {
        headline: "Not transcribed yet",
        detail: "Transcription runs only while the app is open.",
      };
    }
    return { headline: "Not transcribed yet", detail: null };
  })();

  const showResume = !isThisBookActive && transcriptStatus === "resumable" && isFirstPending;
  const showRetry = !isThisBookActive && transcriptStatus === "failed" && isFirstPending;

  return (
    <View
      style={{
        marginVertical: 8,
        marginHorizontal: 10,
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        padding: 14,
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.text }}>{headline}</Text>
      {detail ? (
        <Text style={{ fontSize: 12, color: palette.textMuted }}>{detail}</Text>
      ) : null}
      {isThisBookActive && isFirstPending ? (
        <View
          style={{
            height: 6,
            width: "100%",
            borderRadius: 999,
            backgroundColor: palette.border,
          }}
        >
          <View
            style={{
              height: 6,
              borderRadius: 999,
              backgroundColor: palette.accent,
              width: `${percent}%`,
            }}
          />
        </View>
      ) : null}
      {showResume ? (
        <ActionButton label="Resume transcription" onPress={onResume} palette={palette} />
      ) : null}
      {showRetry ? <ActionButton label="Retry" onPress={onRetry} palette={palette} /> : null}
    </View>
  );
};

export const ReadAlongPendingBlock = memo(ReadAlongPendingBlockBase);
