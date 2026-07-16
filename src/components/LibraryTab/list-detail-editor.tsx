import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable, { type SortableFlexDragEndParams } from "react-native-sortables";

type ListDetailEditorProps = {
  listKind: "playlist" | "collection";
  name: string;
  fallbackName: string;
  bookIds: string[];
  onNameChange: (name: string) => void;
  onBookIdsChange: (bookIds: string[]) => void;
  getBookTitle: (libraryItemId: string) => string | undefined;
  renderBook: (libraryItemId: string) => ReactNode;
};

type ListEditButtonProps = {
  listKind: "playlist" | "collection";
  isEditing: boolean;
  isSavePending: boolean;
  onPress: () => void;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const arraysMatch = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const ListEditButton = ({
  listKind,
  isEditing,
  isSavePending,
  onPress,
}: ListEditButtonProps) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isEditing ? `Save ${listKind} changes` : `Edit ${listKind}`}
      disabled={isSavePending}
      onPress={onPress}
      hitSlop={10}
      style={{
        paddingHorizontal: 4,
        paddingVertical: 4,
        opacity: isSavePending ? 0.55 : 1,
      }}
    >
      <SymbolView
        name={isEditing ? "checkmark" : "pencil"}
        tintColor={themeColors.accent}
        size={19}
      />
    </Pressable>
  );
};

export const ListDetailEditor = ({
  listKind,
  name,
  fallbackName,
  bookIds,
  onNameChange,
  onBookIdsChange,
  getBookTitle,
  renderBook,
}: ListDetailEditorProps) => {
  const themeColors = useThemeColors();
  const editScrollRef = useAnimatedRef<ScrollView>();
  const [editListWidth, setEditListWidth] = useState(0);
  const displayKind = capitalize(listKind);

  const handleDragEnd = useCallback(
    ({ order }: SortableFlexDragEndParams) => onBookIdsChange(order(bookIds)),
    [bookIds, onBookIdsChange],
  );

  const confirmRemoveBook = useCallback(
    (libraryItemId: string) => {
      const bookTitle = getBookTitle(libraryItemId) ?? "this book";
      Alert.alert(
        `Remove book from ${listKind}?`,
        `Remove \"${bookTitle}\" from \"${name.trim() || fallbackName}\"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => onBookIdsChange(bookIds.filter((bookId) => bookId !== libraryItemId)),
          },
        ],
        { cancelable: true },
      );
    },
    [bookIds, fallbackName, getBookTitle, listKind, name, onBookIdsChange],
  );

  return (
    <Animated.ScrollView
      ref={editScrollRef}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 96, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 7 }}>
        <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
          {displayKind} name
        </Text>
        <TextInput
          value={name}
          onChangeText={onNameChange}
          placeholder={`${displayKind} name`}
          placeholderTextColor={themeColors.textMuted}
          returnKeyType="done"
          selectTextOnFocus
          style={{
            minHeight: 46,
            borderRadius: 12,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
            color: themeColors.text,
            fontSize: 16,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        />
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
          Drag books by the handle or remove them with the minus button. Changes are saved when you
          tap the checkmark.
        </Text>
      </View>

      {bookIds.length > 0 ? (
        <View
          style={{ width: "100%" }}
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            if (nextWidth <= 0) return;
            setEditListWidth((current) => (current === nextWidth ? current : nextWidth));
          }}
        >
          {editListWidth > 0 ? (
            <Sortable.Flex
              width="fill"
              flexDirection="column"
              flexWrap="nowrap"
              rowGap={8}
              customHandle
              scrollableRef={editScrollRef}
              onDragEnd={handleDragEnd}
              sortEnabled
            >
              {bookIds.map((libraryItemId) => (
                <View key={libraryItemId} style={{ width: editListWidth }}>
                  <View
                    style={{
                      width: "100%",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${getBookTitle(libraryItemId) ?? "book"} from ${listKind}`}
                      onPress={() => confirmRemoveBook(libraryItemId)}
                      hitSlop={6}
                      style={{ width: 32, alignItems: "center", justifyContent: "center" }}
                    >
                      <SymbolView name="minus.circle.fill" tintColor="#d32424" size={24} />
                    </Pressable>

                    <View
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        borderRadius: 14,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: themeColors.border,
                        backgroundColor: themeColors.surface,
                        overflow: "hidden",
                      }}
                    >
                      <View style={{ flex: 1 }} pointerEvents="none">
                        {renderBook(libraryItemId) ?? (
                          <BookListItemPlaceholder showRowBorders={false} />
                        )}
                      </View>

                      <Sortable.Handle
                        style={{
                          minWidth: 40,
                          alignSelf: "stretch",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <SymbolView
                          name="line.3.horizontal"
                          tintColor={themeColors.textMuted}
                          size={22}
                        />
                      </Sortable.Handle>
                    </View>
                  </View>
                </View>
              ))}
            </Sortable.Flex>
          ) : null}
        </View>
      ) : (
        <View style={{ paddingVertical: 24 }}>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            No books in this {listKind}.
          </Text>
        </View>
      )}
    </Animated.ScrollView>
  );
};
