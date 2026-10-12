import BookControls from "@/components/bookComponents/book-controls";
import { CoverImage } from "@/components/images/cover-image";
import { toImportedBookProgress } from "@/imported/imported-audiobook-presentation";
import { removeImportedAudiobook } from "@/imported/imported-audiobook-library";
import { resolveImportedCoverUri, useImportedBookRecord } from "@/imported/use-imported-books";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IMPORTED_TINT, ImportedSourceLabel } from "./imported-badge";
import { describeImportedProgress, formatImportedDuration } from "./imported-books-segment";
import { AudioImportProgressOverlay, useAudioImportFlow } from "./use-audio-import-flow";

const confirmRemove = (id: string, title: string) => {
  Alert.alert(
    "Remove Imported Audiobook",
    `Remove “${title}” from this device? The original file in Files is not affected.`,
    [
      {
        text: "Remove, Keep Progress",
        onPress: () => {
          router.back();
          void removeImportedAudiobook(id);
        },
      },
      {
        text: "Remove and Delete Progress",
        style: "destructive",
        onPress: () => {
          router.back();
          void removeImportedAudiobook(id, { deleteListeningState: true });
        },
      },
      { text: "Cancel", style: "cancel" },
    ],
  );
};

const ActionButton = ({
  title,
  icon,
  destructive,
  onPress,
}: {
  title: string;
  icon: "pencil" | "trash" | "arrow.down.doc";
  destructive?: boolean;
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();
  const tint = destructive ? "#C0392B" : themeColors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 11,
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <SymbolView name={icon} size={15} tintColor={tint} />
      <Text style={{ color: tint, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
};

/** Detail screen for an Imported Audiobook: never touches Audiobookshelf. */
export const ImportedAudiobookScreen = ({ libraryItemId }: { libraryItemId: string }) => {
  const themeColors = useThemeColors();
  const record = useImportedBookRecord(libraryItemId);
  const openMainPlayerOnStart = useSettingsStore((state) => state.openPlayerOnPlaybackStart);
  const importFlow = useAudioImportFlow();
  const progress = useMemo(() => (record ? toImportedBookProgress(record) : undefined), [record]);

  if (!record || record.removedAt) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Stack.Screen options={{ headerTitle: "" }} />
        <Text style={{ color: themeColors.textMuted }}>This imported audiobook was removed.</Text>
      </View>
    );
  }

  const coverUri = resolveImportedCoverUri(record);
  const metaParts = [
    formatImportedDuration(record.durationSeconds),
    record.chapters.length ? `${record.chapters.length} chapters` : null,
    record.tracks.length > 1 ? `${record.tracks.length} files` : null,
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen options={{ headerTitle: record.title }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 16 }}
      >
        <View style={{ alignItems: "center", gap: 14 }}>
          <CoverImage
            libraryItemId={record.id}
            coverUri={coverUri}
            showFinishedIndicator={Boolean(progress?.isFinished)}
            style={{
              width: 240,
              height: 240,
              borderRadius: 16,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              opacity: record.audioPresent ? 1 : 0.5,
            }}
          />
          <ImportedSourceLabel />
        </View>

        <View style={{ gap: 4 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 22, fontWeight: "700" }}>
            {record.title}
          </Text>
          {record.author ? (
            <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
              {record.author}
            </Text>
          ) : null}
          {record.narrator ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              Narrated by {record.narrator}
            </Text>
          ) : null}
          <Text style={{ color: themeColors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] }}>
            {[...metaParts, record.audioPresent ? describeImportedProgress(record, progress) : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>

        {record.audioPresent ? (
          <BookControls libraryItemId={record.id} openMainPlayerOnStart={openMainPlayerOnStart} />
        ) : (
          <View
            style={{
              gap: 10,
              padding: 14,
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: IMPORTED_TINT,
              backgroundColor: themeColors.surface,
            }}
          >
            <Text style={{ color: themeColors.text, fontWeight: "600" }}>Audio missing</Text>
            <Text style={{ color: themeColors.textMuted }}>
              The audio for this book is no longer on this device, for example after restoring from a
              backup. Re-import the file to play it again. Your progress is kept.
            </Text>
            <ActionButton
              title="Re-import Audio"
              icon="arrow.down.doc"
              onPress={() => void importFlow.startReimport(record.id)}
            />
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <ActionButton
            title="Edit Details"
            icon="pencil"
            onPress={() => router.push({ pathname: "/imported-book-edit", params: { libraryItemId: record.id } })}
          />
          <ActionButton
            title="Remove"
            icon="trash"
            destructive
            onPress={() => confirmRemove(record.id, record.title)}
          />
        </View>

        {record.description ? (
          <Text selectable style={{ color: themeColors.text, fontSize: 15, lineHeight: 21 }}>
            {record.description}
          </Text>
        ) : null}
      </ScrollView>
      <AudioImportProgressOverlay progress={importFlow.progress} />
    </View>
  );
};
