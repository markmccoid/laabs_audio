import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import type { Href } from "expo-router";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { memo, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

const COVER_SIZE = 72;
const GRID_GAP = 12;
const GRID_HORIZONTAL_PADDING = 16;

type PodcastShowsBrowserProps = {
  shows: readonly PodcastSeriesIndexSummary[];
  isLoading: boolean;
  viewMode: "list" | "grid";
  emptyMessage: string;
  detailHref: (libraryItemId: string) => Href;
};

const episodeCountLabel = (count: number | null | undefined) => {
  if (count == null) return null;
  return `${count} ${count === 1 ? "episode" : "episodes"}`;
};

const PodcastShowRow = memo(function PodcastShowRow({
  show,
  detailHref,
}: {
  show: PodcastSeriesIndexSummary;
  detailHref: (libraryItemId: string) => Href;
}) {
  const themeColors = useThemeColors();
  const subtitle = episodeCountLabel(show.numEpisodes);
  const onPress = useCallback(() => {
    router.push(detailHref(show.id));
  }, [detailHref, show.id]);

  return (
    <Pressable
      accessibilityLabel={show.title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: themeColors.border,
          opacity: pressed ? 0.72 : 1,
          backgroundColor: themeColors.surface,
        },
      ]}
    >
      <CoverImage
        libraryItemId={show.id}
        coverUri={show.cover}
        variant="thumb"
        style={{
          width: COVER_SIZE,
          height: COVER_SIZE,
          borderRadius: 10,
          backgroundColor: themeColors.bg,
        }}
      />
      <View style={styles.rowDetails}>
        <Text
          maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          numberOfLines={2}
          selectable
          style={[styles.title, { color: themeColors.text }]}
        >
          {show.title}
        </Text>
        {show.author ? (
          <Text
            maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            numberOfLines={1}
            style={{ color: themeColors.textMuted, fontSize: 13 }}
          >
            {show.author}
          </Text>
        ) : null}
        {subtitle ? (
          <Text
            maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            numberOfLines={1}
            style={{ color: themeColors.textMuted, fontSize: 12, marginTop: 2 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <SymbolView name="chevron.right" size={15} tintColor={themeColors.textMuted} />
    </Pressable>
  );
});

const PodcastShowGridItem = memo(function PodcastShowGridItem({
  show,
  coverSize,
  detailHref,
}: {
  show: PodcastSeriesIndexSummary;
  coverSize: number;
  detailHref: (libraryItemId: string) => Href;
}) {
  const themeColors = useThemeColors();
  const onPress = useCallback(() => {
    router.push(detailHref(show.id));
  }, [detailHref, show.id]);

  return (
    <Pressable
      accessibilityLabel={show.title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.gridItem, { opacity: pressed ? 0.72 : 1, width: coverSize }]}
    >
      <CoverImage
        libraryItemId={show.id}
        coverUri={show.cover}
        variant="thumb"
        style={{
          width: coverSize,
          height: coverSize,
          borderRadius: 12,
          backgroundColor: themeColors.bg,
        }}
      />
      <Text
        maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        numberOfLines={2}
        style={[styles.gridTitle, { color: themeColors.text }]}
      >
        {show.title}
      </Text>
    </Pressable>
  );
});

export const PodcastShowsBrowser = ({
  shows,
  isLoading,
  viewMode,
  emptyMessage,
  detailHref,
}: PodcastShowsBrowserProps) => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const gridColumns = width >= 700 ? 4 : 3;
  const coverSize = useMemo(() => {
    const available = width - GRID_HORIZONTAL_PADDING * 2 - GRID_GAP * (gridColumns - 1);
    return Math.floor(available / gridColumns);
  }, [gridColumns, width]);

  if (isLoading && shows.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={themeColors.accent} />
      </View>
    );
  }

  if (shows.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: themeColors.textMuted, textAlign: "center", paddingHorizontal: 24 }}>
          {emptyMessage}
        </Text>
      </View>
    );
  }

  if (viewMode === "grid") {
    return (
      <FlashList
        data={[...shows]}
        keyExtractor={(item) => item.id}
        numColumns={gridColumns}
        contentContainerStyle={{ paddingHorizontal: GRID_HORIZONTAL_PADDING, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <PodcastShowGridItem show={item} coverSize={coverSize} detailHref={detailHref} />
        )}
      />
    );
  }

  return (
    <FlashList
      data={[...shows]}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ paddingVertical: 4 }}
      ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
      renderItem={({ item }) => <PodcastShowRow show={item} detailHref={detailHref} />}
    />
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  rowDetails: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  gridItem: {
    marginBottom: GRID_GAP,
  },
  gridTitle: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "600",
  },
});
