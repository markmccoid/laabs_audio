/**
 * Episode-scoped Downloaded Audio Assets (ADR 0029).
 * Parallel to book `downloadedBookData` — never keyed into book download maps.
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { buildCoverUrls } from "@/api/cover-urls";
import { downloadsApi } from "@/api/downloads-api";
import { itemsApi } from "@/api/items-api";
import { authStore } from "@/auth/auth-store";
import { markEpisodeTouchedFromDownload } from "@/data/sqlite/touched-episodes";
import {
  episodeIdentityKey,
  parseEpisodeIdentityKey,
  type EpisodeIdentity,
} from "@/podcast/episode-identity";
import {
  assembleDownloadedEpisodesShelf,
  isEpisodeDownloadAvailable,
  type EpisodeDownloadedAssetRecord,
} from "@/podcast/episode-download-facade";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import type { DownloadTrack } from "@/store/device-books-store";
import {
  selectIsAnyDownloadActive as selectIsAnyBookDownloadActive,
  deviceBooksStore,
} from "@/store/device-books-store";
import {
  deleteFromFileSystem,
  downloadFileBlob,
  ensureAppDirectory,
  isRelativeDocumentPath,
  resolveDocumentRelativePath,
  toDocumentRelativePath,
} from "@/store/fileSystemAccess";
import { mmkvStorage } from "@/store/mmkv-storage";

export const EPISODE_DOWNLOADS_DIRECTORY = "laabs-episode-downloads";
const DOWNLOAD_COVER_FILE_NAME = "cover.webp";
const DOWNLOAD_PROGRESS_UI_UPDATE_INTERVAL_MS = 250;
const DOWNLOAD_PROGRESS_UI_MIN_PERCENT_STEP = 2;

export type EpisodeDownloadInfo = {
  audioTracks: DownloadTrack[];
  coverRelativePath?: string | null;
};

export type EpisodeDownloadDetails = {
  /**
   * Library shelf scope. Null identifies a legacy record: it remains directly
   * playable by Episode Identity, but is excluded from every Library shelf.
   */
  libraryId: string | null;
  libraryItemId: string;
  episodeId: string;
  title: string;
  podcastTitle: string;
  coverUri: string | null;
  durationSeconds: number;
  audioIno: string;
  audioMimeType: string | null;
  podcastUpdatedAt: number;
  downloadedAt: number;
};

export type EpisodeDownloadStage = "preparing" | "downloading" | "finalizing" | "cancelling";

export type EpisodeDownloadProgress = {
  libraryItemId: string;
  episodeId: string;
  stage: EpisodeDownloadStage;
  progress: number;
  received: number;
  total: number;
  currentFileName: string | null;
  currentFileSize: number;
};

export type ActiveEpisodeDownloadSession = {
  libraryItemId: string;
  episodeId: string;
  title: string | null;
  phase: EpisodeDownloadStage;
  startedAt: number;
};

type EpisodeDownloadsPersistedState = {
  downloadedEpisodeData: Record<string, EpisodeDownloadInfo>;
  downloadedEpisodeDetailsById: Record<string, EpisodeDownloadDetails>;
  downloadedEpisodeOwnerUserIdsById: Record<string, string[]>;
};

type EpisodeDownloadsState = EpisodeDownloadsPersistedState & {
  activeDownloadSession?: ActiveEpisodeDownloadSession;
  downloadProgress?: EpisodeDownloadProgress;
  downloadToken: number;
  activeCancelFn?: () => Promise<void>;
  actions: {
    setDownloadedEpisodeData: (key: string, info: EpisodeDownloadInfo) => void;
    setDownloadedEpisodeDetails: (key: string, details: EpisodeDownloadDetails) => void;
    clearDownloadedEpisode: (key: string) => void;
    downloadEpisode: (
      identity: EpisodeIdentity,
      options?: {
        episodeTitle?: string | null;
        podcastTitle?: string | null;
        coverUri?: string | null;
      },
    ) => Promise<void>;
    deleteDownloadedEpisode: (identity: EpisodeIdentity) => Promise<void>;
    cancelDownload: () => Promise<void>;
    setActiveDownloadSession: (session?: ActiveEpisodeDownloadSession) => void;
    setDownloadProgress: (progress?: EpisodeDownloadProgress) => void;
    setActiveCancelFn: (cancelFn?: () => Promise<void>) => void;
    incrementDownloadToken: () => number;
  };
};

