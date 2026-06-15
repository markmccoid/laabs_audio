import { useAuthStore } from "@/auth/auth-store";
import {
  useBookShelfManagementOptions,
  type ShelfMembershipOption,
} from "@/hooks/use-shelf-membership-options";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const BookBookshelvesSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [optimisticSelectionState, setOptimisticSelectionState] = useState<{
    libraryItemId?: string;
    byShelfId: Record<string, boolean>;
  }>({ byShelfId: {} });
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const shelfMembershipOptions = useBookShelfManagementOptions(libraryItemId);
  const {
    addBookToCustomShelf,
    removeBookFromCustomShelf,
    addBooksToPlaylistShelfOptimistic,
    removeBooksFromPlaylistShelfOptimistic,
  } = useDeviceBooksActions();
  const canMutate = Boolean(libraryItemId && activeLibraryId && activeLibraryUserKey);
  const shelves = useMemo(
    () => (libraryItemId ? shelfMembershipOptions : []),
    [libraryItemId, shelfMembershipOptions],
  );
  const optimisticSelectionByShelfId =
    optimisticSelectionState.libraryItemId === libraryItemId
      ? optimisticSelectionState.byShelfId
      : {};

  const openBookshelfSettings = () => {
    router.dismissTo("/(tabs)/settings/bookshelves");
  };

  const clearOptimisticSelection = (shelfId: string, expectedSelected: boolean) => {
    setOptimisticSelectionState((current) => {
      if (current.libraryItemId !== libraryItemId) return current;
      if (current.byShelfId[shelfId] !== expectedSelected) return current;
      const { [shelfId]: _cleared, ...remaining } = current.byShelfId;
      return { libraryItemId, byShelfId: remaining };
    });
  };

  const toggleMembership = (option: ShelfMembershipOption) => {
    if (!libraryItemId || !canMutate) return;
    if (!option.canMutate) return;
    const scopeOptions = { userKey: activeLibraryUserKey, libraryId: activeLibraryId };
    const nextSelected = !option.isMember;

    setOptimisticSelectionState((current) => ({
      libraryItemId,
      byShelfId: {
        ...(current.libraryItemId === libraryItemId ? current.byShelfId : {}),
        [option.shelfId]: nextSelected,
      },
    }));

    if (option.kind === "custom") {
      if (option.isMember) {
        removeBookFromCustomShelf(option.shelfId, libraryItemId, scopeOptions);
      } else {
        addBookToCustomShelf(option.shelfId, libraryItemId, scopeOptions);
      }
      setTimeout(() => clearOptimisticSelection(option.shelfId, nextSelected), 150);
      return;
    }

    const operation = option.isMember
      ? removeBooksFromPlaylistShelfOptimistic(option.shelfId, [libraryItemId], scopeOptions)
      : addBooksToPlaylistShelfOptimistic(option.shelfId, [libraryItemId], scopeOptions);

    void operation.finally(() => {
      clearOptimisticSelection(option.shelfId, nextSelected);
    });
  };

  const renderShelf = (option: ShelfMembershipOption) => {
    const isSelected = optimisticSelectionByShelfId[option.shelfId] ?? option.isMember;
    const typePill =
      option.kind === "custom"
        ? {
            label: "Custom",
            background: themeColors.accent,
            textColor: themeColors.accentForeground,
          }
        : {
            label: "Playlist",
            background: themeColors.absGold,
            textColor: "#201607",
          };
    const statusLabels = [
      option.isHiddenFromHome ? "Hidden from Home" : null,
      option.isSuppressed ? "Suppressed" : null,
      option.syncState === "pending" ? "Pending sync" : null,
      option.syncState === "unsynced" ? "Unsynced" : null,
    ].filter((label): label is string => Boolean(label));

    return (
      <Pressable
        key={option.shelfId}
        onPress={() => toggleMembership(option)}
        disabled={!canMutate || !option.canMutate}
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
          opacity: !canMutate || !option.canMutate ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text
              selectable
              numberOfLines={1}
              style={{ color: themeColors.text, fontSize: 16, fontWeight: "600", flexShrink: 1 }}
            >
              {option.title}
            </Text>
            <View
              style={{
                borderRadius: 999,
                borderCurve: "continuous",
                backgroundColor: typePill.background,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                selectable
                style={{ color: typePill.textColor, fontSize: 10, fontWeight: "700" }}
              >
                {typePill.label}
              </Text>
            </View>
          </View>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
            {option.bookCount} books
          </Text>
          {statusLabels.length > 0 ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {statusLabels.join(" • ")}
            </Text>
          ) : null}
        </View>
        <SymbolView
          name={isSelected ? "checkmark.circle.fill" : "circle"}
          tintColor={isSelected ? themeColors.accent : themeColors.textMuted}
          size={22}
        />
      </Pressable>
    );
  };

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
              No shelves yet. Use Settings to create your first shelf.
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
            <Text
              selectable
              style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "700" }}
            >
              Open Bookshelf Settings
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
};
