import type { LibraryItemSummary } from "@/api/library-items-api";
import {
  type HomeCustomShelf,
  type HomeDerivedShelf,
  useHomeShelves,
} from "@/hooks/use-home-shelves";
import { useThemeColors } from "@/theme/use-app-theme";
import { useAuthStore } from "@/auth/auth-store";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

type ShelfSectionProps = {
  title: string;
  books: LibraryItemSummary[];
  emptyMessage: string;
  onOpenAddBooks?: () => void;
};

const ShelfBookCard = ({ book }: { book: LibraryItemSummary }) => {
  const themeColors = useThemeColors();

  return (
    <Link
      href={{
        pathname: "/(tabs)/(home)/[libraryItemId]",
        params: { libraryItemId: book.id },
      }}
      asChild
    >
      <Pressable
        style={{
          width: 128,
          gap: 8,
        }}
      >
        <Image
          source={book.cover}
          style={{
            width: 128,
            height: 128,
            borderRadius: 14,
            backgroundColor: themeColors.surface,
          }}
        />
        <Text
          selectable
          numberOfLines={2}
          style={{ color: themeColors.text, fontSize: 13, fontWeight: "600" }}
        >
          {book.title}
        </Text>
      </Pressable>
    </Link>
  );
};

const ShelfSection = ({ title, books, emptyMessage, onOpenAddBooks }: ShelfSectionProps) => {
  const themeColors = useThemeColors();

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          paddingHorizontal: 18,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 20, fontWeight: "700" }}>
          {title}
        </Text>
        {onOpenAddBooks ? (
          <Pressable
            onPress={onOpenAddBooks}
            style={{
              backgroundColor: themeColors.surface,
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 999,
              borderCurve: "continuous",
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 12, fontWeight: "600" }}>
              Add Books
            </Text>
          </Pressable>
        ) : null}
      </View>
      {books.length === 0 ? (
        <Text
          selectable
          style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 18 }}
        >
          {emptyMessage}
        </Text>
      ) : (
        <FlatList
          data={books}
          horizontal
          keyExtractor={(book) => book.id}
          renderItem={({ item }) => <ShelfBookCard book={item} />}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 2 }}
          ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
          showsHorizontalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const CreateShelfPanel = ({
  isExpanded,
  shelfName,
  onToggle,
  onNameChange,
  onCreate,
}: {
  isExpanded: boolean;
  shelfName: string;
  onToggle: () => void;
  onNameChange: (nextName: string) => void;
  onCreate: () => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <View
      style={{
        marginHorizontal: 18,
        backgroundColor: themeColors.surface,
        borderColor: themeColors.border,
        borderWidth: 1,
        borderRadius: 16,
        borderCurve: "continuous",
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
          Custom Shelves
        </Text>
        <Pressable
          onPress={onToggle}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
          }}
        >
          <Text selectable style={{ color: themeColors.text, fontSize: 12, fontWeight: "600" }}>
            {isExpanded ? "Close" : "Create Shelf"}
          </Text>
        </Pressable>
      </View>
      {isExpanded ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={shelfName}
            onChangeText={onNameChange}
            placeholder="Shelf name"
            placeholderTextColor={themeColors.textMuted}
            style={{
              color: themeColors.text,
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 12,
              borderCurve: "continuous",
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: themeColors.bg,
            }}
          />
          <Pressable
            onPress={onCreate}
            style={{
              alignSelf: "flex-start",
              backgroundColor: themeColors.accent,
              borderRadius: 999,
              borderCurve: "continuous",
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text selectable style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
              Save Shelf
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const HomeShelvesScreen = () => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { createCustomShelf, addBookToCustomShelf } = useDeviceBooksActions();
  const { catalog, derivedShelves, customShelves } = useHomeShelves();
  const [isCreateShelfExpanded, setIsCreateShelfExpanded] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [addShelfId, setAddShelfId] = useState<string | null>(null);
  const [addSearch, setAddSearch] = useState("");

  const customShelfForAdd = useMemo(
    () => customShelves.find((shelf) => shelf.id === addShelfId) ?? null,
    [addShelfId, customShelves],
  );

  const filteredCatalogForAdd = useMemo(() => {
    const searchTerm = addSearch.trim().toLowerCase();
    if (!searchTerm) return catalog;
    return catalog.filter((book) => {
      const title = book.title.toLowerCase();
      const author = (book.author ?? "").toLowerCase();
      return title.includes(searchTerm) || author.includes(searchTerm);
    });
  }, [addSearch, catalog]);

  const handleCreateShelf = () => {
    const shelfId = createCustomShelf(newShelfName, {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    });
    if (!shelfId) return;
    setNewShelfName("");
    setIsCreateShelfExpanded(false);
  };

  const visibleDerivedShelves = derivedShelves.filter((shelf) => shelf.isVisible);

  const renderAddShelfBook = ({ item }: { item: LibraryItemSummary }) => {
    if (!customShelfForAdd) return null;
    const isAlreadyAdded = customShelfForAdd.bookIds.includes(item.id);

    return (
      <View
        style={{
          flexDirection: "row",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 8,
        }}
      >
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center", flex: 1 }}>
          <Image
            source={item.cover}
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              backgroundColor: themeColors.surface,
            }}
          />
          <View style={{ flex: 1 }}>
            <Text selectable numberOfLines={1} style={{ color: themeColors.text, fontSize: 14 }}>
              {item.title}
            </Text>
            <Text selectable numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {item.author || "Unknown author"}
            </Text>
          </View>
        </View>
        <Pressable
          disabled={isAlreadyAdded}
          onPress={() =>
            addBookToCustomShelf(customShelfForAdd.id, item.id, {
              userKey: activeLibraryUserKey,
              libraryId: activeLibraryId,
            })
          }
          style={{
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: isAlreadyAdded ? themeColors.border : themeColors.accent,
            paddingHorizontal: 12,
            paddingVertical: 5,
            backgroundColor: isAlreadyAdded ? themeColors.surface : themeColors.accent,
          }}
        >
          <Text
            selectable
            style={{
              color: isAlreadyAdded ? themeColors.textMuted : "#fff",
              fontSize: 12,
              fontWeight: "700",
            }}
          >
            {isAlreadyAdded ? "Added" : "Add"}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24, gap: 22 }}
      >
        <CreateShelfPanel
          isExpanded={isCreateShelfExpanded}
          shelfName={newShelfName}
          onToggle={() => setIsCreateShelfExpanded((current) => !current)}
          onNameChange={setNewShelfName}
          onCreate={handleCreateShelf}
        />

        {visibleDerivedShelves.map((shelf: HomeDerivedShelf) => (
          <ShelfSection
            key={shelf.id}
            title={shelf.title}
            books={shelf.books}
            emptyMessage={shelf.emptyMessage}
          />
        ))}

        {customShelves.map((shelf: HomeCustomShelf) => (
          <ShelfSection
            key={shelf.id}
            title={shelf.title}
            books={shelf.books}
            emptyMessage={shelf.emptyMessage}
            onOpenAddBooks={() => setAddShelfId(shelf.id)}
          />
        ))}

        {customShelves.length === 0 ? (
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 18 }}
          >
            Create a custom shelf to save book collections for trips, moods, and themes.
          </Text>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(customShelfForAdd)} animationType="slide" onRequestClose={() => setAddShelfId(null)}>
        <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
          <View
            style={{
              paddingTop: 14,
              paddingHorizontal: 18,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: themeColors.border,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 20, fontWeight: "700" }}>
                {customShelfForAdd?.title ?? "Add Books"}
              </Text>
              <Pressable
                onPress={() => {
                  setAddShelfId(null);
                  setAddSearch("");
                }}
                style={{
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  borderRadius: 999,
                  borderCurve: "continuous",
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
              >
                <Text selectable style={{ color: themeColors.text, fontSize: 12, fontWeight: "700" }}>
                  Done
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={addSearch}
              onChangeText={setAddSearch}
              placeholder="Search books"
              placeholderTextColor={themeColors.textMuted}
              style={{
                color: themeColors.text,
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 12,
                borderCurve: "continuous",
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: themeColors.surface,
              }}
            />
          </View>
          <FlatList
            data={filteredCatalogForAdd}
            keyExtractor={(book) => book.id}
            renderItem={renderAddShelfBook}
            contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }}
            ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
            showsVerticalScrollIndicator
          />
        </View>
      </Modal>
    </View>
  );
};

export default HomeShelvesScreen;
