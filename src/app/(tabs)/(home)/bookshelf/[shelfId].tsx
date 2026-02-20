import { BookshelfDetailScreen } from "@/components/Home/bookshelf/bookshelf-detail-screen";
import { useLocalSearchParams } from "expo-router";
import React from "react";

const BookshelfDetailRoute = () => {
  const { shelfId } = useLocalSearchParams<{ shelfId?: string | string[] }>();
  const normalizedShelfId = Array.isArray(shelfId) ? shelfId[0] : shelfId;

  return <BookshelfDetailScreen shelfId={normalizedShelfId ?? ""} />;
};

export default BookshelfDetailRoute;
