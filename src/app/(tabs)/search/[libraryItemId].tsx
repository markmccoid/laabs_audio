import BookContainer from "@/components/bookComponents/BookContainer";
import { useLocalSearchParams } from "expo-router";
import React from "react";

const SearchItem = () => {
  const { libraryItemId } = useLocalSearchParams<{ libraryItemId: string }>();

  return (
    <>
      <BookContainer libraryItemId={libraryItemId} />
    </>
  );
};

export default SearchItem;
