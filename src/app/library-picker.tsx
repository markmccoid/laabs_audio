import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { useLibrarySelection } from "../hooks/use-library-selection";

export default function LibraryPickerScreen() {
  const { libraries, isLoading, isError, refetch, activeLibraryId, selectLibrary } =
    useLibrarySelection();
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
          <View className="px-6 pt-5 pb-4 border-b border-neutral-100">
            <View className="flex-row items-center justify-between">
              <Text className="text-2xl font-semibold text-neutral-900">Choose library</Text>
              <Pressable
                onPress={() => router.back()}
                className="rounded-full bg-neutral-100 px-3 py-1"
              >
                <Text className="text-sm text-neutral-700">Close</Text>
              </Pressable>
            </View>
            <Text className="mt-2 text-sm text-neutral-600">
              Select the library you want to browse.
            </Text>
          </View>
        )
      }
      ListHeaderComponentStyle={isError ? { marginBottom: 12 } : undefined}
      ListEmptyComponent={
        showEmptyState ? (
          <Text className="text-sm text-neutral-600">No libraries available.</Text>
        ) : null
      }
      renderItem={({ item }) => {
        const isActive = item.id === activeLibraryId;
        return (
          <Pressable
            onPress={() => handleSelect(item.id)}
            className={
              isActive
                ? "rounded-2xl border border-neutral-900 bg-neutral-900 px-4 py-3"
                : "rounded-2xl border border-neutral-200 px-4 py-3"
            }
          >
            <Text
              className={
                isActive
                  ? "text-base font-semibold text-white"
                  : "text-base font-semibold text-neutral-900"
              }
            >
              {item.name}
            </Text>
            <Text
              className={
                isActive ? "mt-1 text-xs text-neutral-200" : "mt-1 text-xs text-neutral-500"
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