const buildEpisodeDownloadDirectoryRelativePath = (identity: EpisodeIdentity) =>
  `${EPISODE_DOWNLOADS_DIRECTORY}/${identity.libraryItemId}/${identity.episodeId}`;

const ensureEpisodeDownloadDir = async (identity: EpisodeIdentity) =>
  ensureAppDirectory(buildEpisodeDownloadDirectoryRelativePath(identity));

const resolveAuthUserKey = () => {
  const { activeLibraryUserKey, storedUserId } = authStore.getState();
  if (activeLibraryUserKey) return activeLibraryUserKey;
  if (storedUserId) return storedUserId;
  return null;
};

const hasValidRelativeDownloadTrack = (track?: Pick<DownloadTrack, "relativePath"> | null) =>
  Boolean(track?.relativePath && isRelativeDocumentPath(track.relativePath));

const hasPlayableEpisodeDownloadAudio = (downloadInfo?: EpisodeDownloadInfo | null) =>
  Boolean(downloadInfo?.audioTracks?.some((track) => hasValidRelativeDownloadTrack(track)));

const resolveEpisodeDownloadTrackUri = (track?: Pick<DownloadTrack, "relativePath"> | null) =>
  resolveDocumentRelativePath(track?.relativePath);

const resolveEpisodeDownloadCoverUri = (
  downloadInfo?: Pick<EpisodeDownloadInfo, "coverRelativePath"> | null,
) => resolveDocumentRelativePath(downloadInfo?.coverRelativePath ?? null);

const normalizeDownloadTrack = (track: unknown): DownloadTrack | null => {
  if (!track || typeof track !== "object") return null;
  const candidate = track as Partial<DownloadTrack>;
  if (
    typeof candidate.relativePath !== "string" ||
    !isRelativeDocumentPath(candidate.relativePath)
  ) {
    return null;
  }
  return {
    ino: typeof candidate.ino === "string" ? candidate.ino : "",
    filename: typeof candidate.filename === "string" ? candidate.filename : "",
    cleanFileName:
      typeof candidate.cleanFileName === "string" && candidate.cleanFileName.trim().length > 0
        ? candidate.cleanFileName
        : candidate.filename ?? "audio",
    duration: typeof candidate.duration === "number" ? candidate.duration : 0,
    startOffset: typeof candidate.startOffset === "number" ? candidate.startOffset : 0,
    relativePath: candidate.relativePath,
  };
};

const normalizePersistedEpisodeData = (
  data?: Record<string, EpisodeDownloadInfo>,
): Record<string, EpisodeDownloadInfo> => {
  const normalized: Record<string, EpisodeDownloadInfo> = {};
  Object.entries(data ?? {}).forEach(([key, info]) => {
    const audioTracks = Array.isArray(info?.audioTracks)
      ? info.audioTracks
          .map((track) => normalizeDownloadTrack(track))
          .filter((track): track is DownloadTrack => Boolean(track))
      : [];
    const coverRelativePath =
      typeof info?.coverRelativePath === "string" &&
      isRelativeDocumentPath(info.coverRelativePath)
        ? info.coverRelativePath
        : null;
    if (audioTracks.length === 0 && !coverRelativePath) return;
    normalized[key] = { audioTracks, coverRelativePath };
  });
  return normalized;
};

export const normalizePersistedEpisodeDetails = (
  details?: Record<string, EpisodeDownloadDetails>,
): Record<string, EpisodeDownloadDetails> =>
  Object.fromEntries(
    Object.entries(details ?? {}).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as EpisodeDownloadDetails & { libraryId?: unknown };
      return [
        [
          key,
          {
            ...candidate,
            libraryId:
              typeof candidate.libraryId === "string" && candidate.libraryId.trim()
                ? candidate.libraryId.trim()
                : null,
          },
        ],
      ];
    }),
  );

const downloadEpisodeCoverImage = async (
  identity: EpisodeIdentity,
  version?: number | null,
) => {
  try {
    const token = authStore.getState().accessToken;
    const coverUrls = buildCoverUrls(identity.libraryItemId, { token, version });
    const dir = await ensureEpisodeDownloadDir(identity);
    const attemptDownload = async (url: string | null) => {
      if (!url) return null;
      const { task, fileUri } = downloadFileBlob(url, DOWNLOAD_COVER_FILE_NAME, undefined, {
        directory: dir,
      });
      const result = await task;
      if (!result || result.status !== 200) {
        await deleteFromFileSystem(fileUri);
        return null;
      }
      return toDocumentRelativePath(fileUri);
    };
    return (await attemptDownload(coverUrls.full)) ?? (await attemptDownload(coverUrls.fullWithToken));
  } catch {
    return null;
  }
};

