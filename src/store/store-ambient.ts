import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  AMBIENT_DOWNLOAD_DIRECTORY,
  isRelativeDocumentPath,
  toDocumentRelativePath,
} from "./fileSystemAccess";
import { mmkvStorage } from "./mmkv-storage";

export const DEFAULT_AMBIENT_VOLUME = 0.2;

export type AmbientPlaybackState = "idle" | "playing" | "paused";

export type AmbientTrackRecord = {
  id: string;
  relativePath: string;
  fileName: string;
  importedAt: number;
  /**
   * Length of the file in ms, learned from the first AMBIENT_PROGRESS event the
   * track produces. 0/undefined until then. Ambient tracks loop, so this is what
   * lets a stored resume position be wrapped back into the file instead of
   * growing without bound across loops.
   */
  durationMs?: number;
};

export type AmbientPlaybackPreferenceRecord = {
  trackId: string;
  positionMs: number;
  volume: number;
  fineVolume: boolean;
};

type PersistedAmbientState = {
  isEnabled: boolean;
  tracksById: Record<string, AmbientTrackRecord>;
  trackOrder: string[];
  ambientPlaybackPreferenceByLibraryItemId: Record<string, AmbientPlaybackPreferenceRecord>;
};

type RuntimeAmbientState = {
  activeTrackId: string | null;
  activeLibraryItemId: string | null;
  playbackState: AmbientPlaybackState;
};

type LegacyAmbientState = Partial<
  PersistedAmbientState & {
    tracksById: Record<string, AmbientTrackRecord & { uri?: string | null; volume?: number }>;
  }
>;

export type AmbientStoreState = PersistedAmbientState &
  RuntimeAmbientState & {
    actions: {
      setEnabled: (enabled: boolean) => void;
      addTrack: (track: AmbientTrackRecord) => void;
      removeTrack: (trackId: string) => void;
      setTrackDurationMs: (trackId: string, durationMs: number) => void;
      setPreferenceVolumeForBook: (libraryItemId: string, volume: number) => void;
      setPreferenceFineVolumeForBook: (libraryItemId: string, fineVolume: boolean) => void;
      attachTrackToBook: (trackId: string, libraryItemId: string) => void;
      detachTrackFromBook: (libraryItemId: string) => void;
      removeTrackFromAllBookAttachments: (trackId: string) => void;
      setResumeStateForBook: (libraryItemId: string, trackId: string, positionMs: number) => void;
      setActiveSession: (
        trackId: string | null,
        libraryItemId: string | null,
        playbackState: AmbientPlaybackState,
      ) => void;
      clearActiveSession: () => void;
      setPlaybackState: (state: AmbientPlaybackState) => void;
    };
  };

const clampAmbientVolume = (value: number) => Math.max(0, Math.min(1, value));
const clampAmbientPosition = (value: number) => Math.max(0, Math.round(value));

/**
 * Fold a position back into a looping track. A position beyond the end is not a
 * position at all — it is elapsed listening time, which is what the old wall
 * clock estimator produced (a 45 minute bed reporting 3:00:00 after 4 loops).
 */
export const wrapAmbientPositionMs = (value: number, durationMs?: number | null) => {
  const positionMs = clampAmbientPosition(value);
  if (!durationMs || durationMs <= 0) return positionMs;
  return positionMs % Math.round(durationMs);
};

