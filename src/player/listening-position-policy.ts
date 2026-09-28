/** Ordering checks are independent from transport state and position filtering. */
export type ListeningPositionOrder = {
  playbackGeneration?: number | null;
  positionRevision?: number | null;
  positionSequence?: number | null;
};

export const isStaleListeningPositionEvent = (
  current: ListeningPositionOrder,
  incoming: ListeningPositionOrder,
) => {
  if (current.playbackGeneration != null && incoming.playbackGeneration != null) {
    if (incoming.playbackGeneration !== current.playbackGeneration) {
      return incoming.playbackGeneration < current.playbackGeneration;
    }
  }
  if (current.positionRevision != null && incoming.positionRevision != null) {
    if (incoming.positionRevision !== current.positionRevision) {
      return incoming.positionRevision < current.positionRevision;
    }
  }
  return current.positionSequence != null && incoming.positionSequence != null &&
    incoming.positionSequence < current.positionSequence;
};

export const resolveConfirmedLoadPosition = (
  result: { positionMs: number } | void,
  requestedPositionMs: number,
) => result && Number.isFinite(result.positionMs)
  ? Math.max(0, result.positionMs)
  : Math.max(0, requestedPositionMs);

export const resolveNativeResumePosition = (payload: {
  fallbackPositionMs: number;
  nativePositionMs: number;
  nativeSequence: number;
  syncedThroughSequence: number;
  pendingExplicitPositionMs?: number | null;
}) => {
  // Explicit user intent must not be defeated by a historical high-water mark.
  if (payload.pendingExplicitPositionMs != null) return payload.pendingExplicitPositionMs;
  if (payload.nativeSequence > payload.syncedThroughSequence) return payload.nativePositionMs;
  return Math.max(payload.fallbackPositionMs, payload.nativePositionMs);
};
