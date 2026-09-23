import { AssistantBridgeModule } from "@/native/assistant";
import { useSearchSessionStore } from "@/search/search-session-store";
import { router } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { schedulePendingDeliveryRetries } from "./assistant-pending-retry";
import {
  resolveAssistantSearchDelivery,
  shouldTakeAssistantSearch,
} from "./assistant-search-destination";

type UseAssistantSearchNavigationOptions = {
  canNavigate: boolean;
  currentUserId: string | null;
  activeLibraryId: string | null;
  isAuthenticated: boolean;
};

type DeliveryInputs = Omit<UseAssistantSearchNavigationOptions, "canNavigate">;

const deliverAssistantSearch = (inputs: DeliveryInputs) => {
  const delivery = resolveAssistantSearchDelivery({
    pending: AssistantBridgeModule.peekPendingSearch(),
    ...inputs,
  });
  if (shouldTakeAssistantSearch(delivery)) {
    AssistantBridgeModule.takePendingSearch();
  }
  if (delivery.kind === "navigate") {
    useSearchSessionStore.getState().actions.setSearchText(delivery.search.query);
    router.navigate("/(tabs)/search");
  }
  return delivery.kind !== "none" && delivery.kind !== "wait";
};

export const useAssistantSearchNavigation = ({
  canNavigate,
  currentUserId,
  activeLibraryId,
  isAuthenticated,
}: UseAssistantSearchNavigationOptions) => {
  useEffect(() => {
    if (!canNavigate) return;
    const inputs = { currentUserId, activeLibraryId, isAuthenticated };
    const tryDeliver = () => deliverAssistantSearch(inputs);
    let cancelActiveRetries = () => {};
    const cancelMountRetries = schedulePendingDeliveryRetries(tryDeliver);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      cancelActiveRetries();
      cancelActiveRetries = schedulePendingDeliveryRetries(tryDeliver);
    });
    return () => {
      cancelMountRetries();
      cancelActiveRetries();
      appState.remove();
    };
  }, [activeLibraryId, canNavigate, currentUserId, isAuthenticated]);
};