const invalidateContinueQuery = () => {
  const { activeLibraryUserKey, activeLibraryId } = authStore.getState();
  void queryClient.invalidateQueries({
    queryKey: queryKeys.podcastContinueEpisodes(activeLibraryUserKey, activeLibraryId),
  });
};

const createDefaultPersistedState = (): EpisodeDownloadsPersistedState => ({
  downloadedEpisodeData: {},
  downloadedEpisodeDetailsById: {},
  downloadedEpisodeOwnerUserIdsById: {},
});

export const deviceEpisodeDownloadsStore = createStore<EpisodeDownloadsState>()(
  persist(
    (set, get) => ({
      ...createDefaultPersistedState(),
      downloadToken: 0,
      actions: {
        setDownloadedEpisodeData: (key, info) => {
          const ownerUserId = resolveAuthUserKey();
          set((state) => ({
            downloadedEpisodeData: {
              ...state.downloadedEpisodeData,
              [key]: info,
            },
            downloadedEpisodeOwnerUserIdsById: ownerUserId
              ? {
                  ...state.downloadedEpisodeOwnerUserIdsById,
                  [key]: Array.from(
                    new Set([
                      ...(state.downloadedEpisodeOwnerUserIdsById[key] ?? []),
                      ownerUserId,
                    ]),
                  ),
                }
              : state.downloadedEpisodeOwnerUserIdsById,
          }));
        },

        setDownloadedEpisodeDetails: (key, details) => {
          set((state) => ({
            downloadedEpisodeDetailsById: {
              ...state.downloadedEpisodeDetailsById,
              [key]: details,
            },
          }));
        },

        clearDownloadedEpisode: (key) => {
          set((state) => {
            const { [key]: _dataRemoved, ...remainingData } = state.downloadedEpisodeData;
            const { [key]: _detailsRemoved, ...remainingDetails } =
              state.downloadedEpisodeDetailsById;
            const { [key]: _ownersRemoved, ...remainingOwners } =
              state.downloadedEpisodeOwnerUserIdsById;
            return {
              downloadedEpisodeData: remainingData,
              downloadedEpisodeDetailsById: remainingDetails,
              downloadedEpisodeOwnerUserIdsById: remainingOwners,
            };
          });
        },

        downloadEpisode: async (identity, options) => {
          const key = episodeIdentityKey(identity);
          if (!key) return;

          const { libraryItemId, episodeId } = identity;
          const downloadLibraryId = authStore.getState().activeLibraryId?.trim() || null;
          const activeSession = get().activeDownloadSession;
          if (
            activeSession &&
            activeSession.libraryItemId === libraryItemId &&
            activeSession.episodeId === episodeId
          ) {
            return;
          }
          if (activeSession) return;
          if (selectIsAnyBookDownloadActive(deviceBooksStore.getState())) return;

          const myToken = get().actions.incrementDownloadToken();
          const isTokenActive = () => get().downloadToken === myToken;
          const startedAt = Date.now();
          let resolvedTitle = options?.episodeTitle?.trim() || null;
          let resolvedPodcastTitle = options?.podcastTitle?.trim() || "Podcast";

          get().actions.setActiveDownloadSession({
            libraryItemId,
            episodeId,
            title: resolvedTitle,
            phase: "preparing",
            startedAt,
          });

          try {
            const details = await itemsApi.getPodcastItemDetails(libraryItemId);
            if (!isTokenActive()) return;

            const episode = details.episodes.find((row) => row.id === episodeId);
            if (!episode) {
              throw new Error("Episode not found on this Podcast.");
            }
            const audioFile = episode.audioFile;
            if (!audioFile?.ino) {
              throw new Error("Episode has no downloadable audio file.");
            }

            resolvedTitle = episode.title?.trim() || resolvedTitle || "Episode";
            resolvedPodcastTitle = details.title?.trim() || resolvedPodcastTitle;
            get().actions.setActiveDownloadSession({
              libraryItemId,
              episodeId,
              title: resolvedTitle,
              phase: "preparing",
              startedAt,
            });

            const downloadDir = await ensureEpisodeDownloadDir(identity);
            if (!isTokenActive()) return;

            const currentFileName = audioFile.metadata?.filename ?? "episode.mp3";
            const currentFileSize =
              typeof audioFile.metadata?.size === "number" && audioFile.metadata.size > 0
                ? audioFile.metadata.size
                : 0;

            get().actions.setDownloadProgress({
              libraryItemId,
              episodeId,
              stage: "preparing",
              progress: 0,
              received: 0,
              total: currentFileSize,
              currentFileName,
              currentFileSize,
            });

            const { urlWithToken, authHeader } = await downloadsApi.getDownloadSpec(
              libraryItemId,
              audioFile.ino,
            );
            if (!isTokenActive()) return;

            let lastUiPercent = -1;
            let lastUiUpdateAt = 0;
            const { task, cancelDownload, cleanFileName, fileUri } = downloadFileBlob(
              urlWithToken,
              currentFileName,
              (received, total) => {
                if (!isTokenActive()) return;
                const currentSession = get().activeDownloadSession;
                if (currentSession?.phase === "preparing" && received > 0) {
                  get().actions.setActiveDownloadSession({
                    ...currentSession,
                    phase: "downloading",
                  });
                }
                const percent = total > 0 ? Math.round((received / total) * 100) : 0;
                const now = Date.now();
                const shouldUpdateUi =
                  percent === 100 ||
                  lastUiPercent === -1 ||
                  percent >= lastUiPercent + DOWNLOAD_PROGRESS_UI_MIN_PERCENT_STEP ||
                  now - lastUiUpdateAt >= DOWNLOAD_PROGRESS_UI_UPDATE_INTERVAL_MS;
                if (!shouldUpdateUi) return;
                lastUiPercent = percent;
                lastUiUpdateAt = now;
                get().actions.setDownloadProgress({
                  libraryItemId,
                  episodeId,
                  stage: "downloading",
                  progress: percent / 100,
                  received,
                  total,
                  currentFileName,
                  currentFileSize: total || currentFileSize,
                });
              },
              { directory: downloadDir, headers: authHeader },
            );

            get().actions.setActiveCancelFn(async () => {
              await cancelDownload();
              await deleteFromFileSystem(fileUri);
            });

            const result = await task;
            if (!isTokenActive()) return;
            if (!result || result.status !== 200) {
              throw new Error(`Download failed with status: ${result?.status ?? "unknown"}`);
            }

            const relativePath = toDocumentRelativePath(fileUri);
            if (!relativePath) {
              throw new Error("Unable to persist downloaded episode path.");
            }

            const audioTrack: DownloadTrack = {
              ino: audioFile.ino,
              filename: currentFileName,
              cleanFileName,
              duration: audioFile.duration ?? episode.duration ?? 0,
              startOffset: audioFile.startOffset ?? 0,
              relativePath,
            };

            get().actions.setActiveDownloadSession({
              libraryItemId,
              episodeId,
              title: resolvedTitle,
              phase: "finalizing",
              startedAt,
            });
            get().actions.setDownloadProgress({
              libraryItemId,
              episodeId,
              stage: "finalizing",
              progress: 1,
              received: currentFileSize,
              total: currentFileSize,
              currentFileName,
              currentFileSize,
            });

            const coverRelativePath = await downloadEpisodeCoverImage(
              identity,
              details.updatedAt,
            );
            if (!isTokenActive()) return;

            const downloadedAt = Date.now();
            get().actions.setDownloadedEpisodeData(key, {
              audioTracks: [audioTrack],
              coverRelativePath,
            });
            get().actions.setDownloadedEpisodeDetails(key, {
              libraryId: downloadLibraryId,
              libraryItemId,
              episodeId,
              title: resolvedTitle,
              podcastTitle: resolvedPodcastTitle,
              coverUri: options?.coverUri ?? details.coverUri ?? null,
              durationSeconds: Math.max(
                audioTrack.duration,
                episode.duration ?? 0,
                0,
              ),
              audioIno: audioFile.ino,
              audioMimeType: audioFile.mimeType ?? null,
              podcastUpdatedAt: details.updatedAt,
              downloadedAt,
            });

            const userId = resolveAuthUserKey();
            if (userId && downloadLibraryId) {
              await markEpisodeTouchedFromDownload({
                userId,
                libraryId: downloadLibraryId,
                libraryItemId,
                episodeId,
                title: resolvedTitle,
                podcastTitle: resolvedPodcastTitle,
                cover: options?.coverUri ?? details.coverUri ?? null,
                durationSeconds: Math.max(audioTrack.duration, episode.duration ?? 0, 0),
              });
              invalidateContinueQuery();
            } else if (__DEV__) {
              console.warn(
                "[episode-downloads] skipped Touched mark — missing user/library scope",
                { userId, libraryId: downloadLibraryId, libraryItemId, episodeId },
              );
            }

            get().actions.incrementDownloadToken();
            set({
              activeCancelFn: undefined,
              activeDownloadSession: undefined,
              downloadProgress: undefined,
            });
          } catch (error) {
            if (!isTokenActive()) return;
            get().actions.clearDownloadedEpisode(key);
            get().actions.incrementDownloadToken();
            set({
              activeCancelFn: undefined,
              activeDownloadSession: undefined,
              downloadProgress: undefined,
            });
            throw error;
          }
        },

        deleteDownloadedEpisode: async (identity) => {
          const key = episodeIdentityKey(identity);
          if (!key) return;
          const downloadInfo = get().downloadedEpisodeData[key];
          if (downloadInfo) {
            for (const track of downloadInfo.audioTracks) {
              const trackUri = resolveEpisodeDownloadTrackUri(track);
              if (trackUri) await deleteFromFileSystem(trackUri);
            }
            const coverUri = resolveEpisodeDownloadCoverUri(downloadInfo);
            if (coverUri) await deleteFromFileSystem(coverUri);
          }
          const dirUri = resolveDocumentRelativePath(
            buildEpisodeDownloadDirectoryRelativePath(identity),
          );
          if (dirUri) await deleteFromFileSystem(dirUri);
          get().actions.clearDownloadedEpisode(key);
        },

        cancelDownload: async () => {
          const activeSession = get().activeDownloadSession;
          if (activeSession) {
            get().actions.setActiveDownloadSession({
              ...activeSession,
              phase: "cancelling",
            });
          }
          const cancelFn = get().activeCancelFn;
          get().actions.incrementDownloadToken();
          if (cancelFn) {
            try {
              await cancelFn();
            } catch {
              // Ignore cancel errors
            }
          }
          set({
            activeCancelFn: undefined,
            activeDownloadSession: undefined,
            downloadProgress: undefined,
          });
        },

        setActiveDownloadSession: (session) => {
          set({ activeDownloadSession: session });
        },

        setDownloadProgress: (progress) => {
          set({ downloadProgress: progress });
        },

        setActiveCancelFn: (cancelFn) => {
          set({ activeCancelFn: cancelFn });
        },

        incrementDownloadToken: () => {
          const next = get().downloadToken + 1;
          set({ downloadToken: next });
          return next;
        },
      },
    }),
    {
      name: "device-episode-downloads",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        downloadedEpisodeData: state.downloadedEpisodeData,
        downloadedEpisodeDetailsById: state.downloadedEpisodeDetailsById,
        downloadedEpisodeOwnerUserIdsById: state.downloadedEpisodeOwnerUserIdsById,
      }),
      version: 1,
      migrate: (persisted) => {
        const typed = (persisted ?? {}) as Partial<EpisodeDownloadsPersistedState>;
        return {
          ...typed,
          downloadedEpisodeDetailsById: normalizePersistedEpisodeDetails(
            typed.downloadedEpisodeDetailsById,
          ),
        };
      },
      merge: (persisted, current) => {
        const typed = (persisted ?? {}) as Partial<EpisodeDownloadsPersistedState>;
        return {
          ...current,
          downloadedEpisodeData: normalizePersistedEpisodeData(typed.downloadedEpisodeData),
          downloadedEpisodeDetailsById: normalizePersistedEpisodeDetails(
            typed.downloadedEpisodeDetailsById,
          ),
          downloadedEpisodeOwnerUserIdsById: typed.downloadedEpisodeOwnerUserIdsById ?? {},
        };
      },
    },
  ),
);

