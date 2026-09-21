import { AssistantBridgeModule } from "@/native/assistant";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { resolveAssistantOpenLibraryItemId } from "./assistant-open-destination";
import { getBookDetailHref } from "./book-links";

type UseAssistantOpenNavigationOptions = {
  canNavigate: boolean;
};

const openAssistantDestination = (url?: string | null) => {
  const libraryItemId = resolveAssistantOpenLibraryItemId({
    url,
    pendingLibraryItemId: AssistantBridgeModule.takePendingOpen(),
  });
  if (!libraryItemId) return;
  router.push(getBookDetailHref(libraryItemId));
};

export const useAssistantOpenNavigation = ({
  canNavigate,
}: UseAssistantOpenNavigationOptions) => {
  useEffect(() => {
    if (!canNavigate) return;
    openAssistantDestination();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") openAssistantDestination();
    });
    const linking = Linking.addEventListener("url", ({ url }) => {
      openAssistantDestination(url);
    });
    return () => {
      appState.remove();
      linking.remove();
    };
  }, [canNavigate]);
};
