import {
  CATALOG_SORT_OPTIONS,
  type CatalogSortBy,
  type CatalogSortDirection,
} from "@/sort/catalog-sort";
import { Menu, Picker, Text } from "@expo/ui/swift-ui";
import { labelStyle, tag, tint, type BuiltInModifier } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";

type CatalogSortMenuProps = {
  sortedBy: CatalogSortBy;
  sortDirection: CatalogSortDirection;
  onSortByChange: (value: CatalogSortBy) => void;
  onSortDirectionChange: (value: CatalogSortDirection) => void;
};

type SwiftUICatalogSortMenuProps = CatalogSortMenuProps & {
  presentation: "swift-ui";
  modifiers: BuiltInModifier[];
  tintColor: string;
};

type ToolbarCatalogSortMenuProps = CatalogSortMenuProps & {
  presentation: "toolbar";
};

type Props = SwiftUICatalogSortMenuProps | ToolbarCatalogSortMenuProps;

const SORT_MENU_ICON = "line.3.horizontal.decrease";

export const CatalogSortMenu = (props: Props) => {
  if (props.presentation === "toolbar") {
    return (
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu icon={SORT_MENU_ICON} title="Sort">
          <Stack.Toolbar.Menu title="Sort by">
            {CATALOG_SORT_OPTIONS.map((option) => (
              <Stack.Toolbar.MenuAction
                key={option.value}
                isOn={props.sortedBy === option.value}
                onPress={() => props.onSortByChange(option.value)}
              >
                {option.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.Menu title="Direction">
            <Stack.Toolbar.MenuAction
              isOn={props.sortDirection === "asc"}
              onPress={() => props.onSortDirectionChange("asc")}
            >
              Ascending
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              isOn={props.sortDirection === "desc"}
              onPress={() => props.onSortDirectionChange("desc")}
            >
              Descending
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    );
  }

  return (
    <Menu
      label="Sort"
      systemImage={SORT_MENU_ICON}
      modifiers={[...props.modifiers, labelStyle("iconOnly"), tint(props.tintColor)]}
    >
      <Picker
        label="Sort by"
        selection={props.sortedBy}
        onSelectionChange={(selection) => props.onSortByChange(selection as CatalogSortBy)}
      >
        {CATALOG_SORT_OPTIONS.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
      <Picker
        label="Direction"
        selection={props.sortDirection}
        onSelectionChange={(selection) =>
          props.onSortDirectionChange(selection as CatalogSortDirection)
        }
      >
        <Text modifiers={[tag("asc")]}>Ascending</Text>
        <Text modifiers={[tag("desc")]}>Descending</Text>
      </Picker>
    </Menu>
  );
};
