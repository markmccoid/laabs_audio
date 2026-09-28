import { NativeModules, Platform } from "react-native";
import {
  nativeListeningPosition,
  NativeListeningPositionUnavailableError,
  type ListeningPositionRecord,
} from "./native-listening-position";

const scope = {
  ownerId: "listener-a",
  libraryItemId: "book-a",
  episodeId: null,
};
const record: ListeningPositionRecord = {
  ...scope,
  schemaVersion: 1,
  playbackGeneration: 4,
  positionRevision: 2,
  sequence: 18,
  positionMs: 2_700_000,
  trackPositionMs: 2_700_000,
  trackStartOffsetMs: 0,
  trackIdentity: "track-a",
  durationMs: 3_600_000,
  isFinished: false,
  reason: "interruption",
  capturedAt: 1,
  committedAt: 2,
  projectedThroughSequence: 0,
  syncedThroughSequence: 0,
};
let originalBridge: unknown;
let originalPlatform: string;

beforeEach(() => {
  originalBridge = NativeModules.AudioPro;
  originalPlatform = Platform.OS;
  NativeModules.AudioPro = {
    getListeningPosition: jest.fn(async () => record),
    getPlaybackSnapshot: jest.fn(async () => ({
      state: "PAUSED",
      position: record.positionMs,
      initialSeekPending: false,
    })),
    checkpointListeningPosition: jest.fn(async () => record),
    setListeningPosition: jest.fn(async () => record),
    acknowledgeListeningPosition: jest.fn(async (payload) => ({
      ...record,
      projectedThroughSequence: payload.sequence,
    })),
    getListeningPositionDiagnostics: jest.fn(async () => ({
      failedWriteCount: 0,
    })),
    setListeningPositionCaptureEnabled: jest.fn(async () => undefined),
  };
});
afterEach(() => {
  NativeModules.AudioPro = originalBridge;
  Platform.OS = originalPlatform as typeof Platform.OS;
});

it("reads the durable record using frozen listener and episode identity", async () => {
  expect(nativeListeningPosition.capability()).toBe("native");
  expect(await nativeListeningPosition.get(scope)).toEqual(record);
  expect(NativeModules.AudioPro.getListeningPosition).toHaveBeenCalledWith(
    scope,
  );
});
it("rejects another listener's receipt rather than projecting it", async () => {
  NativeModules.AudioPro.getListeningPosition.mockResolvedValue({
    ...record,
    ownerId: "listener-b",
  });
  await expect(nativeListeningPosition.get(scope)).rejects.toThrow(
    "incorrectly scoped",
  );
});
it("preserves the record after sequence acknowledgement", async () => {
  const result = await nativeListeningPosition.acknowledge(
    scope,
    18,
    "projected",
  );
  expect(result?.positionMs).toBe(2_700_000);
  expect(
    NativeModules.AudioPro.acknowledgeListeningPosition,
  ).toHaveBeenCalledWith({ ...scope, sequence: 18, kind: "projected" });
});
it("exposes missing native support and failed commits", async () => {
  delete NativeModules.AudioPro.getListeningPosition;
  expect(nativeListeningPosition.capability()).toBe("unavailable");
  await expect(nativeListeningPosition.get(scope)).rejects.toBeInstanceOf(
    NativeListeningPositionUnavailableError,
  );
  NativeModules.AudioPro.setListeningPosition.mockRejectedValue(
    new Error("disk full"),
  );
  await expect(
    nativeListeningPosition.set({
      ...scope,
      positionMs: 180_000,
      durationMs: 3_600_000,
      isFinished: false,
      reason: "unread",
    }),
  ).rejects.toThrow("disk full");
});
it("explicitly advertises narrower web durability without native receipts", async () => {
  Platform.OS = "web";
  expect(nativeListeningPosition.capability()).toBe("web");
  expect(await nativeListeningPosition.get(scope)).toBeNull();
  expect(await nativeListeningPosition.snapshot()).toBeNull();
  expect(await nativeListeningPosition.diagnostics()).toEqual({
    capability: "web",
    durableNativeCapture: false,
  });
  expect(NativeModules.AudioPro.getListeningPosition).not.toHaveBeenCalled();
});
it("rejects malformed commands before storage and supports preview capture boundaries", async () => {
  await expect(
    nativeListeningPosition.set({
      ...scope,
      positionMs: NaN,
      durationMs: 100,
      isFinished: false,
      reason: "seek",
    }),
  ).rejects.toThrow("finite");
  expect(NativeModules.AudioPro.setListeningPosition).not.toHaveBeenCalled();
  await nativeListeningPosition.capture(false);
  expect(
    NativeModules.AudioPro.setListeningPositionCaptureEnabled,
  ).toHaveBeenCalledWith(false);
});
