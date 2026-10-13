import { CoverImage } from "@/components/images/cover-image";
import { pickImportedBookCover, type ImportedCoverSource } from "@/imported/imported-audiobook-library";
import { resolveImportedCoverUri, useImportedBookRecord } from "@/imported/use-imported-books";
import { importedBooksStore } from "@/store/imported-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type Field = "title" | "author" | "narrator" | "description";

const FIELDS: { key: Field; label: string; multiline?: boolean }[] = [
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "narrator", label: "Narrator" },
  { key: "description", label: "Description", multiline: true },
];

/** Form sheet for editing Imported Audiobook Metadata. */
export const ImportedBookEditSheet = ({ libraryItemId }: { libraryItemId: string }) => {
  const themeColors = useThemeColors();
  const record = useImportedBookRecord(libraryItemId);
  const [draft, setDraft] = useState<Record<Field, string>>(() => ({
    title: record?.title ?? "",
    author: record?.author ?? "",
    narrator: record?.narrator ?? "",
    description: record?.description ?? "",
  }));

  if (!record) {
    return (
      <View style={{ flex: 1 }} collapsable={false}>
        <Text style={{ color: themeColors.textMuted, padding: 20 }}>Imported audiobook not found.</Text>
      </View>
    );
  }

  const save = () => {
    const title = draft.title.trim();
    if (!title) {
      Alert.alert("Title required", "An imported audiobook needs a title.");
      return;
    }
    const optional = (value: string) => value.trim() || null;
    importedBooksStore.getState().actions.updateImportedBookMetadata(record.id, {
      title,
      author: optional(draft.author),
      narrator: optional(draft.narrator),
      description: optional(draft.description),
    });
    router.back();
  };

  const changeCover = () => {
    const pick = (source: ImportedCoverSource) =>
      void pickImportedBookCover(record.id, source).catch((error) =>
        Alert.alert("Cover not changed", error instanceof Error ? error.message : "Try another image."),
      );
    Alert.alert("Choose Cover Image", undefined, [
      { text: "Photo Library", onPress: () => pick("photos") },
      { text: "Files", onPress: () => pick("files") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <View style={{ flex: 1 }} collapsable={false}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingTop: 22,
          paddingBottom: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
        }}
      >
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: themeColors.text, fontSize: 16 }}>Cancel</Text>
        </Pressable>
        <Text style={{ color: themeColors.text, fontSize: 17, fontWeight: "600" }}>Edit Details</Text>
        <Pressable accessibilityRole="button" onPress={save} hitSlop={10}>
          <Text style={{ color: themeColors.accent, fontSize: 16, fontWeight: "600" }}>Save</Text>
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <CoverImage
            libraryItemId={record.id}
            coverUri={resolveImportedCoverUri(record)}
            variant="thumb"
            style={{
              width: 88,
              height: 88,
              borderRadius: 12,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={changeCover}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text style={{ color: themeColors.text, fontWeight: "600" }}>Choose Cover Image…</Text>
          </Pressable>
        </View>
        {FIELDS.map((field) => (
          <View key={field.key} style={{ gap: 6 }}>
            <Text style={{ color: themeColors.textMuted, fontSize: 13, fontWeight: "600" }}>
              {field.label}
            </Text>
            <TextInput
              value={draft[field.key]}
              onChangeText={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
              multiline={field.multiline}
              autoCorrect={field.multiline}
              placeholder={field.label}
              placeholderTextColor={themeColors.textMuted}
              style={{
                color: themeColors.text,
                fontSize: 16,
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
                minHeight: field.multiline ? 120 : undefined,
                textAlignVertical: field.multiline ? "top" : undefined,
              }}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
};
