import { selectIsBookDownloaded, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

type BookQuickActionsProps = {
  libraryItemId?: string;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const BookQuickActions = ({ libraryItemId }: BookQuickActionsProps) => {
  const themeColors = useThemeColors();
  const downloadProgress = useDeviceBooksStore((state) => state.downloadProgress);
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectIsBookDownloaded(state, libraryItemId);
  });

  const isDownloading = downloadProgress?.libraryItemId === libraryItemId;
  const progressPercent = isDownloading ? clampPercent(downloadProgress?.progress ?? 0) : 0;

  const openBookshelves = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-bookshelves",
      params: { libraryItemId },
    });
  };

  const openDownloads = () => {
    if (!libraryItemId) return;
    router.push({
      pathname: "/book-downloads",
      params: { libraryItemId },
    });
  };

  return (
    <View style={{ width: 60, alignItems: "center", gap: 10 }}>
      <Pressable
        onPress={openBookshelves}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel="Manage custom bookshelves"
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: !libraryItemId ? 0.45 : pressed ? 0.82 : 1,
        })}
      >
        <SymbolView name="books.vertical" tintColor={themeColors.text} size={23} />
      </Pressable>

      <Pressable
        onPress={openDownloads}
        disabled={!libraryItemId}
        accessibilityRole="button"
        accessibilityLabel="Open download options"
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: !libraryItemId ? 0.45 : pressed ? 0.82 : 1,
        })}
      >
        <SymbolView
          name={isDownloaded ? "icloud.fill" : "icloud.and.arrow.down"}
          tintColor={isDownloaded ? themeColors.accent : themeColors.text}
          size={25}
        />
      </Pressable>

      {isDownloading ? (
        <Text
          selectable
          style={{
            color: themeColors.textMuted,
            fontSize: 11,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {progressPercent}%
        </Text>
      ) : null}
    </View>
  );
};
