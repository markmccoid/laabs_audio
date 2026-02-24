import { useAuthStore } from "@/auth/auth-store";
import { useHomeShelves } from "@/hooks/use-home-shelves";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const BookBookshelvesSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { customShelves } = useHomeShelves();
  const { addBookToCustomShelf, removeBookFromCustomShelf } = useDeviceBooksActions();

  const canMutate = Boolean(libraryItemId && activeLibraryId && activeLibraryUserKey);
  const selectedShelfCount = useMemo(() => {
    if (!libraryItemId) return 0;
    return customShelves.reduce(
      (count, shelf) => (shelf.bookIds.includes(libraryItemId) ? count + 1 : count),
      0,
    );
  }, [customShelves, libraryItemId]);

  const openBookshelfSettings = () => {
    router.push("/(tabs)/settings/bookshelves");
  };

  const toggleMembership = (shelfId: string, currentlySelected: boolean) => {
    if (!libraryItemId || !canMutate) return;
    const scopeOptions = { userKey: activeLibraryUserKey, libraryId: activeLibraryId };

    if (currentlySelected) {
      removeBookFromCustomShelf(shelfId, libraryItemId, scopeOptions);
      return;
    }

    addBookToCustomShelf(shelfId, libraryItemId, scopeOptions);
  };

  const renderShelf = (shelf: (typeof customShelves)[number]) => {
    const isSelected = Boolean(libraryItemId && shelf.bookIds.includes(libraryItemId));

    return (
      <Pressable
        key={shelf.id}
        onPress={() => toggleMembership(shelf.id, isSelected)}
        disabled={!canMutate}
        style={({ pressed }) => ({
          borderRadius: 14,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: isSelected ? themeColors.accent : themeColors.border,
          backgroundColor: themeColors.surface,
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          opacity: !canMutate ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            selectable
            numberOfLines={1}
            style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}
          >
            {shelf.title}
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
            {shelf.bookIds.length} books
          </Text>
        </View>
        <SymbolView
          name={isSelected ? "checkmark.circle.fill" : "circle"}
          tintColor={isSelected ? themeColors.accent : themeColors.textMuted}
          size={22}
        />
      </Pressable>
    );
  };

  const shelves = libraryItemId ? customShelves : [];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: Math.max(24, insets.bottom + 12),
      }}
    >
      <Stack.Screen options={{ headerTitle: "Add To Bookshelves" }} />

      {/* <View style={{ marginBottom: 12, gap: 10 }}>
        <View className="p-[14] gap-[8]">
          <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
            Add to custom bookshelves
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13, lineHeight: 18 }}>
            Tap a shelf to add or remove this book.
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
            Selected: {selectedShelfCount}
          </Text>
        </View>
      </View> */}

      {shelves.length > 0 ? (
        <View style={{ gap: 10 }}>{shelves.map((shelf) => renderShelf(shelf))}</View>
      ) : (
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
          {!libraryItemId ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              Book ID is missing. Close this sheet and open the book again.
            </Text>
          ) : (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              No custom shelves yet. Use Settings to create your first shelf.
            </Text>
          )}
          <Pressable
            onPress={openBookshelfSettings}
            accessibilityRole="button"
            accessibilityLabel="Open bookshelf settings"
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.accent,
              backgroundColor: themeColors.accent,
              paddingVertical: 10,
              alignItems: "center",
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <Text selectable style={{ color: "#ffffff", fontSize: 14, fontWeight: "700" }}>
              Open Bookshelf Settings
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
};
