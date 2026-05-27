import {
  useLibraryActivationActions,
  useLibraryActivationStore,
} from "@/auth/library-activation-store";
import { useAuthStore } from "@/auth/auth-store";
import { useActivateLibrarySelection } from "@/hooks/use-activate-library-selection";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";

export const LibraryActivationOverlay = () => {
  const themeColors = useThemeColors();
  const previousActiveLibraryId = useAuthStore((state) => state.activeLibraryId);
  const status = useLibraryActivationStore((state) => state.status);
  const library = useLibraryActivationStore((state) => state.library);
  const errorMessage = useLibraryActivationStore((state) => state.errorMessage);
  const { clear } = useLibraryActivationActions();
  const activateSelection = useActivateLibrarySelection();

  if (status === "idle" || !library) return null;

  const handleRetry = () => {
    void activateSelection(library);
  };

  const handleCancel = () => {
    clear();
    if (!previousActiveLibraryId) {
      router.replace({ pathname: "/library-picker", params: { mode: "setup" } });
    }
  };

  const isFailed = status === "failed";

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
          backgroundColor: themeColors.bg,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 360,
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 16,
            borderCurve: "continuous",
            paddingHorizontal: 20,
            paddingVertical: 22,
            backgroundColor: themeColors.surface,
            alignItems: "center",
          }}
        >
          {isFailed ? null : <ActivityIndicator size="large" color={themeColors.accent} />}
          <Text
            style={{
              marginTop: isFailed ? 0 : 16,
              color: themeColors.text,
              fontSize: 19,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {isFailed ? "Library failed to load" : "Loading library"}
          </Text>
          <Text
            style={{
              marginTop: 8,
              color: themeColors.textMuted,
              fontSize: 14,
              lineHeight: 20,
              textAlign: "center",
            }}
          >
            {isFailed
              ? (errorMessage ?? "Could not load this library.")
              : `Preparing ${library.name} for browsing.`}
          </Text>

          {isFailed ? (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable
                onPress={handleCancel}
                style={{
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: themeColors.surface,
                }}
              >
                <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleRetry}
                style={{
                  borderRadius: 12,
                  borderCurve: "continuous",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: themeColors.accent,
                }}
              >
                <Text
                  style={{ color: themeColors.accentForeground, fontSize: 15, fontWeight: "700" }}
                >
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};
