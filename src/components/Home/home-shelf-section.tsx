import type { LibraryItemSummary } from "@/api/library-items-api";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Href } from "expo-router";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { FlatList, Pressable, Text, View } from "react-native";
import { ShelfBookCard } from "./shelf-book-card";

type HomeShelfSectionProps = {
  title: string;
  books: LibraryItemSummary[];
  emptyMessage: string;
  shelfHref: Href;
  onRefresh?: () => void;
};

export const HomeShelfSection = ({
  title,
  books,
  emptyMessage,
  shelfHref,
  onRefresh,
}: HomeShelfSectionProps) => {
  const themeColors = useThemeColors();
  const hasBooks = books.length > 0;

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
        <Text
          numberOfLines={1}
          style={{ color: themeColors.text, fontSize: 20, fontWeight: "700", flex: 1 }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {onRefresh ? (
            <Pressable
              onPress={onRefresh}
              style={{
                backgroundColor: themeColors.surface,
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 999,
                borderCurve: "continuous",
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="arrow.clockwise" tintColor={themeColors.textMuted} size={16} />
            </Pressable>
          ) : null}
          {hasBooks ? (
            <Link href={shelfHref} asChild>
              <Pressable
                hitSlop={12}
                style={{
                  backgroundColor: themeColors.surface,
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  borderRadius: 999,
                  borderCurve: "continuous",
                  width: 32,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <SymbolView name="chevron.right" tintColor={themeColors.textMuted} size={14} />
              </Pressable>
            </Link>
          ) : null}
        </View>
      </View>
      {!hasBooks ? (
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