export const useDeviceEpisodeDownloadsStore = <T>(
  selector: (state: EpisodeDownloadsState) => T,
) => useStore(deviceEpisodeDownloadsStore, selector);

export const useDeviceEpisodeDownloadsActions = () =>
  useDeviceEpisodeDownloadsStore((state) => state.actions);

export const resolveStoredEpisodeDownloadTrackUri = resolveEpisodeDownloadTrackUri;
export const resolveStoredEpisodeDownloadCoverUri = resolveEpisodeDownloadCoverUri;
export const hasPlayableStoredEpisodeDownloadAudio = hasPlayableEpisodeDownloadAudio;

export const selectIsEpisodeDownloaded = (
  state: EpisodeDownloadsState,
  identity: EpisodeIdentity,
) => {
  const key = episodeIdentityKey(identity);
  if (!key) return false;
  return hasPlayableEpisodeDownloadAudio(state.downloadedEpisodeData[key]);
};

export const selectIsEpisodeActivelyDownloading = (
  state: EpisodeDownloadsState,
  identity?: EpisodeIdentity | null,
) => {
  if (!identity) return false;
  const session = state.activeDownloadSession;
  return (
    session?.libraryItemId === identity.libraryItemId &&
    session?.episodeId === identity.episodeId
  );
};