const extractFileNameFromUri = (uri: string) => {
  const normalized = uri.split(/[?#]/, 1)[0] ?? uri;
  const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
};

const toLegacyAmbientRelativePath = (storedPath?: string | null) => {
  const normalized = storedPath?.trim();
  if (!normalized) return null;

  const relativeFromUri = toDocumentRelativePath(normalized);
  if (relativeFromUri) {
    return relativeFromUri;
  }

  if (isRelativeDocumentPath(normalized)) {
    if (normalized.startsWith(`${AMBIENT_DOWNLOAD_DIRECTORY}/`)) {
      return normalized;
    }
    const fileName = extractFileNameFromUri(normalized);
    return fileName ? `${AMBIENT_DOWNLOAD_DIRECTORY}/${fileName}` : null;
  }

  const fileName = extractFileNameFromUri(normalized);
  return fileName ? `${AMBIENT_DOWNLOAD_DIRECTORY}/${fileName}` : null;
};

const getBasePersistedState = (): PersistedAmbientState => ({
  isEnabled: false,
  tracksById: {},
  trackOrder: [],
  ambientPlaybackPreferenceByLibraryItemId: {},
});

const getBaseRuntimeState = (): RuntimeAmbientState => ({
  activeTrackId: null,
  activeLibraryItemId: null,
  playbackState: "idle",
});

const normalizePersistedAmbientTracks = (tracksById: unknown) => {
  if (!tracksById || typeof tracksById !== "object") {
    return {} as Record<string, AmbientTrackRecord>;
  }

  const nextTracksById: Record<string, AmbientTrackRecord> = {};

  Object.entries(tracksById).forEach(([trackId, value]) => {
    if (!value || typeof value !== "object") return;

    const candidate = value as Partial<AmbientTrackRecord> & { uri?: string | null };
    const relativePath =
      typeof candidate.relativePath === "string" && isRelativeDocumentPath(candidate.relativePath)
        ? candidate.relativePath
        : toLegacyAmbientRelativePath(candidate.uri);

    if (!relativePath) return;

    nextTracksById[trackId] = {
      id: typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id : trackId,
      relativePath,
      fileName:
        typeof candidate.fileName === "string" && candidate.fileName.trim().length > 0
          ? candidate.fileName
          : "Ambient Track",
      importedAt: typeof candidate.importedAt === "number" ? candidate.importedAt : 0,
      durationMs:
        typeof candidate.durationMs === "number" && candidate.durationMs > 0
          ? clampAmbientPosition(candidate.durationMs)
          : undefined,
    };
  });

  return nextTracksById;
};

const normalizeTrackOrder = (trackOrder: unknown, tracksById: Record<string, AmbientTrackRecord>) => {
  const validTrackIds = new Set(Object.keys(tracksById));
  const orderedTrackIds = Array.isArray(trackOrder)
    ? trackOrder.filter(
        (trackId): trackId is string => typeof trackId === "string" && validTrackIds.has(trackId),
      )
    : [];
  const remainingTrackIds = Object.keys(tracksById).filter((trackId) => !orderedTrackIds.includes(trackId));
  return [...orderedTrackIds, ...remainingTrackIds];
};

const normalizeAmbientPlaybackPreferences = (
  preferences: unknown,
  tracksById: Record<string, AmbientTrackRecord>,
) => {
  const validTrackIds = new Set(Object.keys(tracksById));
  const nextPreferences: Record<string, AmbientPlaybackPreferenceRecord> = {};

  if (!preferences || typeof preferences !== "object") {
    return nextPreferences;
  }

  Object.entries(preferences).forEach(([libraryItemId, value]) => {
    if (typeof libraryItemId !== "string" || libraryItemId.trim().length === 0) return;
    if (!value || typeof value !== "object") return;

    const candidate = value as Partial<AmbientPlaybackPreferenceRecord>;
    if (typeof candidate.trackId !== "string" || !validTrackIds.has(candidate.trackId)) return;
    const fineVolume = typeof candidate.fineVolume === "boolean" ? candidate.fineVolume : false;

    nextPreferences[libraryItemId] = {
      trackId: candidate.trackId,
      // Builds before ambient position came from the player stored elapsed
      // listening time here, which can be many loops past the end of the file.
      positionMs: wrapAmbientPositionMs(
        typeof candidate.positionMs === "number" ? candidate.positionMs : 0,
        tracksById[candidate.trackId]?.durationMs,
      ),
      volume: Math.min(
        fineVolume ? 0.5 : 1,
        clampAmbientVolume(
          typeof candidate.volume === "number" ? candidate.volume : DEFAULT_AMBIENT_VOLUME,
        ),
      ),
      fineVolume,
    };
  });

  return nextPreferences;
};

export const ambientStore = createStore<AmbientStoreState>()(
  persist(
    (set) => ({
      ...getBasePersistedState(),
      ...getBaseRuntimeState(),
      actions: {
        setEnabled: (isEnabled) =>
          set((state) => {
            if (state.isEnabled === isEnabled) return state;
            return { isEnabled };
          }),
        addTrack: (track) =>
          set((state) => {
            const exists = Boolean(state.tracksById[track.id]);
            return {
              tracksById: {
                ...state.tracksById,
                [track.id]: track,
              },
              trackOrder: exists ? state.trackOrder : [track.id, ...state.trackOrder],
            };
          }),
        removeTrack: (trackId) =>
          set((state) => {
            if (!state.tracksById[trackId]) return state;

            const nextTracksById = { ...state.tracksById };
            delete nextTracksById[trackId];
            const isActiveTrack = state.activeTrackId === trackId;

            return {
              tracksById: nextTracksById,
              trackOrder: state.trackOrder.filter((candidateId) => candidateId !== trackId),
              activeTrackId: isActiveTrack ? null : state.activeTrackId,
              activeLibraryItemId: isActiveTrack ? null : state.activeLibraryItemId,
              playbackState: isActiveTrack ? "idle" : state.playbackState,
            };
          }),
        setTrackDurationMs: (trackId, durationMs) =>
          set((state) => {
            const track = state.tracksById[trackId];
            if (!track) return state;

            const nextDurationMs = clampAmbientPosition(durationMs);
            if (nextDurationMs <= 0 || track.durationMs === nextDurationMs) return state;

            return {
              tracksById: {
                ...state.tracksById,
                [trackId]: { ...track, durationMs: nextDurationMs },
              },
            };
          }),
        setPreferenceVolumeForBook: (libraryItemId, volume) =>
          set((state) => {
            if (!libraryItemId.trim()) return state;
            const existingPreference = state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId];
            if (!existingPreference) return state;

            const nextPreference = {
              ...existingPreference,
              volume: Math.min(existingPreference.fineVolume ? 0.5 : 1, clampAmbientVolume(volume)),
            };

            if (existingPreference.volume === nextPreference.volume) return state;

            return {
              ambientPlaybackPreferenceByLibraryItemId: {
                ...state.ambientPlaybackPreferenceByLibraryItemId,
                [libraryItemId]: nextPreference,
              },
            };
          }),
        setPreferenceFineVolumeForBook: (libraryItemId, fineVolume) =>
          set((state) => {
            if (!libraryItemId.trim()) return state;
            const existingPreference = state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId];
            if (!existingPreference) return state;

            const nextPreference = {
              ...existingPreference,
              fineVolume,
              volume: fineVolume ? Math.min(existingPreference.volume, 0.5) : existingPreference.volume,
            };

            if (
              existingPreference.fineVolume === nextPreference.fineVolume &&
              existingPreference.volume === nextPreference.volume
            ) {
              return state;
            }

            return {
              ambientPlaybackPreferenceByLibraryItemId: {
                ...state.ambientPlaybackPreferenceByLibraryItemId,
                [libraryItemId]: nextPreference,
              },
            };
          }),
        attachTrackToBook: (trackId, libraryItemId) =>
          set((state) => {
            if (!state.tracksById[trackId]) return state;
            if (!libraryItemId.trim()) return state;
            const existingPreference = state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId];
            if (existingPreference?.trackId === trackId) return state;

            return {
              ambientPlaybackPreferenceByLibraryItemId: {
                ...state.ambientPlaybackPreferenceByLibraryItemId,
                [libraryItemId]: {
                  trackId,
                  positionMs: 0,
                  volume: existingPreference?.volume ?? DEFAULT_AMBIENT_VOLUME,
                  fineVolume: existingPreference?.fineVolume ?? false,
                },
              },
            };
          }),
        detachTrackFromBook: (libraryItemId) =>
          set((state) => {
            if (!state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId]) return state;

            const nextPreferences = { ...state.ambientPlaybackPreferenceByLibraryItemId };
            delete nextPreferences[libraryItemId];
            const isActiveBook = state.activeLibraryItemId === libraryItemId;

            return {
              ambientPlaybackPreferenceByLibraryItemId: nextPreferences,
              activeTrackId: isActiveBook ? null : state.activeTrackId,
              activeLibraryItemId: isActiveBook ? null : state.activeLibraryItemId,
              playbackState: isActiveBook ? "idle" : state.playbackState,
            };
          }),
        removeTrackFromAllBookAttachments: (trackId) =>
          set((state) => {
            const nextPreferences = Object.fromEntries(
              Object.entries(state.ambientPlaybackPreferenceByLibraryItemId).filter(
                ([, preference]) => preference.trackId !== trackId,
              ),
            );
            const isActiveTrack = state.activeTrackId === trackId;

            if (
              Object.keys(nextPreferences).length ===
                Object.keys(state.ambientPlaybackPreferenceByLibraryItemId).length &&
              !isActiveTrack
            ) {
              return state;
            }

            return {
              ambientPlaybackPreferenceByLibraryItemId: nextPreferences,
              activeTrackId: isActiveTrack ? null : state.activeTrackId,
              activeLibraryItemId: isActiveTrack ? null : state.activeLibraryItemId,
              playbackState: isActiveTrack ? "idle" : state.playbackState,
            };
          }),
        setResumeStateForBook: (libraryItemId, trackId, positionMs) =>
          set((state) => {
            if (!libraryItemId.trim()) return state;
            const existingPreference = state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId];
            if (existingPreference?.trackId !== trackId) return state;
            if (!state.tracksById[trackId]) return state;

            const nextPreference = {
              ...existingPreference,
              positionMs: clampAmbientPosition(positionMs),
            };

            if (existingPreference.positionMs === nextPreference.positionMs) {
              return state;
            }

            return {
              ambientPlaybackPreferenceByLibraryItemId: {
                ...state.ambientPlaybackPreferenceByLibraryItemId,
                [libraryItemId]: nextPreference,
              },
            };
          }),
        setActiveSession: (activeTrackId, activeLibraryItemId, playbackState) =>
          set((state) => {
            const normalizedTrackId =
              activeTrackId && state.tracksById[activeTrackId] ? activeTrackId : null;
            const normalizedLibraryItemId =
              normalizedTrackId && activeLibraryItemId ? activeLibraryItemId : null;
            const normalizedPlaybackState =
              normalizedTrackId && normalizedLibraryItemId ? playbackState : "idle";

            if (
              state.activeTrackId === normalizedTrackId &&
              state.activeLibraryItemId === normalizedLibraryItemId &&
              state.playbackState === normalizedPlaybackState
            ) {
              return state;
            }

            return {
              activeTrackId: normalizedTrackId,
              activeLibraryItemId: normalizedLibraryItemId,
              playbackState: normalizedPlaybackState,
            };
          }),
        clearActiveSession: () =>
          set((state) => {
            if (
              state.activeTrackId === null &&
              state.activeLibraryItemId === null &&
              state.playbackState === "idle"
            ) {
              return state;
            }

            return {
              activeTrackId: null,
              activeLibraryItemId: null,
              playbackState: "idle",
            };
          }),
        setPlaybackState: (playbackState) =>
          set((state) => {
            if (state.activeTrackId === null || state.activeLibraryItemId === null) {
              if (state.playbackState === "idle") return state;
              return { playbackState: "idle" };
            }
            if (state.playbackState === playbackState) return state;
            return { playbackState };
          }),
      },
    }),
    {
      name: "ambient-store",
      storage: createJSONStorage(() => mmkvStorage),
      version: 4,
      partialize: (state) => ({
        isEnabled: state.isEnabled,
        tracksById: state.tracksById,
        trackOrder: state.trackOrder,
        ambientPlaybackPreferenceByLibraryItemId:
          state.ambientPlaybackPreferenceByLibraryItemId,
      }),
      merge: (persistedState, currentState) => {
        const typedState =
          persistedState && typeof persistedState === "object"
            ? (persistedState as LegacyAmbientState)
            : {};
        const tracksById = normalizePersistedAmbientTracks(typedState.tracksById);
        const trackOrder = normalizeTrackOrder(typedState.trackOrder, tracksById);
        const ambientPlaybackPreferenceByLibraryItemId = normalizeAmbientPlaybackPreferences(
          typedState.ambientPlaybackPreferenceByLibraryItemId,
          tracksById,
        );

        return {
          ...currentState,
          isEnabled: typedState.isEnabled ?? false,
          tracksById,
          trackOrder,
          ambientPlaybackPreferenceByLibraryItemId,
          ...getBaseRuntimeState(),
        };
      },
      migrate: (persistedState) => {
        const typedState =
          persistedState && typeof persistedState === "object"
            ? (persistedState as LegacyAmbientState)
            : {};
        const tracksById = normalizePersistedAmbientTracks(typedState.tracksById);

        return {
          ...getBasePersistedState(),
          isEnabled: typedState.isEnabled ?? false,
          tracksById,
          trackOrder: normalizeTrackOrder(typedState.trackOrder, tracksById),
          ambientPlaybackPreferenceByLibraryItemId: {},
        };
      },
    },
  ),
);

