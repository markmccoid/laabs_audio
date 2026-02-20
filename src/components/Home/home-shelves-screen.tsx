import { type HomeShelf, useHomeShelves } from "@/hooks/use-home-shelves";
import { useThemeColors } from "@/theme/use-app-theme";
import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { HomeShelfSection } from "./home-shelf-section";

const HomeShelvesScreen = () => {
  const themeColors = useThemeColors();
  const { visibleShelves, refreshDiscover } = useHomeShelves();

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="box.truck" />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24, gap: 22 }}
      >
        {visibleShelves.map((shelf: HomeShelf) => (
          <HomeShelfSection
            key={shelf.id}
            title={shelf.title}
            books={shelf.books}
            emptyMessage={shelf.emptyMessage}
            shelfHref={{
              pathname: "/(tabs)/(home)/bookshelf/[shelfId]",
              params: { shelfId: shelf.id },
            }}
            onRefresh={
              shelf.kind === "derived" && shelf.id === "discover" ? refreshDiscover : undefined
            }
          />
        ))}

        <Text
          selectable
          style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 18 }}
        >
          Shelf creation and book assignment are managed in Settings.
        </Text>
      </ScrollView>
    </View>
  );
};

export default HomeShelvesScreen;