export const selectIsAnyEpisodeDownloadActive = (state: EpisodeDownloadsState) =>
  Boolean(state.activeDownloadSession);

export const selectIsAnotherEpisodeDownloadActive = (
  state: EpisodeDownloadsState,
  identity?: EpisodeIdentity | null,
) => {
  const session = state.activeDownloadSession;
  if (!session) return false;
  if (!identity) return true;
  return (
    session.libraryItemId !== identity.libraryItemId ||
    session.episodeId !== identity.episodeId
  );
};

export const selectHasPlayableEpisodeDownloadForSession = (
  state: EpisodeDownloadsState,
  identity: EpisodeIdentity,
  sessionUserId?: string | null,
) => {
  const key = episodeIdentityKey(identity);
  if (!key) return false;
  return isEpisodeDownloadAvailable({
    hasPlayableAudio: hasPlayableEpisodeDownloadAudio(state.downloadedEpisodeData[key]),
    ownerUserIds: state.downloadedEpisodeOwnerUserIdsById[key] ?? [],
    sessionUserId: sessionUserId ?? resolveAuthUserKey(),
  });
};

export const listEpisodeDownloadedAssetRecords = (
  state: Pick<
    EpisodeDownloadsState,
    | "downloadedEpisodeDetailsById"
    | "downloadedEpisodeData"
    | "downloadedEpisodeOwnerUserIdsById"
  >,
): EpisodeDownloadedAssetRecord[] =>
  Object.entries(state.downloadedEpisodeDetailsById).flatMap(([key, details]) => {
    const identity = parseEpisodeIdentityKey(key);
    if (!identity) return [];
    return [
      {
        libraryId: details.libraryId,
        libraryItemId: details.libraryItemId,
        episodeId: details.episodeId,
        title: details.title,
        podcastTitle: details.podcastTitle,
        cover: details.coverUri,
        durationSeconds: details.durationSeconds,
        hasPlayableAudio: hasPlayableEpisodeDownloadAudio(state.downloadedEpisodeData[key]),
        ownerUserIds: state.downloadedEpisodeOwnerUserIdsById[key] ?? [],
        downloadedAt: details.downloadedAt,
      },
    ];
  });

