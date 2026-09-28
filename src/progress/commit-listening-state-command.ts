import { authStore } from "@/auth/auth-store";
import { resolveListeningOwnerKey } from "@/auth/listening-owner";
import {
  nativeListeningPosition,
  type ListeningPositionRecord,
} from "./native-listening-position";
import {
  claimListeningMutation,
  type ListeningMutationTicket,
} from "./listening-position-order";

export type ConfirmedListeningStateCommand = {
  ownerId: string;
  record: ListeningPositionRecord | null;
  ticket: ListeningMutationTicket;
  serverUrl: string | null;
  activeSessionKey: string | null;
  isRouteCurrent: () => boolean;
};

/** Unread/finished are committed local state changes, including for books not currently loaded. */
export async function commitListeningStateCommand(payload: {
  libraryItemId: string;
  positionMs: number;
  durationMs: number;
  isFinished: boolean;
  reason: "mark_read" | "mark_unread";
}): Promise<ConfirmedListeningStateCommand> {
  const ownerId = resolveListeningOwnerKey(payload.libraryItemId);
  if (!ownerId)
    throw new Error("Unable to resolve the listener for this progress change.");
  const auth = authStore.getState();
  const scope = {
    ownerId,
    libraryItemId: payload.libraryItemId,
    episodeId: null,
  };
  const ticket = claimListeningMutation(scope);
  const commandId = `listening-state-${ticket.updatedAt}-${Math.random().toString(36).slice(2)}`;
  const record = await nativeListeningPosition.set({
    ...scope,
    ...payload,
    commandId,
  });
  return {
    ownerId,
    record,
    ticket,
    serverUrl: auth.serverUrl,
    activeSessionKey: auth.activeSessionKey,
    isRouteCurrent: () => {
      const current = authStore.getState();
      return (
        resolveListeningOwnerKey(payload.libraryItemId) === ownerId &&
        current.serverUrl === auth.serverUrl &&
        current.activeSessionKey === auth.activeSessionKey
      );
    },
  };
}
