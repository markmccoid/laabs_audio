import { useSleepTimerStatus } from "@/player";
import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

type MainPlayerActionsBarProps = {
  libraryItemId?: string;
};

type ActionIconButtonProps = {
  icon: string;
  label: string;
  disabled?: boolean;
  onPress: () => void;
  badgeCount?: number;
  isActive?: boolean;
};

const ActionIconButton = ({
  icon,
  label,
  disabled = false,
  onPress,
  badgeCount,
  isActive = false,
}: ActionIconButtonProps) => {
  const themeColors = useThemeColors();
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;
  const badgeLabel = badgeCount && badgeCount > 99 ? "99+" : String(badgeCount ?? 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        justifyContent: "center",
        minWidth: 70,
        paddingVertical: 4,
        opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
      })}
    >
      <View style={{ position: "relative" }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isActive ? themeColors.accent : themeColors.bg,
          }}
        >
          <SymbolView
            name={icon}
            size={35}
            tintColor={isActive ? themeColors.accentForeground : themeColors.accent}
          />
        </View>
        {showBadge ? (
          <View
            style={{
              position: "absolute",
              top: -2,
              right: -1,
              minWidth: 18,
              paddingHorizontal: 5,
              height: 18,
              borderRadius: 9,
              borderCurve: "continuous",
              backgroundColor: themeColors.bg,
              // backgroundColor: themeColors.accent,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: themeColors.accent,
              // borderColor: themeColors.surface,
            }}
          >
            <Text
              selectable
              style={{
                // color: "#ffffff",
                color: themeColors.accent,
                fontSize: 10,
                fontWeight: "700",
                fontVariant: ["tabular-nums"],
              }}
            >
              {badgeLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
};

const MainPlayerActionsBar = ({ libraryItemId }: MainPlayerActionsBarProps) => {
  const themeColors = useThemeColors();
  const { data: userServerState } = useGetUserServerState();
  const sleepTimerStatus = useSleepTimerStatus();

  const bookmarkCount = useMemo(() => {
    if (!libraryItemId) return 0;
    const bookmarksByLibraryItemId =
      userServerState?.bookmarksByLibraryItemId ??
      (
        userServerState as typeof userServerState & {
          bookmarksByBookId?: Record<string, Bookmark[]>;
        }
      )?.bookmarksByBookId ??
      {};

    return bookmarksByLibraryItemId[libraryItemId]?.length ?? 0;
  }, [libraryItemId, userServerState]);

  const openRate = () => {
    router.push("/player-rate");
  };

  const openBookmarks = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-bookmarks",
      params: { libraryItemId },
    });
  };

  const openAddBookmark = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-addbookmark",
      params: { libraryItemId },
    });
  };

  const openSleepTimer = () => {
    router.push("/player-sleep-timer");
  };

  return (
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
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <ActionIconButton icon="hare.fill" label="Rate" onPress={openRate} />
        <ActionIconButton
          icon="bookmark.fill"
          label={
            bookmarkCount > 0 ? `Open bookmarks, ${bookmarkCount} available` : "Open bookmarks"
          }
          onPress={openBookmarks}
          disabled={!libraryItemId}
          badgeCount={bookmarkCount}
        />
        <ActionIconButton
          icon="book.badge.plus.fill"
          label="Add bookmark"
          onPress={openAddBookmark}
          disabled={!libraryItemId}
        />
        <ActionIconButton
          icon="powersleep"
          label={sleepTimerStatus.isActive ? "Sleep timer active" : "Sleep timer"}
          onPress={openSleepTimer}
          isActive={sleepTimerStatus.isActive}
        />
      </View>
    </View>
  );
};

export default MainPlayerActionsBar;
