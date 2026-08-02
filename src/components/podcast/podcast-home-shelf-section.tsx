import type { PodcastSeriesIndexSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, Text, View } from "react-native";

type Props = {
  title: string;
  podcasts: readonly PodcastSeriesIndexSummary[];
  emptyMessage: string;
  shelfHref: Href;
};

export const PodcastHomeShelfSection = ({
  title,
  podcasts,
  emptyMessage,
  shelfHref,
}: Props) => {
  const colors = useThemeColors();
  return (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 5 }}>
        <View style={{ flex: 1, minWidth: 0, marginRight: 8, paddingLeft: 16 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}
          >
            {title}
          </Text>
        </View>
        <Link href={shelfHref} asChild>
          <Pressable
            hitSlop={12}
            style={{
              width: 52,
              height: 32,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <SymbolView name="chevron.right" tintColor={colors.textMuted} size={14} />
          </Pressable>
        </Link>
      </View>
      {podcasts.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: 13, paddingHorizontal: 18 }}>
          {emptyMessage}
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}
        >
          {podcasts.map((podcast) => (
            <Link
              key={podcast.id}
              href={{
                pathname: "/(tabs)/library/[libraryItemId]",
                params: { libraryItemId: podcast.id },
              }}
              asChild
            >
              <Pressable style={({ pressed }) => ({ width: 144, opacity: pressed ? 0.78 : 1 })}>
                <CoverImage
                  libraryItemId={podcast.id}
                  coverUri={podcast.cover}
                  variant="thumb"
                  style={{
                    width: 144,
                    height: 144,
                    borderRadius: 10,
                    backgroundColor: colors.surface,
                  }}
                />
                <Text
                  numberOfLines={2}
                  style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 7 }}
                >
                  {podcast.title}
                </Text>
              </Pressable>
            </Link>
          ))}
        </ScrollView>
      )}
    </View>
  );
};
