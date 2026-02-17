import { useAuthStore } from "@/auth/auth-store";
import { useGetBooks } from "@/hooks/abs-data-hooks";
import { useHeaderHeight } from "@react-navigation/elements";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Link } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";

const LibraryContainer = () => {
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);

  const { data, isLoading, isPending, isError } = useGetBooks();

  if (isLoading || isPending || !data) return null;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["books", activeLibraryId] });
    setRefreshing(false);
  };
  return (
    <FlashList
      // contentInset={{ top: headerHeight }}
      data={data}
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={({ item }) => {
        return (
          <View className="border-hairline p-2">
            <Link href={`/(tabs)/search/${item.id}`}>
              <View className="flex-row items-center">
                <Image source={item.cover} style={{ width: 100, height: 100 }} />
                <Text numberOfLines={1} className="flex-1 text-xs" lineBreakMode="tail">
                  Link to {item.title}
                </Text>
              </View>
            </Link>
          </View>
        );
      }}
    />
  );
};

export default LibraryContainer;
