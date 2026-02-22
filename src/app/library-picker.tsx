import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { useLibrarySelection } from "../hooks/use-library-selection";
import { useThemeColors } from "../theme/use-app-theme";

export default function LibraryPickerScreen() {
  const { libraries, isLoading, isError, refetch, activeLibraryId, selectLibrary } =
    useLibrarySelection();
  const themeColors = useThemeColors();
  const showEmptyState = !libraries.length && !isLoading && !isError;

  const handleSelect = (id: string) => {
    const selected = libraries.find((library) => library.id === id);
    if (selected) {
      selectLibrary(selected);
    }
    setTimeout(() => router.back(), 750);
  };

  return (
    <FlatList
      data={libraries}
      keyExtractor={(library) => library.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: themeColors.bg }}
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}
      showsVerticalScrollIndicator
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      ListHeaderComponent={
        isError ? (
          <View className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-900">Unable to load libraries</Text>
            <Pressable
              onPress={() => refetch()}
              className="mt-3 self-start rounded-full bg-amber-900 px-3 py-1"
            >
              <Text className="text-xs font-semibold text-white">Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View className="border-b border-border px-6 pb-4 pt-5">
            <View className="flex-row items-center justify-between">
              <Text className="text-2xl font-semibold text-text">Choose library</Text>
              <Pressable onPress={() => router.back()} className="rounded-full bg-surface px-3 py-1">
                <Text className="text-sm text-text-muted">Close</Text>
              </Pressable>
            </View>
            <Text className="mt-2 text-sm text-text-muted">
              Select the library you want to browse.
            </Text>
          </View>
        )
      }
      ListHeaderComponentStyle={isError ? { marginBottom: 12 } : undefined}
      ListEmptyComponent={
        showEmptyState ? (
          <Text className="text-sm text-text-muted">No libraries available.</Text>
        ) : null
      }
      renderItem={({ item }) => {
        const isActive = item.id === activeLibraryId;
        return (
          <Pressable
            onPress={() => handleSelect(item.id)}
            className={
              isActive
                ? "rounded-2xl border border-accent bg-accent px-4 py-3"
                : "rounded-2xl border border-border bg-surface px-4 py-3"
            }
          >
            <Text
              className={
                isActive
                  ? "text-base font-semibold text-accent-foreground"
                  : "text-base font-semibold text-text"
              }
            >
              {item.name}
            </Text>
            <Text
              className={
                isActive ? "mt-1 text-xs text-accent-foreground/85" : "mt-1 text-xs text-text-muted"
              }
            >
              {item.mediaType} • {item.icon || item.provider}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
