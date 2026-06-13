import { usePlaybackRateGesture } from "@/hooks/use-playback-rate-gesture";
import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import { useSleepTimerStatus } from "@/player";
import {
  selectLocalBookmarksForBook,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";

type MainPlayerActionsBarProps = {
  libraryItemId?: string;
};

type ActionIconButtonProps = {
  icon: ComponentProps<typeof SymbolView>["name"];
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

type RateActionButtonProps = {
  libraryItemId?: string;
  onPress: () => void;
};

const RateActionButton = ({ libraryItemId, onPress }: RateActionButtonProps) => {
  const themeColors = useThemeColors();
  const lastGestureStartAtRef = useRef(0);
  const lastGestureFinalizeAtRef = useRef(0);
  const {
    bubbleOffsetY,
    bubbleProgress,
    displayRate,
    dragOffsetX,
    dragOffsetY,
    gesture,
    iconPressed,
    targetLibraryItemId,
  } = usePlaybackRateGesture({
    libraryItemId,
    onGestureStart: () => {
      lastGestureStartAtRef.current = Date.now();
    },
    onGestureFinalize: () => {
      lastGestureFinalizeAtRef.current = Date.now();
    },
  });

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragOffsetX.value },
      { translateY: dragOffsetY.value },
      { scale: interpolate(iconPressed.value, [0, 1], [1, 1.18]) },
    ],
  }));

  const bubbleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: bubbleProgress.value,
    transform: [
      { translateY: interpolate(bubbleProgress.value, [0, 1], [8, -26]) + bubbleOffsetY.value },
      { scale: interpolate(bubbleProgress.value, [0, 1], [0.82, 1]) },
    ],
  }));

  const handlePress = () => {
    const now = Date.now();
    const isGestureStillActive = lastGestureStartAtRef.current > lastGestureFinalizeAtRef.current;
    const justFinishedGesture = now - lastGestureFinalizeAtRef.current < 250;

    if (isGestureStillActive || justFinishedGesture) {
      return;
    }

    onPress();
  };

  return (
    <View style={{ minWidth: 70, alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: -18,
            minWidth: 66,
            borderRadius: 12,
            borderCurve: "continuous",
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: themeColors.accent,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 10px 18px rgba(15, 23, 42, 0.18)",
          },
          bubbleAnimatedStyle,
        ]}
      >
        <Text
          selectable
          style={{
            color: themeColors.accentForeground,
            fontSize: 14,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          }}
        >
          {displayRate.toFixed(2)}x
        </Text>
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <Animated.View style={iconAnimatedStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rate"
            accessibilityHint="Tap to open playback rate controls. Long press and drag up to increase or left to decrease."
            disabled={!targetLibraryItemId}
            onPress={handlePress}
            style={({ pressed }) => ({
              alignItems: "center",
              justifyContent: "center",
              minWidth: 70,
              opacity: !targetLibraryItemId ? 0.45 : pressed ? 0.72 : 1,
            })}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                borderCurve: "continuous",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: themeColors.bg,
              }}
            >
              <SymbolView name="hare.fill" size={35} tintColor={themeColors.accent} />
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>

      <Text
        className="text-text-muted"
        style={{ marginTop: -1, fontSize: 12, fontVariant: ["tabular-nums"] }}
      >
        {displayRate.toFixed(2)}x
      </Text>
    </View>
  );
};

const MainPlayerActionsBar = ({ libraryItemId }: MainPlayerActionsBarProps) => {
  const themeColors = useThemeColors();
  useGetUserServerState();
  const resolvedUserKey = useResolvedListeningOwnerKey(libraryItemId);
  const sleepTimerStatus = useSleepTimerStatus();
  const bookmarkCount = useDeviceBooksStore((state) => {
    if (!libraryItemId) return 0;
    return selectLocalBookmarksForBook(state, libraryItemId, resolvedUserKey).length;
  });

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
        <ActionIconButton
          icon="powersleep"
          label={sleepTimerStatus.isActive ? "Sleep timer active" : "Sleep timer"}
          onPress={openSleepTimer}
          isActive={sleepTimerStatus.isActive}
        />
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
        <RateActionButton libraryItemId={libraryItemId} onPress={openRate} />
      </View>
    </View>
  );
};

export default MainPlayerActionsBar;
