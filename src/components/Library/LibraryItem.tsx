import { LibraryItemSummary } from "@/api/library-items-api";
import { CoverImage } from "@/components/images/cover-image";
import { useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  libraryItem: LibraryItemSummary;
};
const LibraryItem = ({ libraryItem }: Props) => {
  const themeColors = useThemeColors();
  const localCoverUri = useDeviceBooksStore(
    (state) => state.downloadedBookData[libraryItem.id]?.coverLocalUri ?? null,
  );

  return (
    <View className="border-hairline border-accent bg-surface px-2 my-1 pt-3 pb-2">
      <Link href={`/(tabs)/search/${libraryItem.id}`}>
        <View className="flex-row items-center gap-2 ">
          <CoverImage
            libraryItemId={libraryItem.id}
            coverUri={libraryItem.cover}
            localCoverUri={localCoverUri}
            variant="thumb"
            style={{
              width: 100,
              height: 100,
              borderRadius: 15,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: themeColors.border,
            }}
          />
          <View className="flex-col items-start justify-between flex-1">
            <Text
              numberOfLines={1}
              className="text-base font-semibold text-text"
              lineBreakMode="tail"
            >
              {libraryItem.title}
            </Text>
            <Text numberOfLines={1} className="text-base text-text-muted" lineBreakMode="tail">
              by {libraryItem.author}
            </Text>
            <View className="flex-row justify-between items-center w-full mt-1">
              <View className="flex-row gap-1 items-center">
                <SymbolView name="hourglass" tintColor={themeColors.textMuted} size={16} />
                <Text numberOfLines={1} className="text-sm text-text-muted" lineBreakMode="tail">
                  {formatSeconds(libraryItem.duration)}
                </Text>
              </View>
              <View className="flex-row gap-1 items-center">
                <SymbolView name="calendar" tintColor={themeColors.textMuted} size={16} />
                <Text className="text-text-muted">{libraryItem.publishedYear}</Text>
              </View>
            </View>
          </View>
        </View>
      </Link>
    </View>
  );
};

export default LibraryItem;
