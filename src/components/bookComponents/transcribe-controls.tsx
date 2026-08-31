import { deleteBookTranscript } from "@/data/sqlite/shadow-db-transcripts";
import { exportTranscriptEpub, TranscriptEpubExportError } from "@/sharing/transcript-epub-export";
import { selectIsBookFullyDownloaded, useDeviceBooksStore } from "@/store/device-books-store";
import {
  useActiveTranscriptionTask,
  useBookTranscriptionStatus,
  useTranscriptionActions,
} from "@/store/transcription-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  BookTranscriptionError,
  cancelActiveTranscription,
  getBookTranscriptUiStatus,
  resumeIfNeeded,
  seedResumableTranscriptStatus,
  startBookTranscription,
  type BookTranscriptUiStatus,
} from "@/transcription/book-transcription";
import {
  describeTranscriptionUnavailable,
  useTranscriptionAvailability,
} from "@/transcription/use-transcription-availability";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { toast } from "react-native-sonner";

/**
 * The Book Transcript card on the download sheet, sitting next to
 * `DownloadControls` and matching its card style (plan Phase 4 item 1).
 *
 * Only ever shown for a downloaded book — a Book Transcript is produced from the
 * downloaded audio files and dies with them (CONTEXT.md lifetime rule).
 */

/**
 * What to tell the user about a failed Book Transcript.
 *
 * `recognition_failed` is both the native recognizer's own error and the
 * catch-all `toErrorCode` fallback, so it cannot be narrowed further here. On a
 * real device it has meant the audio input failed mid-file — SpeechAnalyzer
 * reports `Input loop ending with error` while recognition itself is healthy —
 * which points at the audio rather than at the transcriber. Hence the hedge:
 * name the likely cause without asserting it.
 */
const describeTranscriptionFailure = (errorCode: string | null) => {
  if (errorCode === "recognition_failed") {
    return "Transcription failed. One of this book's audio files may be damaged or in a format this device cannot read — other books should still transcribe normally.";
  }
  if (errorCode === "transcript_write_failed") {
    return "Transcription failed while saving to this device. Check that there is free space and try again.";
  }
  if (errorCode === "missing_file") {
    return "Transcription failed because an audio file is missing. Re-download the book and try again.";
  }
  return "Transcription failed.";
};

export const showTranscriptionBusyAlert = () => {
  Alert.alert(
    "Transcription in progress",
    "Only one book can be transcribed at a time. Wait for the current transcription to finish.",
  );
};

type Props = {
  libraryItemId?: string;
};

