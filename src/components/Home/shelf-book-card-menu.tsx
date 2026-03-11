import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Alert, Pressable, View } from "react-native";
import {
  type ShelfBookCardMenuProps,
  useShelfBookCardMenuActions,
} from "./shelf-book-card-menu-shared";

export const ShelfBookCardMenu = (props: ShelfBookCardMenuProps) => {
  const themeColors = useThemeColors();
  const {
    continueListeningVisibilityLabel,
    favoriteDisabled,
    favoriteLabel,
    finishedLabel,
    hasContinueListeningVisibilityOption,
    hideDisabled,
    primaryLabel,
    shareDisabled,
    shareLabel,
    handleToggleContinueListeningVisibility,
    handleShareBook,
    handlePrimaryAction,
    handleToggleFavorite,
    handleToggleFinished,
    isBusy,
  } =
    useShelfBookCardMenuActions(props);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Book actions"
        disabled={isBusy}
        onPress={() => {
          Alert.alert(props.book.title, undefined, [
            {
              text: primaryLabel,
              onPress: () => {
                void handlePrimaryAction();
              },
            },
            ...(!favoriteDisabled
              ? [
                  {
                    text: favoriteLabel,
                    onPress: () => {
                      void handleToggleFavorite();
                    },
                  },
                ]
              : []),
            {
              text: finishedLabel,
              onPress: () => {
                void handleToggleFinished();
              },
            },
            ...(!shareDisabled
              ? [
                  {
                    text: shareLabel,
                    onPress: () => {
                      void handleShareBook();
                    },
                  },
                ]
              : []),
            ...(hasContinueListeningVisibilityOption
              ? [
                  {
                    text: continueListeningVisibilityLabel,
                    onPress: () => {
                      void handleToggleContinueListeningVisibility();
                    },
                    style: hideDisabled ? "cancel" : "default",
                  } as const,
                ]
              : []),
            {
              text: "Cancel",
              style: "cancel",
            },
          ]);
        }}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: "rgba(255, 255, 255, 0.35)",
          backgroundColor: "rgba(15, 23, 42, 0.72)",
          alignItems: "center",
          justifyContent: "center",
          opacity: isBusy ? 0.55 : pressed ? 0.82 : 1,
          boxShadow: "0 8px 18px rgba(15, 23, 42, 0.25)",
        })}
      >
        <SymbolView name="ellipsis.circle.fill" size={18} tintColor={themeColors.bg} />
      </Pressable>
    </View>
  );
};
