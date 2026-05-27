import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { runLibraryActivationSelection } from "../hooks/use-activate-library-selection";
import { useLibrarySelection } from "../hooks/use-library-selection";
import { useThemeColors } from "../theme/use-app-theme";

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export default function LibraryPickerScreen() {
  const { libraries, isLoading, isError, refetch, activeLibraryId } = useLibrarySelection();
  const params = useLocalSearchParams<{ mode?: string; returnToLibraryItemId?: string | string[] }>();
  const themeColors = useThemeColors();
  const [pendingLibraryId, setPendingLibraryId] = useState<string | null>(null);
  const showEmptyState = !libraries.length && !isLoading && !isError;
  const isSetup = params.mode === "setup";
  const returnToLibraryItemId = Array.isArray(params.returnToLibraryItemId)
    ? params.returnToLibraryItemId[0]
    : params.returnToLibraryItemId;

  const handleSelect = (id: string) => {
    const selected = libraries.find((library) => library.id === id);
    if (!selected) return;

    setPendingLibraryId(selected.id);
    requestAnimationFrame(() => {
      void (async () => {
        if (router.canDismiss()) {
          router.dismiss();
        } else {
          router.back();
        }
        await waitForNextFrame();
        await runLibraryActivationSelection(selected, {
          mode: isSetup ? "setup" : "default",
          returnToLibraryItemId,
        });
      })();
    });
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
              {isSetup ? null : (
                <Pressable
                  onPress={() => router.back()}
                  className="rounded-full bg-surface px-3 py-1"
                >
                  <Text className="text-sm text-text-muted">Close</Text>
                </Pressable>
              )}
            </View>
            <Text className="mt-2 text-sm text-text-muted">
              {isSetup
                ? "Select a library to finish signing in."
                : "Select the library you want to browse."}
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
        const isPending = item.id === pendingLibraryId;
        const isActive = !pendingLibraryId && item.id === activeLibraryId;
        const isHighlighted = isPending || isActive;
        return (
          <Pressable
            onPress={() => handleSelect(item.id)}
            disabled={Boolean(pendingLibraryId)}
            className={
              isHighlighted
                ? "rounded-2xl border border-accent bg-accent px-4 py-3"
                : "rounded-2xl border border-border bg-surface px-4 py-3"
            }
          >
            <View className="relative min-h-10 justify-center">
              <Text
                className={
                  isHighlighted
                    ? "text-base font-semibold text-accent-foreground"
                    : "text-base font-semibold text-text"
                }
              >
                {item.name}
              </Text>
              {isPending ? (
                <View className="absolute inset-0 items-center justify-center">
                  <ActivityIndicator size="small" color={themeColors.accentForeground} />
                </View>
              ) : null}
            </View>
            <Text
              className={
                isHighlighted
                  ? "mt-1 text-xs text-accent-foreground/85"
                  : "mt-1 text-xs text-text-muted"
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
