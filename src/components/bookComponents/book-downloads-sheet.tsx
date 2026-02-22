import type { LibraryItemSummary } from "@/api/library-items-api";
import { useCachedBookSummary, useGetItemDetails } from "@/hooks/abs-data-hooks";
import { formatBytes } from "@/utils/formatUtils";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme/use-app-theme";
import DownloadControls from "./download-controls";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const BookDownloadsSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { libraryItemId: libraryItemIdParam } =
    useLocalSearchParams<{ libraryItemId?: string | string[] }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const cachedSummary = useCachedBookSummary(libraryItemId);
  const { data: bookData, isLoading } = useGetItemDetails(libraryItemId);

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

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen options={{ title: "Download" }} />
      <ScrollView
        style={{ flex: 1 }}
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(24, insets.bottom + 12),
          gap: 12,
        }}
      >
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

        <DownloadControls libraryItemId={libraryItemId} summary={summary} />
      </ScrollView>
    </View>
  );
};
