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
import { playbackStore } from "@/player/playback-store";
import {
  clearAssistantOpenInFlight,
  peekAssistantOpenInFlight,
  rememberAssistantOpenInFlight,
} from "./assistant-open-destination";
import { extractBookDetailIdFromUrl, getBookDetailHref } from "./book-links";

// Full-screen player routes. A book link must not stack a detail page on them.
const PLAYER_ROOT_SEGMENTS = new Set(["main-player", "read-along"]);

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
  const playerVisible = PLAYER_ROOT_SEGMENTS.has(segments[0] ?? "");
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
      if (playerVisible) {
        // The player already shows the playing book (a widget tap): leave it up.
        if (playbackStore.getState().libraryItemId === libraryItemId) return;
        // Another book: close the player so its detail opens over the tabs.
        router.dismissAll();
      }
      rememberAssistantOpenInFlight(libraryItemId);
      router.push(getBookDetailHref(libraryItemId));
    });
    deliverPending();

    return () => {
      open.remove();
      appState.remove();
      linking.remove();
    };
  }, [navigationReady, visibleBookId, playerVisible]);
};
