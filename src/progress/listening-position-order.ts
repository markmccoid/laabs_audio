import type { ListeningPositionScope } from "./native-listening-position";

export type ListeningMutationTicket = {
  scope: ListeningPositionScope;
  updatedAt: number;
  isLatest: () => boolean;
  serialize: <T>(work: () => Promise<T>) => Promise<T>;
};

const latest = new Map<string, number>();
const latestSync = new Map<string, number>();
const tails = new Map<string, Promise<unknown>>();
let nextTicket = 0;
let lastTimestamp = 0;

/** Local commands remain immediate; only their server requests wait for an earlier request. */
function makeTicket(
  scope: ListeningPositionScope,
  isLatest: () => boolean,
): ListeningMutationTicket {
  const key = JSON.stringify([
    scope.ownerId,
    scope.libraryItemId,
    scope.episodeId,
  ]);
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  return {
    scope: { ...scope },
    updatedAt: lastTimestamp,
    isLatest,
    serialize<T>(work: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(work);
      tails.set(key, run);
      void run
        .finally(() => {
          if (tails.get(key) === run) tails.delete(key);
        })
        .catch(() => undefined);
      return run;
    },
  };
}

export function claimListeningMutation(
  scope: ListeningPositionScope,
): ListeningMutationTicket {
  const key = JSON.stringify([
    scope.ownerId,
    scope.libraryItemId,
    scope.episodeId,
  ]);
  const id = ++nextTicket;
  latest.set(key, id);
  return makeTicket(scope, () => latest.get(key) === id);
}

/** Sync requests supersede older requests, but never cancel a pending explicit local command. */
export function claimListeningSync(
  scope: ListeningPositionScope,
): ListeningMutationTicket {
  const key = JSON.stringify([
    scope.ownerId,
    scope.libraryItemId,
    scope.episodeId,
  ]);
  const command = latest.get(key);
  const id = ++nextTicket;
  latestSync.set(key, id);
  return makeTicket(
    scope,
    () => latest.get(key) === command && latestSync.get(key) === id,
  );
}
