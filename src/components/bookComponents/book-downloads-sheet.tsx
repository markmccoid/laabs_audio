import { downloadsApi } from "@/api/downloads-api";
import type { LibraryItemSummary } from "@/api/library-items-api";
import { useCachedBookSummary, useGetItemDetails } from "@/hooks/abs-data-hooks";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatBytes } from "@/utils/formatUtils";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DownloadControls from "./download-controls";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const normalizeFilenameWithExt = (
  filename: string | undefined,
  ext: string | undefined,
  fallback: string,
) => {
  const trimmedFilename = (filename ?? "").trim();
  const trimmedExt = (ext ?? "").trim().replace(/^\./, "");
  const fallbackWithExt = trimmedExt ? `${fallback}.${trimmedExt}` : fallback;

  if (!trimmedFilename) {
    return fallbackWithExt;
  }

  if (!trimmedExt) {
    return trimmedFilename;
  }

  const lowerName = trimmedFilename.toLowerCase();
  const lowerExt = `.${trimmedExt.toLowerCase()}`;

  if (lowerName.endsWith(lowerExt)) {
    return trimmedFilename;
  }

  return `${trimmedFilename}.${trimmedExt}`;
};

export const BookDownloadsSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
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
  const ebookFiles = useMemo(() => {
    const files = new Map<string, { ino: string; filenameWithExt: string; label: string }>();
    const mediaEbook = bookData?.media?.ebookFile;

    if (mediaEbook?.ino) {
      const filenameWithExt = normalizeFilenameWithExt(
        mediaEbook.metadata?.filename,
        mediaEbook.metadata?.ext,
        `ebook-${mediaEbook.ino}`,
      );
      files.set(mediaEbook.ino, {
        ino: mediaEbook.ino,
        filenameWithExt,
        label: filenameWithExt,
      });
    }

    for (const file of bookData?.libraryFiles ?? []) {
      if (!file?.ino) continue;
      const fileType = (file.fileType ?? "").toLowerCase();
      const fileExt = (file.metadata?.ext ?? "").toLowerCase();
      const isEbookFile =
        fileType.includes("ebook") || ["epub", "pdf", "mobi", "azw3"].includes(fileExt);
      if (!isEbookFile) continue;

      const filenameWithExt = normalizeFilenameWithExt(
        file.metadata?.filename,
        file.metadata?.ext,
        `ebook-${file.ino}`,
      );

      files.set(file.ino, {
        ino: file.ino,
        filenameWithExt,
        label: filenameWithExt,
      });
    }

    return Array.from(files.values());
  }, [bookData?.libraryFiles, bookData?.media?.ebookFile]);

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

      <DownloadControls libraryItemId={libraryItemId} summary={summary} context="sheet" />

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
                  style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: "#ffffff" }}
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
