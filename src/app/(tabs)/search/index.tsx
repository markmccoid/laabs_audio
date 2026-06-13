import { useAuthStore } from "@/auth/auth-store";
import LibraryContainer from "@/components/Library/LibraryContainer";
import { SearchFilterRail } from "@/components/Library/search-filter-rail";
import { useSearchSessionActions } from "@/search/search-session-store";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";

const SEARCH_COMMIT_DELAY_MS = 300;

export default function SearchIndex() {
  const status = useAuthStore((state) => state.status);
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

      <LibraryContainer padForStatusBar={isSearchActive} />
      <SearchFilterRail />
    </>
  );
}
