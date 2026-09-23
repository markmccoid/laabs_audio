import { useAuthStore } from "@/auth/auth-store";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import LibraryContainer from "@/components/Library/LibraryContainer";
import { SearchFilterRail } from "@/components/Library/search-filter-rail";
import { PodcastSearchContainer } from "@/components/podcast/podcast-search-container";
import { useSearchSessionActions, useSearchText } from "@/search/search-session-store";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { SearchBarCommands } from "react-native-screens";

const SEARCH_COMMIT_DELAY_MS = 300;

export default function SearchIndex() {
  const status = useAuthStore((state) => state.status);
  const experience = useActiveLibraryExperience();
  const searchActions = useSearchSessionActions();
  const searchText = useSearchText();
  const searchCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBarRef = useRef<SearchBarCommands | null>(null);
  const lastLocallyCommittedTextRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!searchText || lastLocallyCommittedTextRef.current === searchText) return;
    lastLocallyCommittedTextRef.current = searchText;
    setIsSearchActive(true);
    const applyText = () => {
      const bar = searchBarRef.current;
      if (!bar) return false;
      bar.setText(searchText);
      return true;
    };
    if (applyText()) return;
    const frameId = requestAnimationFrame(() => {
      applyText();
    });
    return () => cancelAnimationFrame(frameId);
  }, [searchText]);

  const commitSearchText = (value: string) => {
    if (searchCommitTimeoutRef.current) {
      clearTimeout(searchCommitTimeoutRef.current);
    }
    searchCommitTimeoutRef.current = setTimeout(() => {
      lastLocallyCommittedTextRef.current = value;
      searchActions.setSearchText(value);
    }, SEARCH_COMMIT_DELAY_MS);
  };

  if (status !== "authenticated") {
    return null;
  }
  if (experience === "unresolved") return null;

  return (
    <>
      <Stack.Screen.Title>Search</Stack.Screen.Title>
      <Stack.SearchBar
        ref={searchBarRef}
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

      {experience === "podcast" ? (
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
