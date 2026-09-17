import { clearAssistantCatalog } from "@/data/sqlite/assistant-catalog-writes";
import { Platform } from "react-native";
import { subscribeAssistantCatalogChanged } from "./assistant-catalog-events";

const getNativeBridge = async () => {
  if (Platform.OS !== "ios") return null;
  const { AssistantBridgeModule } = await import("@/native/assistant");
  return AssistantBridgeModule;
};

export const clearAssistantSurfaceContent = async (): Promise<void> => {
  await clearAssistantCatalog();
  try {
    await (await getNativeBridge())?.clearSpotlightIndex();
  } catch (error) {
    if (__DEV__) console.warn("[assistant] spotlight-clear-failed", { error });
  }
};

export const startAssistantCatalogNativeSync = (): (() => void) => {
  let shortcutTimer: ReturnType<typeof setTimeout> | null = null;
  let spotlightTimer: ReturnType<typeof setTimeout> | null = null;
  let latestUserId: string | null = null;

  const unsubscribe = subscribeAssistantCatalogChanged((event) => {
    latestUserId = event.userId;
    if (shortcutTimer) clearTimeout(shortcutTimer);
    if (spotlightTimer) clearTimeout(spotlightTimer);

    if (event.reason === "cleared" && event.userId === null) {
      void (async () => {
        try {
          await (await getNativeBridge())?.clearSpotlightIndex();
        } catch (error) {
          if (__DEV__) console.warn("[assistant] native-catalog-sync-failed", { error });
        }
      })();
      return;
    }

    shortcutTimer = setTimeout(() => {
      shortcutTimer = null;
      void getNativeBridge()
        .then((bridge) => bridge?.refreshSuggestedBooks())
        .catch((error) => {
          if (__DEV__) console.warn("[assistant] shortcut-refresh-failed", { error });
        });
    }, 2_000);

    spotlightTimer = setTimeout(() => {
      spotlightTimer = null;
      void getNativeBridge()
        .then((bridge) => bridge?.reindexSpotlight(latestUserId))
        .catch((error) => {
          if (__DEV__) console.warn("[assistant] spotlight-reindex-failed", { error });
        });
    }, 5_000);
  });

  return () => {
    unsubscribe();
    if (shortcutTimer) clearTimeout(shortcutTimer);
    if (spotlightTimer) clearTimeout(spotlightTimer);
  };
};
