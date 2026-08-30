import { downloadsApi } from "@/api/downloads-api";
import type { LibraryItemSummary } from "@/api/library-items-api";
import { useCachedBookSummary, useGetItemDetails } from "@/hooks/abs-data-hooks";
import type { BookDetailRouteSource } from "@/navigation/book-links";
import { selectIsBookFullyDownloaded, useDeviceBooksStore } from "@/store/device-books-store";
import {
  useActiveTranscriptionTask,
  useTranscriptionActions,
  useTranscriptionStore,
} from "@/store/transcription-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  cancelTranscribeAfterDownload,
  requestTranscribeAfterDownload,
} from "@/transcription/book-transcription";
import { resolveBookLocale } from "@/transcription/transcription-planning";
import { useTranscriptionAvailability } from "@/transcription/use-transcription-availability";
import { formatBytes } from "@/utils/formatUtils";
import { SymbolView } from "expo-symbols";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DownloadControls from "./download-controls";
import { collectEbookFiles } from "./ebook-files";
import TranscribeControls from "./transcribe-controls";
import { TranscriptionLanguageRow } from "./transcription-language-row";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const BookDownloadsSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    libraryItemId: libraryItemIdParam,
    sourceBookRoute: sourceBookRouteParamRaw,
  } = useLocalSearchParams<{
    libraryItemId?: string | string[];
    sourceBookRoute?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const sourceBookRouteParam = resolveParam(sourceBookRouteParamRaw);
  const sourceBookRoute: BookDetailRouteSource | null =
    sourceBookRouteParam === "search" ||
    sourceBookRouteParam === "home" ||
    sourceBookRouteParam === "library"
      ? sourceBookRouteParam
      : null;
  const cachedSummary = useCachedBookSummary(libraryItemId);
  const { data: bookData, isLoading } = useGetItemDetails(libraryItemId);
  const [activeEbookIno, setActiveEbookIno] = useState<string | null>(null);

  const { fileCount, totalBytes, hasKnownSize } = useMemo(() => {
    const audioFiles = bookData?.audioFiles ?? [];
    const countFromDetails = audioFiles.length;
    const fileCountFromSummary = cachedSummary?.numAudioFiles ?? 0;
    const count = countFromDetails || fileCountFromSummary;
    const total = audioFiles.reduce((sum, file) => {
      const fileSize = file?.metadata?.size;
      return typeof fileSize === "number" && Number.isFinite(fileSize) ? sum + fileSize : sum;
    }, 0);
    const knownSize = audioFiles.some((file) => typeof file?.metadata?.size === "number");
    return { fileCount: count, totalBytes: total, hasKnownSize: knownSize };
  }, [bookData?.audioFiles, cachedSummary?.numAudioFiles]);

  const summary = (bookData as LibraryItemSummary | undefined) ?? cachedSummary ?? null;
  const ebookFiles = useMemo(() => collectEbookFiles(bookData), [bookData]);

  //~~ "Also transcribe after download" (Book Transcript, plan Phase 4 item 3)
  const transcriptionAvailability = useTranscriptionAvailability();
  const { clearDroppedAfterDownload } = useTranscriptionActions();
  const activeTranscriptionTask = useActiveTranscriptionTask();
  const droppedAfterDownload = useTranscriptionStore((state) => state.droppedAfterDownload);
  const isDownloaded = useDeviceBooksStore((state) =>
    libraryItemId ? selectIsBookFullyDownloaded(state, libraryItemId) : false,
  );
  const activeTranscriptionTitle = useDeviceBooksStore((state) => {
    const activeId = activeTranscriptionTask?.libraryItemId;
    if (!activeId) return null;
    return state.downloadedDetailsById[activeId]?.media?.metadata?.title?.trim() || null;
  });
  const resolvedLocale = resolveBookLocale(bookData ?? null);
  const [transcribeAfterDownload, setTranscribeAfterDownload] = useState(false);
  const [localeOverride, setLocaleOverride] = useState<string | null>(null);
  const transcriptionLocale = localeOverride ?? resolvedLocale.localeIdentifier;
  const isTranscriptionActive = activeTranscriptionTask !== null;
  const showTranscribeCheckbox =
    Platform.OS === "ios" &&
    Boolean(libraryItemId) &&
    !isDownloaded &&
    Boolean(transcriptionAvailability?.available);

  // The orchestrator already toasts when it has to drop the intent (no queue),
  // so this sheet must not toast again — it only clears the flag once seen.
  useEffect(() => {
    if (!libraryItemId) return;
    if (droppedAfterDownload?.libraryItemId !== libraryItemId) return;
    clearDroppedAfterDownload();
  }, [clearDroppedAfterDownload, droppedAfterDownload, libraryItemId]);

  const handleToggleTranscribeAfterDownload = () => {
    if (!libraryItemId) return;
    if (isTranscriptionActive) {
      Alert.alert(
        "Transcription in progress",
        activeTranscriptionTitle
          ? `Wait for the transcription of "${activeTranscriptionTitle}" to finish.`
          : "Wait for the current transcription to finish.",
      );
      return;
    }
    setTranscribeAfterDownload((current) => {
      const next = !current;
      if (!next) cancelTranscribeAfterDownload(libraryItemId);
      return next;
    });
  };

  const handleDownloadStart = () => {
    if (!libraryItemId) return;
    if (transcribeAfterDownload && !isTranscriptionActive) {
      requestTranscribeAfterDownload(libraryItemId, transcriptionLocale);
    } else {
      cancelTranscribeAfterDownload(libraryItemId);
    }
  };

  const handleShareEbook = async (fileIno: string, filenameWithExt: string) => {
    if (!libraryItemId) return;

    setActiveEbookIno(fileIno);
    try {
      await downloadsApi.downloadEbook(libraryItemId, fileIno, filenameWithExt);
    } catch (error) {
      console.error("Ebook download failed", error);
      Alert.alert("Download Failed", "Unable to download the file. Please try again.");
    } finally {
      setActiveEbookIno(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={{
        backgroundColor: themeColors.bg,
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingTop: 35,
        paddingBottom: Math.max(24, insets.bottom + 12),
        gap: 12,
      }}
    >
      <Stack.Screen options={{ title: "Download" }} />
      <View
        style={{
          borderRadius: 16,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          padding: 14,
          gap: 8,
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
          Download info
        </Text>
        {isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              Calculating file details...
            </Text>
          </View>
        ) : (
          <>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              Files: {fileCount}
            </Text>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              Size: {hasKnownSize ? formatBytes(totalBytes) : "Unknown"}
            </Text>
          </>
        )}
      </View>

      <DownloadControls
        libraryItemId={libraryItemId}
        summary={summary}
        context="sheet"
        sourceBookRoute={sourceBookRoute}
        onDownloadStart={handleDownloadStart}
      />

      {showTranscribeCheckbox ? (
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
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: transcribeAfterDownload,
              disabled: isTranscriptionActive,
            }}
            onPress={handleToggleTranscribeAfterDownload}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              opacity: isTranscriptionActive ? 0.5 : pressed ? 0.8 : 1,
            })}
          >
            <SymbolView
              name={transcribeAfterDownload ? "checkmark.square.fill" : "square"}
              size={22}
              tintColor={transcribeAfterDownload ? themeColors.accent : themeColors.textMuted}
            />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: themeColors.text }}>
              Also transcribe after download
            </Text>
          </Pressable>

          {isTranscriptionActive ? (
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              {activeTranscriptionTitle
                ? `Transcription in progress for ${activeTranscriptionTitle}`
                : "Another transcription is in progress"}
            </Text>
          ) : (
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              Runs on this device once the download finishes. The text is machine-generated and
              will contain errors.
            </Text>
          )}

          {resolvedLocale.isNonEnglish ? (
            <TranscriptionLanguageRow
              variant="inline"
              localeIdentifier={transcriptionLocale}
              needsConfirmation={localeOverride === null}
              disabled={isTranscriptionActive}
              onChange={setLocaleOverride}
            />
          ) : null}
        </View>
      ) : null}

      <TranscribeControls libraryItemId={libraryItemId} />

      {libraryItemId && ebookFiles.length > 0 ? (
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
            Ebook
          </Text>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            {ebookFiles.length === 1
              ? "An ebook attachment is available to share."
              : `${ebookFiles.length} ebook attachments are available to share.`}
          </Text>

          {ebookFiles.map((ebook) => {
            const isActive = activeEbookIno === ebook.ino;
            const isBusy = activeEbookIno !== null;

            return (
              <Pressable
                key={ebook.ino}
                onPress={() => {
                  void handleShareEbook(ebook.ino, ebook.filenameWithExt);
                }}
                disabled={isBusy}
                style={({ pressed }) => ({
                  borderRadius: 12,
                  borderCurve: "continuous",
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  backgroundColor: isBusy ? themeColors.textMuted : themeColors.accent,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  selectable
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={{
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: "600",
                    color: isActive ? "#FFFFFF" : themeColors.accentForeground,
                  }}
                >
                  {isActive ? "Preparing ebook..." : `Share ${ebook.label}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
};
