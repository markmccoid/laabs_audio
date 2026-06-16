import { CoverImage } from "@/components/images/cover-image";
import type { PlaybackControlIntent } from "@/player/playback-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type MiniPlayerBottomAccessoryProps = {
  author?: string | null;
  coverUri?: string | null;
  isLoading: boolean;
  isPlaying: boolean;
  libraryItemId?: string | null;
  localCoverUri?: string | null;
  playbackControlIntent?: PlaybackControlIntent | null;
  themeColors: ReturnType<typeof useThemeColors>;
  title?: string | null;
  onToggle: () => Promise<void>;
};

export function MiniPlayerBottomAccessory({
  author,
  coverUri,
  isLoading,
  isPlaying,
  libraryItemId,
  localCoverUri,
  playbackControlIntent,
  themeColors,
  title,
  onToggle,
}: MiniPlayerBottomAccessoryProps) {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const isInline = placement === "inline";
  const handleOpenMainPlayer = () => {
    router.push("/main-player");
  };

  return (
    <View
      className="flex-row items-center h-full justify-between border-hairline border-gray-400 rounded-full bg-transparent"
      style={[
        styles.accessory,
        isInline ? styles.inlineAccessory : styles.regularAccessory,
        // { backgroundColor: themeColors.surface },
      ]}
    >
      <MiniPlayerOpenButton onPress={handleOpenMainPlayer}>
        <MiniPlayerBookSummary
          author={author}
          coverUri={coverUri}
          isLoading={isLoading}
          libraryItemId={libraryItemId}
          localCoverUri={localCoverUri}
          themeColors={themeColors}
          title={title}
        />
      </MiniPlayerOpenButton>
      <PlayPauseButton
        isLoading={isLoading}
        isPlaying={isPlaying}
        playbackControlIntent={playbackControlIntent}
        themeColors={themeColors}
        onToggle={onToggle}
      />
    </View>
  );
}

type MiniPlayerOpenButtonProps = {
  children: ReactNode;
  onPress: () => void;
};

function MiniPlayerOpenButton({ children, onPress }: MiniPlayerOpenButtonProps) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center flex-row min-w-0">
      {children}
    </Pressable>
  );
}

type MiniPlayerBookSummaryProps = {
  author?: string | null;
  coverUri?: string | null;
  isLoading: boolean;
  libraryItemId?: string | null;
  localCoverUri?: string | null;
  themeColors: ReturnType<typeof useThemeColors>;
  title?: string | null;
};

function MiniPlayerBookSummary({
  author,
  coverUri,
  isLoading,
  libraryItemId,
  localCoverUri,
  themeColors,
  title,
}: MiniPlayerBookSummaryProps) {
  return (
    <View className="flex-row items-center h-full flex-1 min-w-0">
      <CoverImage
        libraryItemId={libraryItemId ?? undefined}
        coverUri={coverUri}
        localCoverUri={localCoverUri}
        variant="thumb"
        style={{
          width: 35,
          height: 35,
          marginRight: 8,
          borderRadius: 8,

          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
        }}
      />

      <View className="flex-col justify-center flex-1 items-start h-full">
        <Text style={{ fontSize: 12, color: themeColors.text }} numberOfLines={1}>
          {title ?? "Starting audiobook"}
        </Text>
        <Text style={{ fontSize: 10, color: themeColors.textMuted }} numberOfLines={1}>
          {isLoading ? "Starting playback..." : `by ${author ?? ""}`}
        </Text>
      </View>
    </View>
  );
}

type PlayPauseButtonProps = {
  isLoading: boolean;
  isPlaying: boolean;
  playbackControlIntent?: PlaybackControlIntent | null;
  themeColors: ReturnType<typeof useThemeColors>;
  onToggle: () => Promise<void>;
};

function PlayPauseButton({
  isLoading,
  isPlaying,
  playbackControlIntent,
  themeColors,
  onToggle,
}: PlayPauseButtonProps) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={Boolean(playbackControlIntent)}
      className="h-full items-center flex-row w-8 justify-center"
      hitSlop={10}
      style={{ opacity: playbackControlIntent ? 0.45 : 1 }}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={themeColors.accent} />
      ) : !isPlaying ? (
        <SymbolView name="play.fill" tintColor={themeColors.accent} />
      ) : (
        <SymbolView name="pause.fill" tintColor={themeColors.accent} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accessory: {
    gap: 8,
    overflow: "hidden",
  },
  regularAccessory: {
    alignSelf: "stretch",
    flex: 1,
    paddingHorizontal: 16,
    width: "100%",
  },
  inlineAccessory: {
    paddingHorizontal: 12,
    width: 240,
  },
});
