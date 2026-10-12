import {
  commitPendingAudioImport,
  confirmMismatchedReimport,
  discardPendingAudioImport,
  pickAndImportAudio,
  pickAndReimportAudio,
  subscribeToImportCopyStarted,
  type AudioImportResult,
} from "@/imported/imported-audiobook-library";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatImportedDuration } from "./imported-books-segment";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

type ImportProgress = { fileName: string } | null;

const openImportedBook = (id: string) =>
  router.push({ pathname: "/(tabs)/library/[libraryItemId]", params: { libraryItemId: id } });

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : "The file could not be imported.";

/**
 * Drives Audio Import from any surface: shows progress while the chosen file copies (which may
 * include downloading it from iCloud), resolves duplicates with the user, and opens the result.
 */
export const useAudioImportFlow = () => {
  const [progress, setProgress] = useState<ImportProgress>(null);
  const runningRef = useRef(false);

  const run = useCallback(async <T,>(task: () => Promise<T>) => {
    if (runningRef.current) return null;
    runningRef.current = true;
    const unsubscribe = subscribeToImportCopyStarted(({ name }) => setProgress({ fileName: name }));
    try {
      return await task();
    } catch (error) {
      Alert.alert("Import failed", describeError(error));
      return null;
    } finally {
      unsubscribe();
      setProgress(null);
      runningRef.current = false;
    }
  }, []);

  const handleResult = useCallback((result: AudioImportResult | null) => {
    if (!result || result.status === "canceled") return;
    if (result.status === "imported" || result.status === "restored") {
      openImportedBook(result.record.id);
      return;
    }
    Alert.alert(
      "Already imported",
      `“${result.existing.title}” is already in your imported audiobooks.`,
      [
        {
          text: "Open It",
          onPress: () => {
            void discardPendingAudioImport(result.pending);
            openImportedBook(result.existing.id);
          },
        },
        {
          text: "Import as New Copy",
          onPress: () => {
            void commitPendingAudioImport(result.pending)
              .then((record) => openImportedBook(record.id))
              .catch((error) => Alert.alert("Import failed", describeError(error)));
          },
        },
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => void discardPendingAudioImport(result.pending),
        },
      ],
    );
  }, []);

  const startImport = useCallback(async () => {
    handleResult(await run(pickAndImportAudio));
  }, [handleResult, run]);

  const startReimport = useCallback(
    async (id: string) => {
      const result = await run(() => pickAndReimportAudio(id));
      if (result?.status !== "mismatch") return;
      const minutes = formatImportedDuration;
      Alert.alert(
        "Different length",
        `“${result.pending.fileName}” is ${minutes(result.pending.metadata.durationSeconds)} long, but ` +
          `“${result.existing.title}” was ${minutes(result.existing.durationSeconds)}. ` +
          "It may be a different recording, and your saved position may not line up.",
        [
          { text: "Cancel", style: "cancel", onPress: () => void discardPendingAudioImport(result.pending) },
          {
            text: "Use This File",
            onPress: () =>
              void confirmMismatchedReimport(id, result.pending).catch((error) =>
                Alert.alert("Import failed", describeError(error)),
              ),
          },
        ],
      );
    },
    [run],
  );

  return { progress, isImporting: progress !== null, startImport, startReimport };
};

/** Full-screen veil shown while an imported file is being copied into the app. */
export const AudioImportProgressOverlay = ({ progress }: { progress: ImportProgress }) => {
  const themeColors = useThemeColors();
  if (!progress) return null;
  return (
    <View
      accessibilityViewIsModal
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.35)",
        zIndex: 10,
      }}
    >
      <View
        style={{
          width: 280,
          gap: 10,
          alignItems: "center",
          padding: 20,
          borderRadius: 16,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
        }}
      >
        <ActivityIndicator />
        <Text style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}>Importing…</Text>
        <Text numberOfLines={2} style={{ color: themeColors.text, textAlign: "center" }}>
          {progress.fileName}
        </Text>
        <Text style={{ color: themeColors.textMuted, fontSize: 12, textAlign: "center" }}>
          Files stored only in iCloud are downloaded first, which can take a while.
        </Text>
      </View>
    </View>
  );
};
