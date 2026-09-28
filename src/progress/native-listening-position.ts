import { NativeModules, Platform } from "react-native";
import type {
  ListeningContext,
  ListeningPositionCommand,
  ListeningPositionRecord,
  ListeningPositionScope,
  PlaybackSnapshot,
} from "react-native-audio-pro";

export type {
  ListeningContext,
  ListeningPositionCommand,
  ListeningPositionRecord,
  ListeningPositionScope,
  PlaybackSnapshot,
};

export class NativeListeningPositionUnavailableError extends Error {
  constructor(method: string) {
    super(
      `Native listening position capability unavailable (${method}). Rebuild the native app.`,
    );
    this.name = "NativeListeningPositionUnavailableError";
  }
}

type ListeningPositionBridge = {
  getListeningPosition(
    scope: ListeningPositionScope,
  ): Promise<ListeningPositionRecord | null>;
  getPlaybackSnapshot(): Promise<PlaybackSnapshot>;
  checkpointListeningPosition(
    reason: string,
  ): Promise<ListeningPositionRecord | null>;
  setListeningPosition(
    payload: ListeningPositionCommand,
  ): Promise<ListeningPositionRecord>;
  acknowledgeListeningPosition(
    payload: ListeningPositionScope & {
      sequence: number;
      kind: "projected" | "synced";
    },
  ): Promise<ListeningPositionRecord | null>;
  getListeningPositionDiagnostics(): Promise<Record<string, unknown>>;
  setListeningPositionCaptureEnabled(enabled: boolean): Promise<void>;
};

const requiredMethods: (keyof ListeningPositionBridge)[] = [
  "getListeningPosition",
  "getPlaybackSnapshot",
  "checkpointListeningPosition",
  "setListeningPosition",
  "acknowledgeListeningPosition",
  "getListeningPositionDiagnostics",
  "setListeningPositionCaptureEnabled",
];

function bridgeMethod<K extends keyof ListeningPositionBridge>(
  name: K,
): ListeningPositionBridge[K] {
  const bridge = NativeModules.AudioPro as ListeningPositionBridge | undefined;
  const method = bridge?.[name];
  if (typeof method !== "function")
    throw new NativeListeningPositionUnavailableError(name);
  return method.bind(bridge) as ListeningPositionBridge[K];
}

function validateScope(scope: ListeningPositionScope) {
  if (
    !scope.ownerId ||
    !scope.libraryItemId ||
    (scope.episodeId !== null && typeof scope.episodeId !== "string")
  ) {
    throw new Error(
      "A listening position requires its frozen owner and playable identity.",
    );
  }
}

export function listeningScopesMatch(
  a: ListeningPositionScope,
  b: ListeningPositionScope,
) {
  return (
    a.ownerId === b.ownerId &&
    a.libraryItemId === b.libraryItemId &&
    a.episodeId === b.episodeId
  );
}

function validateRecord(
  record: ListeningPositionRecord | null,
  scope?: ListeningPositionScope,
) {
  if (record === null) return null;
  if (
    !record ||
    (scope && !listeningScopesMatch(record, scope)) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !Number.isSafeInteger(record.positionRevision) ||
    record.positionRevision < 0 ||
    !Number.isSafeInteger(record.playbackGeneration) ||
    record.playbackGeneration < 0 ||
    !Number.isFinite(record.positionMs) ||
    record.positionMs < 0 ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0 ||
    record.schemaVersion !== 1
  ) {
    throw new Error(
      "Native listening position returned an invalid or incorrectly scoped receipt.",
    );
  }
  return record;
}

/** Missing native methods are errors; web callers retain their existing projection persistence. */
export const nativeListeningPosition = {
  capability(): "native" | "web" | "unavailable" {
    if (Platform.OS === "web") return "web";
    const bridge = NativeModules.AudioPro;
    return requiredMethods.every((name) => typeof bridge?.[name] === "function")
      ? "native"
      : "unavailable";
  },
  async get(scope: ListeningPositionScope) {
    validateScope(scope);
    if (Platform.OS === "web") return null;
    return validateRecord(
      await bridgeMethod("getListeningPosition")(scope),
      scope,
    );
  },
  async snapshot(): Promise<PlaybackSnapshot | null> {
    if (Platform.OS === "web") return null;
    const snapshot = await bridgeMethod("getPlaybackSnapshot")();
    if (
      !snapshot ||
      !Number.isFinite(snapshot.position) ||
      snapshot.position < 0 ||
      !Number.isFinite(snapshot.duration) ||
      snapshot.duration < 0 ||
      typeof snapshot.initialSeekPending !== "boolean"
    ) {
      throw new Error("Native playback snapshot is invalid.");
    }
    return snapshot;
  },
  async checkpoint(reason: string) {
    if (Platform.OS === "web") return null;
    return validateRecord(
      await bridgeMethod("checkpointListeningPosition")(reason),
    );
  },
  async set(payload: ListeningPositionCommand) {
    validateScope(payload);
    if (
      !Number.isFinite(payload.positionMs) ||
      payload.positionMs < 0 ||
      !Number.isFinite(payload.durationMs) ||
      payload.durationMs < 0
    ) {
      throw new Error(
        "Listening position commands require finite nonnegative positions and durations.",
      );
    }
    if (Platform.OS === "web") return null;
    return validateRecord(
      await bridgeMethod("setListeningPosition")(payload),
      payload,
    );
  },
  async acknowledge(
    scope: ListeningPositionScope,
    sequence: number,
    kind: "projected" | "synced",
  ) {
    validateScope(scope);
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new Error("Invalid acknowledgement sequence.");
    if (Platform.OS === "web") return null;
    return validateRecord(
      await bridgeMethod("acknowledgeListeningPosition")({
        ...scope,
        sequence,
        kind,
      }),
      scope,
    );
  },
  async capture(enabled: boolean) {
    if (Platform.OS === "web") return;
    await bridgeMethod("setListeningPositionCaptureEnabled")(enabled);
  },
  async diagnostics() {
    if (Platform.OS === "web")
      return { capability: "web", durableNativeCapture: false };
    return bridgeMethod("getListeningPositionDiagnostics")();
  },
};