export const useAmbientStore = <T,>(selector: (state: AmbientStoreState) => T) =>
  useStore(ambientStore, selector);

export const useAmbientActions = () => useAmbientStore((state) => state.actions);

export const isAmbientTrackAvailable = (track?: AmbientTrackRecord | null) =>
  Boolean(track?.relativePath && isRelativeDocumentPath(track.relativePath));

export const selectAmbientTracks = (state: AmbientStoreState) =>
  state.trackOrder
    .map((trackId) => state.tracksById[trackId])
    .filter((track): track is AmbientTrackRecord => Boolean(track));

export const selectAvailableAmbientTracks = (state: AmbientStoreState) =>
  selectAmbientTracks(state).filter((track) => isAmbientTrackAvailable(track));

export const selectActiveAmbientTrack = (state: AmbientStoreState) => {
  if (!state.activeTrackId) return null;
  const track = state.tracksById[state.activeTrackId] ?? null;
  return isAmbientTrackAvailable(track) ? track : null;
};

export const selectAttachedAmbientTrackForBook = (
  state: AmbientStoreState,
  libraryItemId?: string | null,
) => {
  if (!libraryItemId) return null;
  const preference = state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId];
  if (!preference) return null;
  const track = state.tracksById[preference.trackId] ?? null;
  return isAmbientTrackAvailable(track) ? track : null;
};

export const selectAmbientPlaybackPreferenceForBook = (
  state: AmbientStoreState,
  libraryItemId?: string | null,
) => {
  if (!libraryItemId) return null;
  const preference = state.ambientPlaybackPreferenceByLibraryItemId[libraryItemId];
  if (!preference) return null;
  if (!state.tracksById[preference.trackId]) return null;
  return preference;
};

export const selectHasAvailableAmbientTracks = (state: AmbientStoreState) =>
  selectAvailableAmbientTracks(state).length > 0;
