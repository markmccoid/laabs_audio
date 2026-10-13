import { CoverImage } from "@/components/images/cover-image";
import { ImportedSourceLabel } from "@/components/imported/imported-badge";
import { filterLocalBooks, useLocalBooks, type LocalBook } from "@/hooks/use-local-books";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LocalBookRow = ({ item }: { item: LocalBook }) => {
  const themeColors = useThemeColors();
  const { book, source } = item;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      onPress={() =>
        router.push({ pathname: "/(tabs)/search/[libraryItemId]", params: { libraryItemId: book.id } })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <CoverImage
        libraryItemId={book.id}
        coverUri={book.cover}
        variant="thumb"
        style={{
          width: 56,
          height: 56,
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={2} style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
          {book.title}
        </Text>
        {book.author ? (
          <Text numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {book.author}
          </Text>
        ) : null}
        {source === "imported" ? (
          <ImportedSourceLabel compact />
        ) : (
          <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>Downloaded</Text>
        )}
      </View>
    </Pressable>
  );
};

/**
 * Search without a User Session: matches title/author across Imported Audiobooks and owned
 * downloads, entirely on device.
 */
export const LocalSearchScreen = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const books = useLocalBooks();
  const [query, setQuery] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [listEpoch, setListEpoch] = useState(0);
  const wasActiveRef = useRef(isSearchActive);
  const results = useMemo(() => filterLocalBooks(books, query), [books, query]);

  // iOS 26 bottom search drops the list's top inset and never restores it; remount the list after
  // search closes so it re-derives its insets (same workaround as LibraryContainer).
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isSearchActive;
    if (!wasActive || isSearchActive) return;
    const timeout = setTimeout(() => setListEpoch((epoch) => epoch + 1), 350);
    return () => clearTimeout(timeout);
  }, [isSearchActive]);

  return (
    <>
      <Stack.Screen.Title>Search</Stack.Screen.Title>
      <Stack.SearchBar
        placement="automatic"
        placeholder="Search your books"
        onFocus={() => setIsSearchActive(true)}
        onClose={() => setIsSearchActive(false)}
        onCancelButtonPress={() => {
          setIsSearchActive(false);
          setQuery("");
        }}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
      />
      <FlashList
        key={listEpoch}
        data={results}
        keyExtractor={(item) => item.book.id}
        renderItem={({ item }) => <LocalBookRow item={item} />}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingTop: isSearchActive ? insets.top : 0,
          paddingBottom: 96,
        }}
        ListEmptyComponent={
          <Text
            style={{ color: themeColors.textMuted, textAlign: "center", padding: 32, fontSize: 15 }}
          >
            {books.length === 0
              ? "No downloaded or imported audiobooks on this device."
              : `No books match “${query.trim()}”.`}
          </Text>
        }
      />
    </>
  );
};
