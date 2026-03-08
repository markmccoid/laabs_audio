import { useAuthStore } from "@/auth/auth-store";
import LibraryContainer from "@/components/Library/LibraryContainer";
import { useFiltersActions, useSortDirection, useSortedBy } from "@/store/store-filters";
import { router, Stack } from "expo-router";
import { useEffect } from "react";

export default function SearchIndex() {
  const status = useAuthStore((state) => state.status);
  const filterActions = useFiltersActions();
  const sortedBy = useSortedBy();
  const sortDirection = useSortDirection();

  useEffect(() => {
    if (status === "authenticated") return;
    router.replace("/(tabs)/(home)");
  }, [status]);

  if (status !== "authenticated") {
    return null;
  }

  return (
    <>
      <Stack.Screen.Title>Search</Stack.Screen.Title>
      <Stack.SearchBar
        placement="automatic"
        placeholder="Search"
        onChangeText={(e) => {
          filterActions.setSearchValue(e.nativeEvent.text);
        }}
      />

      <Stack.Toolbar placement="right">
        {/* Sort menu */}
        <Stack.Toolbar.Menu icon="line.3.horizontal.decrease" title="">
          <Stack.Toolbar.Menu palette inline title="Direction">
            <Stack.Toolbar.MenuAction
              icon="arrow.up"
              isOn={sortDirection === "asc"}
              onPress={() => filterActions.setSortDirection("asc")}
            />
            <Stack.Toolbar.MenuAction
              icon="arrow.down"
              isOn={sortDirection === "desc"}
              onPress={() => filterActions.setSortDirection("desc")}
            />
          </Stack.Toolbar.Menu>

          {/* <Stack.Toolbar.Menu
            icon={sortDirection === "asc" ? "arrow.up" : "arrow.down"}
            title="Direction"
          >
            <Stack.Toolbar.MenuAction
              icon="arrow.up"
              onPress={() => filterActions.setSortDirection("asc")}
            >
              Ascending
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="arrow.down"
              onPress={() => filterActions.setSortDirection("desc")}
            >
              Descending
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu> */}
          <Stack.Toolbar.Badge>{sortDirection === "asc" ? "↑" : "↓"}</Stack.Toolbar.Badge>
          {/* Author */}
          <Stack.Toolbar.MenuAction
            onPress={() => filterActions.setSortedBy("author")}
            isOn={sortedBy === "author"}
          >
            <Stack.Toolbar.Icon sf="person" />
            <Stack.Toolbar.Label>Author</Stack.Toolbar.Label>
          </Stack.Toolbar.MenuAction>
          {/* Title */}
          <Stack.Toolbar.MenuAction
            onPress={() => filterActions.setSortedBy("title")}
            isOn={sortedBy === "title"}
          >
            <Stack.Toolbar.Icon sf="book" />
            <Stack.Toolbar.Label>Title</Stack.Toolbar.Label>
          </Stack.Toolbar.MenuAction>
          {/* Added Date */}
          <Stack.Toolbar.MenuAction
            onPress={() => filterActions.setSortedBy("addedAt")}
            isOn={sortedBy === "addedAt"}
          >
            <Stack.Toolbar.Icon sf="calendar.badge.plus" />
            <Stack.Toolbar.Label>Added At</Stack.Toolbar.Label>
          </Stack.Toolbar.MenuAction>
          {/* Duration */}
          <Stack.Toolbar.MenuAction
            onPress={() => filterActions.setSortedBy("duration")}
            isOn={sortedBy === "duration"}
          >
            <Stack.Toolbar.Icon sf="clock" />
            <Stack.Toolbar.Label>Duration</Stack.Toolbar.Label>
          </Stack.Toolbar.MenuAction>
          {/* Published Year */}
          <Stack.Toolbar.MenuAction
            onPress={() => filterActions.setSortedBy("publishedYear")}
            isOn={sortedBy === "publishedYear"}
          >
            <Stack.Toolbar.Icon sf="calendar" />
            <Stack.Toolbar.Label>Published</Stack.Toolbar.Label>
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <LibraryContainer />
    </>
  );
}