export const selectDownloadedEpisodesShelf = (
  state: EpisodeDownloadsState,
  sessionUserId?: string | null,
) =>
  assembleDownloadedEpisodesShelf(listEpisodeDownloadedAssetRecords(state), {
    activeLibraryId: authStore.getState().activeLibraryId,
    sessionUserId: sessionUserId ?? resolveAuthUserKey(),
  });

export const resolveDownloadedEpisodePlayback = (identity: EpisodeIdentity) => {
  const key = episodeIdentityKey(identity);
  if (!key) return null;
  const state = deviceEpisodeDownloadsStore.getState();
  if (
    !selectHasPlayableEpisodeDownloadForSession(
      state,
      identity,
      resolveAuthUserKey(),
    )
  ) {
    return null;
  }
  const details = state.downloadedEpisodeDetailsById[key];
  const downloadInfo = state.downloadedEpisodeData[key];
  const track = downloadInfo?.audioTracks[0];
  const trackUri = resolveEpisodeDownloadTrackUri(track);
  if (!details || !track || !trackUri) return null;

  return {
    libraryItemId: details.libraryItemId,
    episodeId: details.episodeId,
    episodeTitle: details.title,
    podcastTitle: details.podcastTitle,
    artworkUri: resolveEpisodeDownloadCoverUri(downloadInfo) ?? details.coverUri,
    durationSeconds: Math.max(details.durationSeconds, track.duration, 0),
    mimeType: details.audioMimeType,
    trackUri,
    track,
  };
};
