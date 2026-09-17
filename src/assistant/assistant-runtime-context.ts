import { authStore, selectAccessMode, type AccessMode, type AuthState } from "@/auth/auth-store";
import { AssistantBridgeModule } from "@/native/assistant";
import { defaultDatabaseDirectory } from "expo-sqlite";

const SHADOW_DATABASE_NAME = "laabs-shadow-library.db";

export type AssistantRuntimeContext = {
  dbPath: string;
  userId: string | null;
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
  accessMode: selectAccessMode(state),
  canAttemptStreaming:
    state.status === "authenticated" &&
    Boolean(state.activeLibraryUserKey && (state.accessToken || state.refreshToken)),
});

export const publishAssistantRuntimeContext = () => {
  AssistantBridgeModule.publishRuntimeContext(createAssistantRuntimeContext());
};

export const startAssistantRuntimeContextSubscription = (): (() => void) => {
  let published = JSON.stringify(createAssistantRuntimeContext());
  AssistantBridgeModule.publishRuntimeContext(JSON.parse(published) as AssistantRuntimeContext);

  return authStore.subscribe((state) => {
    const nextContext = createAssistantRuntimeContext(state);
    const next = JSON.stringify(nextContext);
    if (next === published) return;
    published = next;
    AssistantBridgeModule.publishRuntimeContext(nextContext);
  });
};
