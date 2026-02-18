import { LibraryItemSummary } from "@/api/library-items-api";
import { formatSeconds } from "@/utils/formatUtils";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  libraryItem: LibraryItemSummary;
};
const LibraryItem = ({ libraryItem }: Props) => {
  return (
    <View className="border-hairline p-2">
      <Link href={`/(tabs)/search/${libraryItem.id}`}>
        <View className="flex-row items-center gap-2 ">
          <Image
            source={libraryItem.cover}
            style={{
              width: 100,
              height: 100,
              borderRadius: 15,
              borderWidth: StyleSheet.hairlineWidth,
            }}
          />
          <View className="flex-col items-start justify-between flex-1">
            <Text numberOfLines={1} className="text-base font-semibold" lineBreakMode="tail">
              {libraryItem.title}
            </Text>
            <Text numberOfLines={1} className="text-base" lineBreakMode="tail">
              by {libraryItem.author}
            </Text>
            <View className="flex-row justify-between items-center w-full mt-1">
              <View className="flex-row gap-1 items-center">
                <SymbolView name="hourglass" tintColor={"black"} size={16} />
                <Text numberOfLines={1} className="text-sm" lineBreakMode="tail">
                  {formatSeconds(libraryItem.duration)}
                </Text>
              </View>
              <View className="flex-row gap-1 items-center">
                <SymbolView name="calendar" tintColor={"black"} size={16} />
                <Text>{libraryItem.publishedYear}</Text>
              </View>
            </View>
          </View>
        </View>
      </Link>
    </View>
  );
};

export default LibraryItem;
