import { selectIsBookFullyDownloaded, useDeviceBooksStore } from "@/store/device-books-store";
import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

type BookQuickActionsProps = {
  libraryItemId?: string;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const BookQuickActions = ({ libraryItemId }: BookQuickActionsProps) => {
  const themeColors = useThemeColors();
  const downloadProgress = useDeviceBooksStore((state) => state.downloadProgress);
  const { data: userServerState } = useGetUserServerState();
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectIsBookFullyDownloaded(state, libraryItemId);
  });
  const bookmarks = useMemo(() => {
    const bookmarksByLibraryItemId =
      userServerState?.bookmarksByLibraryItemId ??
      (
        userServerState as typeof userServerState & {
          bookmarksByBookId?: Record<string, Bookmark[]>;
        }
      )?.bookmarksByBookId ??
      {};
    return libraryItemId ? bookmarksByLibraryItemId[libraryItemId] ?? [] : [];
  }, [libraryItemId, userServerState]);

  const isDownloading = downloadProgress?.libraryItemId === libraryItemId;
  const progressPercent = isDownloading ? clampPercent(downloadProgress?.progress ?? 0) : 0;
  const bookmarkCount = bookmarks.length;
  const bookmarkBadgeLabel = bookmarkCount > 99 ? "99+" : String(bookmarkCount);

  const openBookshelves = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-bookshelves",
      params: { libraryItemId },
    });
  };

  const openDownloads = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-downloads",
      params: { libraryItemId },
    });
  };

  const openBookmarks = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-bookmarks",
      params: { libraryItemId },
    });
  };

  return (
    <View style={{ width: 60, alignItems: "center", gap: 10 }}>
      <Pressable
        onPress={openBookshelves}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel="Manage custom bookshelves"
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: !libraryItemId ? 0.45 : pressed ? 0.82 : 1,
        })}
      >
        <SymbolView name="books.vertical" tintColor={themeColors.text} size={23} />
      </Pressable>

      <Pressable
        onPress={openDownloads}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel="Open download options"
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: !libraryItemId ? 0.45 : pressed ? 0.82 : 1,
        })}
      >
        <SymbolView
          name={isDownloaded ? "icloud.fill" : "icloud.and.arrow.down"}
          tintColor={isDownloaded ? themeColors.accent : themeColors.text}
          size={25}
        />
      </Pressable>

      <Pressable
        onPress={openBookmarks}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel={
          bookmarkCount > 0
            ? `Open bookmarks, ${bookmarkCount} available`
            : "Open bookmarks"
        }
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: !libraryItemId ? 0.45 : pressed ? 0.82 : 1,
        })}
      >
        <View style={{ position: "relative" }}>
          <SymbolView
            name="bookmark"
            tintColor={bookmarkCount > 0 ? themeColors.accent : themeColors.text}
            size={22}
          />
          {bookmarkCount > 0 ? (
            <View
              style={{
                position: "absolute",
                top: -6,
                right: -12,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                borderCurve: "continuous",
                paddingHorizontal: 4,
                backgroundColor: themeColors.accent,
                borderWidth: 1,
                borderColor: themeColors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                selectable
                style={{
                  color: themeColors.accentForeground,
                  fontSize: 10,
                  fontWeight: "700",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {bookmarkBadgeLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {isDownloading ? (
        <Text
          selectable
          style={{
            color: themeColors.textMuted,
            fontSize: 11,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {progressPercent}%
        </Text>
      ) : null}
    </View>
  );
};