const CardButton = ({
  label,
  onPress,
  disabled = false,
  tone = "secondary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "destructive";
}) => {
  const themeColors = useThemeColors();
  const isPrimary = tone === "primary";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: isPrimary ? 0 : 1,
        borderColor: themeColors.border,
        paddingVertical: isPrimary ? 10 : 8,
        backgroundColor: isPrimary ? themeColors.accent : themeColors.bg,
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          textAlign: "center",
          fontSize: 13,
          fontWeight: "600",
          color: isPrimary
            ? themeColors.accentForeground
            : tone === "destructive"
              ? "#c2410c"
              : themeColors.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const TranscribeControls = ({ libraryItemId }: Props) => {
  const themeColors = useThemeColors();
  const availability = useTranscriptionAvailability();
  const { clearStatus } = useTranscriptionActions();
  const activeTask = useActiveTranscriptionTask();
  const storeStatus = useBookTranscriptionStatus(libraryItemId);
  const isDownloaded = useDeviceBooksStore((state) =>
    libraryItemId ? selectIsBookFullyDownloaded(state, libraryItemId) : false,
  );
  const [uiStatus, setUiStatus] = useState<BookTranscriptUiStatus | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!libraryItemId) return;
    const next = await getBookTranscriptUiStatus(libraryItemId).catch(() => null);
    setUiStatus(next);
  }, [libraryItemId]);

  // Hydrate the runtime mirror from SQLite: a book killed mid-transcription must
  // come back as "resumable" even though the store starts empty on cold launch.
  useEffect(() => {
    if (!libraryItemId) return;
    void seedResumableTranscriptStatus().catch(() => null);
  }, [libraryItemId]);

  // Read SQLite on mount and whenever the runtime status flips (start / cancel /
  // finish) — SQLite is the durable record, the store only mirrors it.
  useEffect(() => {
    if (!libraryItemId) return;
    let isCancelled = false;
    void getBookTranscriptUiStatus(libraryItemId)
      .catch(() => null)
      .then((next) => {
        if (!isCancelled) setUiStatus(next);
      });
    return () => {
      isCancelled = true;
    };
  }, [libraryItemId, storeStatus]);

  const isActiveBook = activeTask?.libraryItemId === libraryItemId;
  const isOtherBookActive = Boolean(activeTask) && !isActiveBook;

  const handleStartPress = () => {
    if (!libraryItemId) return;
    if (isOtherBookActive) {
      showTranscriptionBusyAlert();
      return;
    }
    router.push({ pathname: "/book-transcribe", params: { libraryItemId } });
  };

  const handleResume = () => {
    if (!libraryItemId) return;
    if (isOtherBookActive) {
      showTranscriptionBusyAlert();
      return;
    }
    void resumeIfNeeded(libraryItemId).catch((error: unknown) => {
      if (error instanceof BookTranscriptionError && error.code === "already_active") {
        showTranscriptionBusyAlert();
        return;
      }
      toast.error("Transcription could not start", {
        description: error instanceof Error ? error.message : undefined,
      });
    });
  };

  const handleRetry = () => {
    if (!libraryItemId) return;
    if (isOtherBookActive) {
      showTranscriptionBusyAlert();
      return;
    }
    void startBookTranscription(libraryItemId, {
      localeIdentifier: uiStatus?.localeIdentifier ?? undefined,
    }).catch((error: unknown) => {
      if (error instanceof BookTranscriptionError && error.code === "already_active") {
        showTranscriptionBusyAlert();
        return;
      }
      toast.error("Transcription could not start", {
        description: error instanceof Error ? error.message : undefined,
      });
    });
  };

  const handleCancel = () => {
    if (!libraryItemId) return;
    void cancelActiveTranscription(libraryItemId);
  };

  const handleExport = () => {
    if (!libraryItemId || isExporting) return;
    setIsExporting(true);
    void exportTranscriptEpub({ libraryItemId })
      .catch((error: unknown) => {
        toast.error("Export failed", {
          description:
            error instanceof TranscriptEpubExportError
              ? error.message
              : error instanceof Error
                ? error.message
                : undefined,
        });
      })
      .finally(() => setIsExporting(false));
  };

  const handleDeleteTranscript = () => {
    if (!libraryItemId) return;
    Alert.alert(
      "Delete transcript?",
      "The transcript for this book will be removed. The download itself is kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await deleteBookTranscript(libraryItemId).catch(() => undefined);
              clearStatus(libraryItemId);
              await refreshStatus();
            })();
          },
        },
      ],
    );
  };

  if (Platform.OS !== "ios") return null;
  if (!libraryItemId || !isDownloaded) return null;
  if (!availability) return null;

  const status = isActiveBook ? "active" : (uiStatus?.status ?? storeStatus);
  // Availability can flip false AFTER a transcript exists (Apple Intelligence
  // turned off, the speech model evicted). Existing transcript state must keep
  // its actions — a complete transcript would otherwise lose Export EPUB and
  // Delete Transcript with no way back — so the unavailable message only
  // replaces the card when there is no state worth showing.
  const hasTranscriptState =
    status === "complete" ||
    status === "resumable" ||
    status === "failed" ||
    (status === "active" && Boolean(activeTask));
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

  return (
    <View
      style={{
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        padding: 16,
        gap: 10,
        boxShadow: "0 10px 22px rgba(15, 23, 42, 0.1)",
      }}
    >
      <Text selectable style={{ fontSize: 16, fontWeight: "600", color: themeColors.text }}>
        Transcript
      </Text>

      {!availability.available && !hasTranscriptState ? (
        <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
          {describeTranscriptionUnavailable(availability)}
        </Text>
      ) : status === "active" && activeTask ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <Text
              selectable
              numberOfLines={2}
              style={{ flex: 1, fontSize: 15, fontWeight: "700", color: themeColors.text }}
            >
              {activeTask.phase === "preparing_model"
                ? "Preparing speech model..."
                : `Transcribing file ${Math.min(activeTask.completedTracks + 1, Math.max(activeTask.totalTracks, 1))}/${Math.max(activeTask.totalTracks, 1)}`}
            </Text>
            <Text
              selectable
              style={{ fontSize: 16, fontWeight: "800", color: themeColors.text }}
            >
              {`${progressPercent}%`}
            </Text>
          </View>
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
                width: `${progressPercent}%`,
              }}
            />
          </View>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            Keeps going with the screen off while you are listening. If you stop playback, leave
            the app open to continue.
          </Text>
          <CardButton label="Cancel Transcription" onPress={handleCancel} />
        </View>
      ) : status === "complete" ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            Transcript ready. The text is machine-generated and will contain errors.
          </Text>
          <CardButton
            label={isExporting ? "Preparing EPUB..." : "Export EPUB"}
            onPress={handleExport}
            disabled={isExporting}
            tone="primary"
          />
          <CardButton
            label="Delete Transcript"
            onPress={handleDeleteTranscript}
            tone="destructive"
          />
        </View>
      ) : status === "resumable" ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            Transcription was interrupted. It picks up from where it left off.
          </Text>
          <CardButton label="Resume Transcription" onPress={handleResume} tone="primary" />
        </View>
      ) : status === "failed" ? (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            {`${describeTranscriptionFailure(uiStatus?.errorCode ?? null)}${
              uiStatus?.errorCode ? ` (${uiStatus.errorCode})` : ""
            }`}
          </Text>
          <CardButton label="Retry Transcription" onPress={handleRetry} tone="primary" />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            {isOtherBookActive
              ? "Another book is being transcribed."
              : "Create a text transcript of this book on this device."}
          </Text>
          <CardButton label="Transcribe This Book" onPress={handleStartPress} tone="primary" />
        </View>
      )}
    </View>
  );
};

export default TranscribeControls;
