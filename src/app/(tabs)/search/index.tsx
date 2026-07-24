import { useAuthStore } from "@/auth/auth-store";
import LibraryContainer from "@/components/Library/LibraryContainer";
import { SearchFilterRail } from "@/components/Library/search-filter-rail";
import { PodcastSearchContainer } from "@/components/podcast/podcast-search-container";
import { isPodcastLibraryMediaType } from "@/podcast/series-index-readiness";
import { resolveActiveLibraryMediaType } from "@/podcast/resolve-active-library-media-type";
import { useSearchSessionActions } from "@/search/search-session-store";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";

const SEARCH_COMMIT_DELAY_MS = 300;

export default function SearchIndex() {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryMediaType = useAuthStore((state) => state.activeLibraryMediaType);
  const mediaType = resolveActiveLibraryMediaType(activeLibraryId, activeLibraryMediaType);
  const isPodcast = isPodcastLibraryMediaType(mediaType);
  const searchActions = useSearchSessionActions();
  const searchCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSearchActive, setIsSearchActive] = useState(false);

  useEffect(() => {
    if (status === "authenticated") return;
    router.replace("/(tabs)/(home)");
  }, [status]);

  useEffect(
    () => () => {
      if (searchCommitTimeoutRef.current) {
        clearTimeout(searchCommitTimeoutRef.current);
      }
    },
    [],
  );

  const commitSearchText = (value: string) => {
    if (searchCommitTimeoutRef.current) {
      clearTimeout(searchCommitTimeoutRef.current);
    }
    searchCommitTimeoutRef.current = setTimeout(() => {
      searchActions.setSearchText(value);
    }, SEARCH_COMMIT_DELAY_MS);
  };

  if (status !== "authenticated") {
    return null;
  }

  return (
    <>
      <Stack.Screen.Title>Search</Stack.Screen.Title>
      <Stack.SearchBar
        placement="automatic"
        placeholder="Search"
        onOpen={() => setIsSearchActive(true)}
        onFocus={() => setIsSearchActive(true)}
        onClose={() => setIsSearchActive(false)}
        onCancelButtonPress={() => setIsSearchActive(false)}
        onChangeText={(e) => {
          commitSearchText(e.nativeEvent.text);
        }}
      />

      {isPodcast ? (
        <PodcastSearchContainer padForStatusBar={isSearchActive} />
      ) : (
        <>
          <LibraryContainer padForStatusBar={isSearchActive} />
          <SearchFilterRail />
        </>
      )}
    </>
  );
}
