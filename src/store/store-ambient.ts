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
  volume: number;
  importedAt: number;
};

export type AmbientResumeStateRecord = {
  trackId: string;
  positionMs: number;
};

type PersistedAmbientState = {
  isEnabled: boolean;
  tracksById: Record<string, AmbientTrackRecord>;
  trackOrder: string[];
  attachedTrackIdByLibraryItemId: Record<string, string>;
  resumeStateByLibraryItemId: Record<string, AmbientResumeStateRecord>;
};

type RuntimeAmbientState = {
  activeTrackId: string | null;
  activeLibraryItemId: string | null;
  playbackState: AmbientPlaybackState;
};

type LegacyAmbientState = Partial<
  PersistedAmbientState & {
    selectedTrackId: string | null;
    selectedLibraryItemId: string | null;
    tracksById: Record<string, AmbientTrackRecord & { uri?: string | null }>;
  }
>;

export type AmbientStoreState = PersistedAmbientState &
  RuntimeAmbientState & {
    actions: {
      setEnabled: (enabled: boolean) => void;
      addTrack: (track: AmbientTrackRecord) => void;
      removeTrack: (trackId: string) => void;
      setTrackVolume: (trackId: string, volume: number) => void;
      attachTrackToBook: (trackId: string, libraryItemId: string) => void;
      detachTrackFromBook: (libraryItemId: string) => void;
      removeTrackFromAllBookAttachments: (trackId: string) => void;
      setResumeStateForBook: (libraryItemId: string, trackId: string, positionMs: number) => void;
      clearResumeStateForBook: (libraryItemId: string) => void;
      clearResumeStateForTrack: (trackId: string) => void;
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
  attachedTrackIdByLibraryItemId: {},
  resumeStateByLibraryItemId: {},
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
      volume: clampAmbientVolume(
        typeof candidate.volume === "number" ? candidate.volume : DEFAULT_AMBIENT_VOLUME,
      ),
      importedAt: typeof candidate.importedAt === "number" ? candidate.importedAt : 0,
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

const normalizeBookAttachments = (
  attachments: unknown,
  tracksById: Record<string, AmbientTrackRecord>,
  fallbackSelectedTrackId?: string | null,
  fallbackSelectedLibraryItemId?: string | null,
) => {
  const validTrackIds = new Set(Object.keys(tracksById));
  const nextAttachments: Record<string, string> = {};

  if (attachments && typeof attachments === "object") {
    Object.entries(attachments).forEach(([libraryItemId, trackId]) => {
      if (typeof libraryItemId !== "string" || libraryItemId.trim().length === 0) return;
      if (typeof trackId !== "string" || !validTrackIds.has(trackId)) return;
      nextAttachments[libraryItemId] = trackId;
    });
  }

  if (
    fallbackSelectedTrackId &&
    fallbackSelectedLibraryItemId &&
    validTrackIds.has(fallbackSelectedTrackId) &&
    !nextAttachments[fallbackSelectedLibraryItemId]
  ) {
    nextAttachments[fallbackSelectedLibraryItemId] = fallbackSelectedTrackId;
  }

  return nextAttachments;
};

const normalizeResumeStates = (
  resumeStates: unknown,
  tracksById: Record<string, AmbientTrackRecord>,
  attachedTrackIdByLibraryItemId: Record<string, string>,
) => {
  const validTrackIds = new Set(Object.keys(tracksById));
  const nextResumeStates: Record<string, AmbientResumeStateRecord> = {};

  if (!resumeStates || typeof resumeStates !== "object") {
    return nextResumeStates;
  }

  Object.entries(resumeStates).forEach(([libraryItemId, value]) => {
    if (typeof libraryItemId !== "string" || libraryItemId.trim().length === 0) return;
    if (!value || typeof value !== "object") return;

    const candidate = value as Partial<AmbientResumeStateRecord>;
    if (typeof candidate.trackId !== "string" || !validTrackIds.has(candidate.trackId)) return;
    if (attachedTrackIdByLibraryItemId[libraryItemId] !== candidate.trackId) return;

    nextResumeStates[libraryItemId] = {
      trackId: candidate.trackId,
      positionMs: clampAmbientPosition(
        typeof candidate.positionMs === "number" ? candidate.positionMs : 0,
      ),
    };
  });

  return nextResumeStates;
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
                [track.id]: {
                  ...track,
                  volume: clampAmbientVolume(track.volume),
                },
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
        setTrackVolume: (trackId, volume) =>
          set((state) => {
            const existingTrack = state.tracksById[trackId];
            if (!existingTrack) return state;

            return {
              tracksById: {
                ...state.tracksById,
                [trackId]: {
                  ...existingTrack,
                  volume: clampAmbientVolume(volume),
                },
              },
            };
          }),
        attachTrackToBook: (trackId, libraryItemId) =>
          set((state) => {
            if (!state.tracksById[trackId]) return state;
            if (!libraryItemId.trim()) return state;
            const existingTrackId = state.attachedTrackIdByLibraryItemId[libraryItemId];
            if (existingTrackId === trackId) return state;

            const nextResumeStates = { ...state.resumeStateByLibraryItemId };
            delete nextResumeStates[libraryItemId];

            return {
              attachedTrackIdByLibraryItemId: {
                ...state.attachedTrackIdByLibraryItemId,
                [libraryItemId]: trackId,
              },
              resumeStateByLibraryItemId: nextResumeStates,
            };
          }),
        detachTrackFromBook: (libraryItemId) =>
          set((state) => {
            if (!state.attachedTrackIdByLibraryItemId[libraryItemId]) return state;

            const nextAttachments = { ...state.attachedTrackIdByLibraryItemId };
            delete nextAttachments[libraryItemId];
            const isActiveBook = state.activeLibraryItemId === libraryItemId;
            const nextResumeStates = { ...state.resumeStateByLibraryItemId };
            delete nextResumeStates[libraryItemId];

            return {
              attachedTrackIdByLibraryItemId: nextAttachments,
              resumeStateByLibraryItemId: nextResumeStates,
              activeTrackId: isActiveBook ? null : state.activeTrackId,
              activeLibraryItemId: isActiveBook ? null : state.activeLibraryItemId,
              playbackState: isActiveBook ? "idle" : state.playbackState,
            };
          }),
        removeTrackFromAllBookAttachments: (trackId) =>
          set((state) => {
            const nextAttachments = Object.fromEntries(
              Object.entries(state.attachedTrackIdByLibraryItemId).filter(
                ([, attachedTrackId]) => attachedTrackId !== trackId,
              ),
            );
            const nextResumeStates = Object.fromEntries(
              Object.entries(state.resumeStateByLibraryItemId).filter(
                ([libraryItemId, resumeState]) =>
                  resumeState.trackId !== trackId && nextAttachments[libraryItemId] === resumeState.trackId,
              ),
            );
            const isActiveTrack = state.activeTrackId === trackId;

            if (
              Object.keys(nextAttachments).length ===
                Object.keys(state.attachedTrackIdByLibraryItemId).length &&
              Object.keys(nextResumeStates).length ===
                Object.keys(state.resumeStateByLibraryItemId).length &&
              !isActiveTrack
            ) {
              return state;
            }

            return {
              attachedTrackIdByLibraryItemId: nextAttachments,
              resumeStateByLibraryItemId: nextResumeStates,
              activeTrackId: isActiveTrack ? null : state.activeTrackId,
              activeLibraryItemId: isActiveTrack ? null : state.activeLibraryItemId,
              playbackState: isActiveTrack ? "idle" : state.playbackState,
            };
          }),
        setResumeStateForBook: (libraryItemId, trackId, positionMs) =>
          set((state) => {
            if (!libraryItemId.trim()) return state;
            if (state.attachedTrackIdByLibraryItemId[libraryItemId] !== trackId) return state;
            if (!state.tracksById[trackId]) return state;

            const nextResumeState = {
              trackId,
              positionMs: clampAmbientPosition(positionMs),
            };
            const currentResumeState = state.resumeStateByLibraryItemId[libraryItemId];

            if (
              currentResumeState?.trackId === nextResumeState.trackId &&
              currentResumeState.positionMs === nextResumeState.positionMs
            ) {
              return state;
            }

            return {
              resumeStateByLibraryItemId: {
                ...state.resumeStateByLibraryItemId,
                [libraryItemId]: nextResumeState,
              },
            };
          }),
        clearResumeStateForBook: (libraryItemId) =>
          set((state) => {
            if (!state.resumeStateByLibraryItemId[libraryItemId]) return state;

            const nextResumeStates = { ...state.resumeStateByLibraryItemId };
            delete nextResumeStates[libraryItemId];
            return { resumeStateByLibraryItemId: nextResumeStates };
          }),
        clearResumeStateForTrack: (trackId) =>
          set((state) => {
            const nextResumeStates = Object.fromEntries(
              Object.entries(state.resumeStateByLibraryItemId).filter(
                ([, resumeState]) => resumeState.trackId !== trackId,
              ),
            );

            if (
              Object.keys(nextResumeStates).length ===
              Object.keys(state.resumeStateByLibraryItemId).length
            ) {
              return state;
            }

            return { resumeStateByLibraryItemId: nextResumeStates };
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
      version: 3,
      partialize: (state) => ({
        isEnabled: state.isEnabled,
        tracksById: state.tracksById,
        trackOrder: state.trackOrder,
        attachedTrackIdByLibraryItemId: state.attachedTrackIdByLibraryItemId,
        resumeStateByLibraryItemId: state.resumeStateByLibraryItemId,
      }),
      merge: (persistedState, currentState) => {
        const typedState =
          persistedState && typeof persistedState === "object"
            ? (persistedState as LegacyAmbientState)
            : {};
        const tracksById = normalizePersistedAmbientTracks(typedState.tracksById);
        const trackOrder = normalizeTrackOrder(typedState.trackOrder, tracksById);
        const attachedTrackIdByLibraryItemId = normalizeBookAttachments(
          typedState.attachedTrackIdByLibraryItemId,
          tracksById,
          typedState.selectedTrackId,
          typedState.selectedLibraryItemId,
        );
        const resumeStateByLibraryItemId = normalizeResumeStates(
          typedState.resumeStateByLibraryItemId,
          tracksById,
          attachedTrackIdByLibraryItemId,
        );

        return {
          ...currentState,
          isEnabled: typedState.isEnabled ?? false,
          tracksById,
          trackOrder,
          attachedTrackIdByLibraryItemId,
          resumeStateByLibraryItemId,
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
          attachedTrackIdByLibraryItemId: normalizeBookAttachments(
            typedState.attachedTrackIdByLibraryItemId,
            tracksById,
            typedState.selectedTrackId,
            typedState.selectedLibraryItemId,
          ),
          resumeStateByLibraryItemId: normalizeResumeStates(
            typedState.resumeStateByLibraryItemId,
            tracksById,
            normalizeBookAttachments(
              typedState.attachedTrackIdByLibraryItemId,
              tracksById,
              typedState.selectedTrackId,
              typedState.selectedLibraryItemId,
            ),
          ),
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
  const attachedTrackId = state.attachedTrackIdByLibraryItemId[libraryItemId];
  if (!attachedTrackId) return null;
  const track = state.tracksById[attachedTrackId] ?? null;
  return isAmbientTrackAvailable(track) ? track : null;
};

export const selectAmbientResumeStateForBook = (
  state: AmbientStoreState,
  libraryItemId?: string | null,
) => {
  if (!libraryItemId) return null;
  const resumeState = state.resumeStateByLibraryItemId[libraryItemId];
  if (!resumeState) return null;
  const attachedTrackId = state.attachedTrackIdByLibraryItemId[libraryItemId];
  if (attachedTrackId !== resumeState.trackId) return null;
  if (!state.tracksById[resumeState.trackId]) return null;
  return resumeState;
};

export const selectHasAvailableAmbientTracks = (state: AmbientStoreState) =>
  selectAvailableAmbientTracks(state).length > 0;
