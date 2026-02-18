import { useAuthStore } from "@/auth/auth-store";
import { useGetBooks } from "@/hooks/abs-data-hooks";
import { useHeaderHeight } from "@react-navigation/elements";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import LibraryItem from "./LibraryItem";

const LibraryContainer = () => {
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);

  const { data, isLoading, isPending, isError } = useGetBooks();

  if (isLoading || isPending || !data) return null;
  const onRefresh = async () => {
    console.log(
      "All queries:",
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    );
    console.log("ActiveLib", ["books", activeLibraryId]);
    setRefreshing(true);
    await queryClient.refetchQueries({
      queryKey: ["books", activeLibraryId],
      exact: true,
    });
    setRefreshing(false);
  };
  return (
    <FlashList
      // contentInset={{ top: headerHeight }}
      data={data}
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={({ item }) => {
        return <LibraryItem libraryItem={item} />;
      }}
    />
  );
};

export default LibraryContainer;
