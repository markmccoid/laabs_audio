import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { usePlaybackStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BookControls from "../bookComponents/book-controls";
import BookImage from "../bookComponents/book-image";
import BookTimeSlider from "../bookComponents/book-time-slider";

type UtilityAction = {
  href: "/player-rate" | "/player-bookmarks" | "/player-sleep-timer";
  icon: string;
  label: string;
};

const actions: UtilityAction[] = [
  { href: "/player-rate", icon: "hare.fill", label: "Rate" },
  { href: "/player-bookmarks", icon: "bookmark.fill", label: "Bookmarks" },
  { href: "/player-sleep-timer", icon: "powersleep", label: "Sleep timer" },
];

const MainPlayerScreen = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId ?? undefined);
  const hasLoadedBook = usePlaybackStore(
    (state) => Boolean(state.libraryItemId) && state.queue.length > 0,
  );
  const { data: bookData, isLoading } = useGetItemDetails(currentLibraryItemId);

  const metadata = bookData?.media?.metadata;
  const authorFromList = metadata?.authors
    ?.map((author) => author.name)
    .filter(Boolean)
    .join(", ");
  const resolvedAuthorName = metadata?.authorName ?? authorFromList ?? bookData?.author ?? "";
  const authorName = resolvedAuthorName.trim().length > 0 ? resolvedAuthorName : "Unknown author";
  const title = bookData?.title ?? "No book selected";
  const coverURL = bookData?.coverUri ?? bookData?.coverFull ?? bookData?.cover;
  const chapters = bookData?.media?.chapters ?? [];
  const fallbackDurationMs = Math.max(
    0,
    Math.round((bookData?.media?.duration ?? bookData?.duration ?? 0) * 1000),
  );

  const artworkSize = useMemo(() => {
    const usableHeight = height - insets.top - insets.bottom;
    const maxByHeight = Math.floor(usableHeight * 0.32);
    return Math.min(width - 72, Math.max(170, Math.min(300, maxByHeight)));
  }, [height, insets.bottom, insets.top, width]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: Math.max(14, insets.bottom + 8),
          gap: 12,
        }}
      >
        <View
          style={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", gap: 10 }}
        >
          <BookImage coverURL={coverURL} maxSize={artworkSize} />
          <View style={{ paddingHorizontal: 10, alignItems: "center", gap: 4 }}>
            <Text
              numberOfLines={2}
              selectable
              style={{
                fontSize: 20,
                fontWeight: "700",
                color: themeColors.text,
                textAlign: "center",
              }}
            >
              {title}
            </Text>
            <Text
              numberOfLines={1}
              selectable
              style={{ fontSize: 15, color: themeColors.textMuted, textAlign: "center" }}
            >
              by {authorName}
            </Text>
            {isLoading ? (
              <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
                Loading details...
              </Text>
            ) : null}
            {!hasLoadedBook ? (
              <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
                Start playback from Home to load a book.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <BookTimeSlider
            libraryItemId={currentLibraryItemId}
            fallbackDurationMs={fallbackDurationMs}
            chapters={chapters}
          />
          <BookControls libraryItemId={currentLibraryItemId} />
        </View>

        <View
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 18,
            borderCurve: "continuous",
            backgroundColor: themeColors.surface,
            borderWidth: 1,
            borderColor: themeColors.border,
            boxShadow: "0 10px 18px rgba(15, 23, 42, 0.08)",
          }}
        >
          <View className="flex-row justify-between items-center">
            {actions.map((action) => (
              <Link key={action.href} href={action.href} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    minWidth: 86,
                    paddingVertical: 4,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      borderCurve: "continuous",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: themeColors.bg,
                    }}
                  >
                    <SymbolView name={action.icon} size={35} tintColor={themeColors.accent} />
                  </View>
                  {/* <Text selectable style={{ fontSize: 10, color: themeColors.text }}>
                    {action.label}
                  </Text> */}
                </Pressable>
              </Link>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

export default MainPlayerScreen;
