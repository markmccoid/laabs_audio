import type { UserBookProgress } from "@/api/me-api";
import { CoverImage } from "@/components/images/cover-image";
import { useImportedBookListData } from "@/imported/use-imported-books";
import type { ImportedAudiobookRecord } from "@/store/imported-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IMPORTED_TINT, ImportedSourceLabel } from "./imported-badge";

export const formatImportedDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return minutes > 0 ? `${minutes}m` : `${total}s`;
};

export const describeImportedProgress = (
  record: ImportedAudiobookRecord,
  progress: UserBookProgress | undefined,
) => {
  if (!record.audioPresent) return "Audio missing — re-import to play";
  if (progress?.isFinished) return "Finished";
  if (progress && progress.currentTime > 0) {
    return `${formatImportedDuration(record.durationSeconds - progress.currentTime)} left`;
  }
  return formatImportedDuration(record.durationSeconds);
};

const ImportedBookRow = memo(function ImportedBookRow({
  record,
  cover,
  progress,
}: {
  record: ImportedAudiobookRecord;
  cover: string;
  progress: UserBookProgress | undefined;
}) {
  const themeColors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${record.title}, imported audiobook`}
      onPress={() =>
        router.push({ pathname: "/(tabs)/library/[libraryItemId]", params: { libraryItemId: record.id } })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: themeColors.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: themeColors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <CoverImage
        libraryItemId={record.id}
        coverUri={cover}
        variant="thumb"
        showFinishedIndicator={Boolean(progress?.isFinished)}
        style={{
          width: 84,
          height: 84,
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
          backgroundColor: themeColors.bg,
          opacity: record.audioPresent ? 1 : 0.5,
        }}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={2} style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
          {record.title}
        </Text>
        {record.author ? (
          <Text numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {record.author}
          </Text>
        ) : null}
        {record.narrator ? (
          <Text numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 12 }}>
            Narrated by {record.narrator}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <ImportedSourceLabel compact />
          <Text
            numberOfLines={1}
            style={{
              color: record.audioPresent ? themeColors.textMuted : IMPORTED_TINT,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
              flexShrink: 1,
            }}
          >
            {describeImportedProgress(record, progress)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

/** Empty state offering Audio Import; shared by the Imported segment and Imported-Only Home. */
export const ImportAudioEmptyState = ({ onImport }: { onImport: () => void }) => {
  const themeColors = useThemeColors();

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
      <SymbolView name="folder.badge.plus" size={44} tintColor={IMPORTED_TINT} />
      <Text style={{ color: themeColors.text, fontSize: 17, fontWeight: "600", textAlign: "center" }}>
        No imported audiobooks
      </Text>
      <Text style={{ color: themeColors.textMuted, textAlign: "center" }}>
        Import an audiobook file from iCloud Drive or your iPhone. Imported audiobooks stay on this
        device and work with any Audiobookshelf account, or none.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onImport}
        style={({ pressed }) => ({
          marginTop: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 999,
          borderCurve: "continuous",
          backgroundColor: themeColors.accent,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <SymbolView name="plus" size={14} tintColor="#fff" />
        <Text style={{ color: "#fff", fontWeight: "600" }}>Import Audio</Text>
      </Pressable>
    </View>
  );
};

export const ImportedBooksSegment = ({ onImport }: { onImport: () => void }) => {
  const { records, books, progressByBookId } = useImportedBookListData();

  if (!records.length) return <ImportAudioEmptyState onImport={onImport} />;

  return (
    <FlashList
      data={records}
      keyExtractor={(record) => record.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 96 }}
      renderItem={({ item, index }) => (
        <ImportedBookRow record={item} cover={books[index]?.cover ?? ""} progress={progressByBookId[item.id]} />
      )}
    />
  );
};
