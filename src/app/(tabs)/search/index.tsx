import LibraryContainer from "@/components/Library/LibraryContainer";
import { useFiltersActions } from "@/store/store-filters";
import { Stack } from "expo-router";

export default function SearchIndex() {
  const filterActions = useFiltersActions();
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
        <Stack.Toolbar.Button>
          <Stack.Toolbar.Icon sf="line.3.horizontal" />
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu icon="07.square.fill.hi">
          <Stack.Toolbar.MenuAction>two</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <LibraryContainer />
    </>
  );
}
