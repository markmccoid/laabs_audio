import { authStore, selectAccessMode, type AccessMode, type AuthState } from "@/auth/auth-store";
import { AssistantBridgeModule } from "@/native/assistant";
import { defaultDatabaseDirectory } from "expo-sqlite";

const SHADOW_DATABASE_NAME = "laabs-shadow-library.db";

export type AssistantRuntimeContext = {
  dbPath: string;
  userId: string | null;
  libraryId: string | null;
  accessMode: AccessMode;
  canAttemptStreaming: boolean;
};

const databasePath = () =>
  `${String(defaultDatabaseDirectory).replace(/\/$/, "")}/${SHADOW_DATABASE_NAME}`;

export const resolveAssistantUserId = (state: AuthState): string | null => {
  const accessMode = selectAccessMode(state);
  if (state.activeLibraryUserKey) return state.activeLibraryUserKey;
  if (accessMode === "downloadedSessionOnly") return state.storedUserId;
  return null;
};

export const createAssistantRuntimeContext = (
  state: AuthState = authStore.getState(),
): AssistantRuntimeContext => ({
  dbPath: databasePath(),
  userId: resolveAssistantUserId(state),
  libraryId: state.activeLibraryId?.trim() || null,
  accessMode: selectAccessMode(state),
  canAttemptStreaming:
    state.status === "authenticated" &&
    Boolean(state.activeLibraryUserKey && (state.accessToken || state.refreshToken)),
});

export const publishAssistantRuntimeContext = () => {
  AssistantBridgeModule.publishRuntimeContext(createAssistantRuntimeContext());
};

export const shouldRefreshAssistantSurfacesForLibraryChange = (
  previous: Pick<AssistantRuntimeContext, "userId" | "libraryId">,
  next: Pick<AssistantRuntimeContext, "userId" | "libraryId">,
) => Boolean(next.userId && next.libraryId && next.libraryId !== previous.libraryId);

const refreshAssistantSurfaces = (userId: string) => {
  void AssistantBridgeModule.refreshSuggestedBooks().catch((error) => {
    if (__DEV__) console.warn("[assistant] library-change-shortcut-refresh-failed", { error });
  });
  void AssistantBridgeModule.reindexSpotlight(userId).catch((error) => {
    if (__DEV__) console.warn("[assistant] library-change-spotlight-reindex-failed", { error });
  });
};

export const startAssistantRuntimeContextSubscription = (): (() => void) => {
  let publishedContext = createAssistantRuntimeContext();
  let published = JSON.stringify(publishedContext);
  AssistantBridgeModule.publishRuntimeContext(publishedContext);

  return authStore.subscribe((state) => {
    const nextContext = createAssistantRuntimeContext(state);
    const next = JSON.stringify(nextContext);
    if (next === published) return;
    const previousContext = publishedContext;
    published = next;
    publishedContext = nextContext;
    AssistantBridgeModule.publishRuntimeContext(nextContext);
    if (
      nextContext.userId &&
      shouldRefreshAssistantSurfacesForLibraryChange(previousContext, nextContext)
    ) {
      refreshAssistantSurfaces(nextContext.userId);
    }
  });
};
