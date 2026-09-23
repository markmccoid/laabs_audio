import { AssistantBridgeModule } from "@/native/assistant";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import {
  peekAssistantOpenInFlight,
  rememberAssistantOpenInFlight,
  resolveAssistantOpenHoldId,
  resolveAssistantOpenLibraryItemId,
} from "./assistant-open-destination";
import { schedulePendingDeliveryRetries } from "./assistant-pending-retry";
import { getBookDetailHref } from "./book-links";

type UseAssistantOpenNavigationOptions = {
  canNavigate: boolean;
};

const peekNativePendingOpen = () =>
  resolveAssistantOpenHoldId({
    pending: AssistantBridgeModule.peekPendingOpen(),
    inFlight: null,
  });

const navigateToAssistantOpen = (libraryItemId: string, consumePending: boolean) => {
  rememberAssistantOpenInFlight(libraryItemId);
  if (consumePending) AssistantBridgeModule.takePendingOpen();
  router.push(getBookDetailHref(libraryItemId));
};

export const useAssistantOpenNavigation = ({
  canNavigate,
}: UseAssistantOpenNavigationOptions) => {
  const lastDeliveredIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canNavigate) return;

    const deliverPending = () => {
      const pending = peekNativePendingOpen();
      if (pending) {
        lastDeliveredIdRef.current = pending;
        navigateToAssistantOpen(pending, true);
        return true;
      }
      const inFlight = peekAssistantOpenInFlight();
      if (!inFlight) return false;
      if (lastDeliveredIdRef.current === inFlight) return true;
      lastDeliveredIdRef.current = inFlight;
      navigateToAssistantOpen(inFlight, false);
      return true;
    };

    const deliverUrl = (url?: string | null) => {
      const libraryItemId = resolveAssistantOpenLibraryItemId({
        url,
        pendingLibraryItemId: peekNativePendingOpen() ?? peekAssistantOpenInFlight(),
      });
      if (!libraryItemId) return;
      lastDeliveredIdRef.current = libraryItemId;
      navigateToAssistantOpen(libraryItemId, Boolean(peekNativePendingOpen()));
    };

    let cancelActiveRetries = () => {};
    const cancelMountRetries = schedulePendingDeliveryRetries(deliverPending);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      cancelActiveRetries();
      cancelActiveRetries = schedulePendingDeliveryRetries(deliverPending);
    });
    const linking = Linking.addEventListener("url", ({ url }) => {
      deliverUrl(url);
    });

    return () => {
      cancelMountRetries();
      cancelActiveRetries();
      appState.remove();
      linking.remove();
    };
  }, [canNavigate]);
};
