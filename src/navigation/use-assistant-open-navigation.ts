import { AssistantBridgeModule } from "@/native/assistant";
import * as Linking from "expo-linking";
import {
  router,
  useGlobalSearchParams,
  useRootNavigationState,
  useSegments,
} from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import {
  clearAssistantOpenInFlight,
  peekAssistantOpenInFlight,
  rememberAssistantOpenInFlight,
} from "./assistant-open-destination";
import { extractBookDetailIdFromUrl, getBookDetailHref } from "./book-links";

type UseAssistantOpenNavigationOptions = {
  canNavigate: boolean;
};

export const useAssistantOpenNavigation = ({
  canNavigate,
}: UseAssistantOpenNavigationOptions) => {
  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const params = useGlobalSearchParams<{ libraryItemId?: string | string[] }>();
  const visibleBookId =
    segments[0] === "(tabs)" &&
    segments[segments.length - 1] === "[libraryItemId]"
      ? Array.isArray(params.libraryItemId)
        ? params.libraryItemId[0]
        : params.libraryItemId
      : undefined;
  const navigationReady = Boolean(navigationState?.key) && canNavigate;
  const dispatchedRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!navigationReady) {
      dispatchedRequestIdRef.current = null;
      return;
    }

    const deliverPending = (retryUnconfirmed = false) => {
      // Always read the latest durable request; queued notifications may refer to older requests.
      const request = AssistantBridgeModule.peekPendingOpenRequest();
      if (!request) {
        if (visibleBookId === peekAssistantOpenInFlight())
          clearAssistantOpenInFlight();
        return;
      }
      if (visibleBookId === request.libraryItemId) {
        if (AssistantBridgeModule.acknowledgePendingOpen(request.id)) {
          clearAssistantOpenInFlight();
          dispatchedRequestIdRef.current = null;
        }
        return;
      }
      if (!retryUnconfirmed && dispatchedRequestIdRef.current === request.id)
        return;
      rememberAssistantOpenInFlight(request.libraryItemId);
      dispatchedRequestIdRef.current = request.id;
      // Keep the request in native storage until the destination route actually becomes visible.
      router.push(getBookDetailHref(request.libraryItemId));
    };

    // Subscribe before peeking so a write during startup cannot fall between the two operations.
    const open = AssistantBridgeModule.addListener("onAssistantOpen", () =>
      deliverPending(),
    );
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") deliverPending(true);
    });
    const linking = Linking.addEventListener("url", ({ url }) => {
      const libraryItemId = extractBookDetailIdFromUrl(url);
      if (!libraryItemId) return;
      if (
        AssistantBridgeModule.peekPendingOpenRequest()?.libraryItemId ===
        libraryItemId
      ) {
        deliverPending();
        return;
      }
      if (visibleBookId === libraryItemId) return;
      rememberAssistantOpenInFlight(libraryItemId);
      router.push(getBookDetailHref(libraryItemId));
    });
    deliverPending();

    return () => {
      open.remove();
      appState.remove();
      linking.remove();
    };
  }, [navigationReady, visibleBookId]);
};
