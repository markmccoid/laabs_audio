import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { useAuthStore } from "@/auth/auth-store";
import {
  selectIsAnotherDownloadActive,
  selectIsBookActivelyDownloading,
  selectIsBookFullyDownloaded,
  selectDownloadOwnerUserId,
  selectLocalBookmarksForBook,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { BookDetailRouteSource } from "@/navigation/book-links";
import { router, useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

type BookQuickActionsProps = {
  libraryItemId?: string;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
type DownloadIconProps = {
  isDownloaded: boolean;
  isDownloading: boolean;
  progressPercent: number;
  borderColor: string;
  accentColor: string;
  textColor: string;
};

type DownloadProgressRingProps = {
  progressPercent: number;
  trackColor: string;
  accentColor: string;
};

const DownloadProgressRing = ({
  progressPercent,
  trackColor,
  accentColor,
}: DownloadProgressRingProps) => {
  const clampedPercent = clampPercent(progressPercent);
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clampedPercent / 100) * circumference;

  return (
    <Svg
      pointerEvents="none"
      width={size}
      height={size}
      style={{
        position: "absolute",
        width: size,
        height: size,
      }}
    >
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={trackColor}
        strokeOpacity={0.35}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={accentColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        fill="none"
        rotation={-90}
        originX={size / 2}
        originY={size / 2}
      />
    </Svg>
  );
};

const DownloadQuickActionIcon = ({
  isDownloaded,
  isDownloading,
  progressPercent,
  borderColor,
  accentColor,
  textColor,
}: DownloadIconProps) => {
  return (
    <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
      {isDownloading ? (
        <DownloadProgressRing
          progressPercent={progressPercent}
          trackColor={borderColor}
          accentColor={accentColor}
        />
      ) : null}
      <SymbolView
        name={isDownloaded ? "icloud.fill" : "icloud.and.arrow.down"}
        tintColor={isDownloaded || isDownloading ? accentColor : textColor}
        size={25}
      />
    </View>
  );
};

export const BookQuickActions = ({ libraryItemId }: BookQuickActionsProps) => {
  const themeColors = useThemeColors();
  const segments = useSegments();
  const downloadProgress = useDeviceBooksStore((state) => state.downloadProgress);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUserId = useAuthStore((state) => state.storedUserId);
  useGetUserServerState();
  const downloadOwnerUserId = useDeviceBooksStore((state) =>
    selectDownloadOwnerUserId(state, libraryItemId),
  );
  const resolvedUserKey = activeLibraryUserKey ?? storedUserId ?? downloadOwnerUserId;
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectIsBookFullyDownloaded(state, libraryItemId);
  });
  const isAnotherDownloadActive = useDeviceBooksStore((state) =>
    selectIsAnotherDownloadActive(state, libraryItemId),
  );
  const bookmarkCount = useDeviceBooksStore((state) => {
    if (!libraryItemId) return 0;
    return selectLocalBookmarksForBook(state, libraryItemId, resolvedUserKey).length;
  });

  const isDownloading = useDeviceBooksStore((state) =>
    selectIsBookActivelyDownloading(state, libraryItemId),
  );
  const progressPercent = isDownloading ? clampPercent(downloadProgress?.progress ?? 0) : 0;
  const bookmarkBadgeLabel = bookmarkCount > 99 ? "99+" : String(bookmarkCount);
  const sourceBookRoute: BookDetailRouteSource = segments[1] === "search" ? "search" : "home";

  const openBookshelves = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-bookshelves",
      params: { libraryItemId },
    });
  };

  const openDownloads = () => {
    if (!libraryItemId) return;
    if (isAnotherDownloadActive) return;
    router.push({
      pathname: "/book-downloads",
      params: { libraryItemId, sourceBookRoute },
    });
  };

  const openBookmarks = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-bookmarks",
      params: { libraryItemId },
    });
  };

  const openChapters = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/chapter-viewer",
      params: { libraryItemId },
    });
  };

  return (
    <View style={{ width: 60, alignItems: "center", gap: 10 }}>
      <Pressable
        onPress={openBookshelves}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel="Manage bookshelves"
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
        disabled={!libraryItemId || isAnotherDownloadActive}
        accessibilityRole="button"
        accessibilityLabel={
          isDownloading
            ? "Open active download status"
            : isAnotherDownloadActive
              ? "Another book is downloading"
              : "Open download options"
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
          opacity: !libraryItemId ? 0.45 : isAnotherDownloadActive ? 0.45 : pressed ? 0.82 : 1,
        })}
      >
        <DownloadQuickActionIcon
          isDownloaded={isDownloaded}
          isDownloading={isDownloading}
          progressPercent={progressPercent}
          borderColor={themeColors.border}
          accentColor={themeColors.accent}
          textColor={themeColors.text}
        />
      </Pressable>

      <Pressable
        onPress={openChapters}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel="Open chapter list"
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
        <SymbolView name="list.bullet" tintColor={themeColors.text} size={23} />
      </Pressable>

      <Pressable
        onPress={openBookmarks}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel={
          bookmarkCount > 0 ? `Open bookmarks, ${bookmarkCount} available` : "Open bookmarks"
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
    </View>
  );
};
