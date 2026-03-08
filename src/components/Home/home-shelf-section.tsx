import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Href } from "expo-router";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { ShelfBookCard } from "./shelf-book-card";

type HomeShelfSectionProps = {
  title: string;
  books: LibraryItemSummary[];
  favoriteByBookId: Record<string, true>;
  progressByBookId: Record<string, UserBookProgress>;
  isOffline: boolean;
  emptyMessage: string;
  headerHeight: number;
  shelfHref: Href;
  onRefresh?: () => void;
  scrollY: SharedValue<number>;
};

export const HomeShelfSection = ({
  title,
  books,
  favoriteByBookId,
  progressByBookId,
  isOffline,
  emptyMessage,
  headerHeight,
  shelfHref,
  onRefresh,
  scrollY,
}: HomeShelfSectionProps) => {
  const themeColors = useThemeColors();
  const hasBooks = books.length > 0;
  const [sectionTop, setSectionTop] = useState(0);
  const [listTop, setListTop] = useState(0);
  const menuContentTop = sectionTop + listTop + 118;

  return (
    <View
      style={{ gap: 12 }}
      onLayout={(event) => {
        setSectionTop(event.nativeEvent.layout.y);
      }}
    >
      <View className="flex-row items-center justify-between px-[18] py-[1]">
        <View className="pl-4 pr-10 rounded-xl overflow-hidden border-hairline border-accent border-t-0 border-l-0 border-r-0">
          {/* <LinearGradient
            colors={[`${themeColors.accent}77`, "rgba(255, 255, 255, 0)"]} // 2. Fading to transparent white
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            locations={[0.1, 1]}
            style={StyleSheet.absoluteFill} // 3. This is the magic fix (top:0, left:0, right:0, bottom:0)
          /> */}
          <Text
            numberOfLines={1}
            style={{ color: themeColors.text, fontSize: 20, fontWeight: "700", flex: 1 }}
          >
            {title}
          </Text>
        </View>

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
        <View
          onLayout={(event) => {
            setListTop(event.nativeEvent.layout.y);
          }}
        >
          <FlatList
            data={books}
            horizontal
            keyExtractor={(book) => book.id}
            renderItem={({ item }) => (
              <ShelfBookCard
                book={item}
                headerHeight={headerHeight}
                isFavorite={Boolean(favoriteByBookId[item.id])}
                isOffline={isOffline}
                menuContentTop={menuContentTop}
                progress={progressByBookId[item.id]}
                scrollY={scrollY}
              />
            )}
            contentContainerStyle={{
              paddingHorizontal: 18,
              paddingBottom: 2,
            }}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            showsHorizontalScrollIndicator={false}
          />
        </View>
      )}
    </View>
  );
};
