import { BookshelfDetailScreen } from "@/components/Home/bookshelf/bookshelf-detail-screen";
import { PodcastEpisodeShelfDetailScreen } from "@/components/podcast/podcast-episode-shelf-detail-screen";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { useLocalSearchParams } from "expo-router";
import React from "react";

const BookshelfDetailRoute = () => {
  const { shelfId } = useLocalSearchParams<{ shelfId?: string | string[] }>();
  const normalizedShelfId = Array.isArray(shelfId) ? shelfId[0] : shelfId;
  const experience = useActiveLibraryExperience();

  return experience === "podcast" ? (
    <PodcastEpisodeShelfDetailScreen shelfId={normalizedShelfId ?? ""} />
  ) : (
    <BookshelfDetailScreen shelfId={normalizedShelfId ?? ""} />
  );
};

export default BookshelfDetailRoute;
