import type { LibraryItemSummary } from "@/api/library-items-api";
import {
  createEmptyUserServerState,
  meApi,
  type UserBookProgress,
  type UserServerState,
} from "@/api/me-api";
import { authStore, useAuthStore } from "@/auth/auth-store";
import { canUseAudiobookshelfServer } from "@/auth/server-connection";
import type {
  BookActionHandlers,
  BookActionId,
  ResolvedBookAction,
} from "@/components/books/book-action-types";
import { upsertShadowServerProgressProjection } from "@/data/sqlite/overlay-writes";
import type { SqliteHomeProjection } from "@/data/sqlite/home-repository";
import { useFavoriteBookAction } from "@/hooks/use-favorite-book-action";
import type { ShelfMembershipOption } from "@/hooks/use-shelf-membership-options";
import {
  resolveStoredDownloadCoverUri,
  selectHasPlayableBookDownload,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { shareBook } from "@/sharing/book-share";
import { playerService, usePlaybackStore } from "@/player";
import { resolveListeningOwnerKey } from "@/auth/listening-owner";
import { commitListeningStateCommand } from "@/progress/commit-listening-state-command";
import { nativeListeningPosition } from "@/progress/native-listening-position";
import { syncListeningPosition } from "@/progress/listening-position-sync";
import type { PlaybackStoreState } from "@/player/playback-store";
import { queryKeys } from "@/query/query-keys";
import { invalidateSqliteOverlayProjections } from "@/query/sqlite-invalidation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

export type BookActionControllerProps = {
  book: LibraryItemSummary;
  progress?: UserBookProgress;
  isFavorite?: boolean;
  isFinished?: boolean;
  actionIds?: readonly BookActionId[];
  actionHandlers?: BookActionHandlers;
  shelfMembershipOptions?: readonly ShelfMembershipOption[];
};

const updateUserServerStateProgress = (
  previousState: UserServerState | undefined,
  userKey: string,
  payload: {
    libraryItemId: string;
    currentTimeSeconds?: number;
    durationSeconds?: number;
    isFinished?: boolean;
    hideFromContinueListening?: boolean;
    progressId?: string;
  },
) => {
  const nextState: UserServerState = previousState ?? {
    ...createEmptyUserServerState(userKey),
  };
  const previousProgress =
    nextState.progressByLibraryItemId[payload.libraryItemId];
  const now = Date.now();
  const resolvedDuration =
    (payload.durationSeconds ?? 0) > 0
      ? (payload.durationSeconds ?? 0)
      : (previousProgress?.duration ?? 0);
  const resolvedCurrentTime = Math.max(
    0,
    Math.floor(
      payload.currentTimeSeconds ?? previousProgress?.currentTime ?? 0,
    ),
  );
  const progressPercent =
    resolvedDuration > 0
      ? Math.max(0, Math.min(1, resolvedCurrentTime / resolvedDuration))
      : (previousProgress?.progressPercent ?? 0);
  const resolvedIsFinished =
    payload.isFinished ?? previousProgress?.isFinished ?? false;
  const resolvedHideFromContinueListening =
    payload.hideFromContinueListening ??
    previousProgress?.hideFromContinueListening ??
    false;

  return {
    ...nextState,
    progressByLibraryItemId: {
      ...nextState.progressByLibraryItemId,
      [payload.libraryItemId]: {
        progressId:
          payload.progressId ??
          previousProgress?.progressId ??
          `${payload.libraryItemId}:local`,
        libraryItemId: payload.libraryItemId,
        mediaItemId: previousProgress?.mediaItemId,
        duration: resolvedDuration,
        progressPercent,
        currentTime: resolvedCurrentTime,
        isFinished: resolvedIsFinished,
        hideFromContinueListening: resolvedHideFromContinueListening,
        startedAt: previousProgress?.startedAt ?? now,
        finishedAt: resolvedIsFinished
          ? (previousProgress?.finishedAt ?? now)
          : null,
        lastUpdate: now,
      },
    },
  };
};

const buildOptimisticProgress = (
  book: LibraryItemSummary,
  previousProgress: UserBookProgress | undefined,
  payload: {
    currentTimeSeconds?: number;
    durationSeconds?: number;
    isFinished?: boolean;
    hideFromContinueListening?: boolean;
    progressId?: string;
  },
): UserBookProgress => {
  const updatedAt = Date.now();
  const resolvedDuration = Math.max(
    0,
    Math.floor(
      payload.durationSeconds ??
        previousProgress?.duration ??
        book.duration ??
        0,
    ),
  );
  const resolvedCurrentTime = Math.max(
    0,
    Math.floor(
      payload.currentTimeSeconds ?? previousProgress?.currentTime ?? 0,
    ),
  );
  const resolvedIsFinished =
    payload.isFinished ?? previousProgress?.isFinished ?? false;
  const resolvedHideFromContinueListening =
    payload.hideFromContinueListening ??
    previousProgress?.hideFromContinueListening ??
    false;
  const progressPercent =
    resolvedDuration > 0
      ? Math.max(0, Math.min(1, resolvedCurrentTime / resolvedDuration))
      : (previousProgress?.progressPercent ?? 0);
  return {
    progressId:
      payload.progressId ??
      previousProgress?.progressId ??
      `${book.id}:optimistic`,
    libraryItemId: book.id,
    mediaItemId: previousProgress?.mediaItemId,
    duration: resolvedDuration,
    progressPercent,
    currentTime: resolvedCurrentTime,
    isFinished: resolvedIsFinished,
    hideFromContinueListening: resolvedHideFromContinueListening,
    startedAt: previousProgress?.startedAt ?? updatedAt,
    finishedAt: resolvedIsFinished
      ? (previousProgress?.finishedAt ?? updatedAt)
      : null,
    lastUpdate: updatedAt,
  };
};

const updateSqliteHomeProjectionProgress = (
  queryClient: QueryClient,
  ownerId: string,
  book: LibraryItemSummary,
  previousProgress: UserBookProgress | undefined,
  payload: {
    currentTimeSeconds?: number;
    durationSeconds?: number;
    isFinished?: boolean;
    hideFromContinueListening?: boolean;
    progressId?: string;
  },
) => {
  const nextProgress = buildOptimisticProgress(book, previousProgress, payload);
  const shouldShowInContinueListening =
    nextProgress.currentTime > 0 &&
    !nextProgress.isFinished &&
    !nextProgress.hideFromContinueListening;

  queryClient.setQueriesData<SqliteHomeProjection>(
    {
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey.includes("homeProjection"),
    },
    (previousProjection) => {
      if (!previousProjection) return previousProjection;

      const catalogById = new Map(previousProjection.catalogById);
      catalogById.set(book.id, book);

      const progressByBookId = {
        ...previousProjection.progressByBookId,
        [book.id]: nextProgress,
      };

      const withoutBook = previousProjection.continueListening.filter(
        (item) => item.id !== book.id,
      );
      const continueListening = shouldShowInContinueListening
        ? [book, ...withoutBook]
        : withoutBook;

      return {
        ...previousProjection,
        catalogById,
        progressByBookId,
        continueListening,
      };
    },
  );
};

export const useBookActionController = ({
  book,
  progress,
  isFavorite = false,
  isFinished,
  actionIds,
  actionHandlers,
  shelfMembershipOptions = [],
}: BookActionControllerProps) => {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const isOnline = useAuthStore((state) => state.isOnline);
  const serverConnectionStatus = useAuthStore(
    (state) => state.serverConnectionStatus,
  );
  const {
    addBookToCustomShelf,
    addBooksToPlaylistShelfOptimistic,
    removeBookFromCustomShelf,
    removeBooksFromPlaylistShelfOptimistic,
  } = useDeviceBooksActions();
  const isDownloaded = useDeviceBooksStore((state) =>
    selectHasPlayableBookDownload(state, book.id),
  );
  const coverLocalUri = useDeviceBooksStore((state) =>
    resolveStoredDownloadCoverUri(state.downloadedBookData[book.id]),
  );
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const activeQueueLength = usePlaybackStore((state) =>
    state.libraryItemId === book.id ? state.queue.length : 0,
  );
  const activeDurationMs = usePlaybackStore((state) =>
    state.libraryItemId === book.id ? state.durationMs : 0,
  );
  const [busyAction, setBusyAction] = useState<
    "primary" | "favorite" | "finished" | "hide" | "shelf" | null
  >(null);
  const { canToggleFavorite, isToggleFavoritePending, toggleFavorite } =
    useFavoriteBookAction();

  const isBookActive = currentLibraryItemId === book.id;
  const isBookPlaying = isBookActive && playbackState === "playing";
  const isBookLoading = isBookActive && playbackState === "loading";
  const isBookLoaded = isBookActive && activeQueueLength > 0;
  const canUseServer = canUseAudiobookshelfServer({
    isOnline,
    serverConnectionStatus,
  });
  const canPlay = !isBookLoading && (canUseServer || isDownloaded);
  const canMutateShelves = Boolean(activeLibraryId && activeLibraryUserKey);
  const hasStartedContinueListening =
    Math.max(0, Math.floor(progress?.currentTime ?? 0)) > 0 ||
    (progress?.progressPercent ?? 0) > 0;
  const hasContinueListeningVisibilityOption = Boolean(
    progress && hasStartedContinueListening && !progress.isFinished,
  );
  const canToggleContinueListeningVisibility = Boolean(
    authStatus === "authenticated" &&
    canUseServer &&
    hasContinueListeningVisibilityOption,
  );
  const primaryLabel = isBookPlaying ? "Pause" : "Play";
  const primarySystemImage: "pause.fill" | "play.fill" = isBookPlaying
    ? "pause.fill"
    : "play.fill";
  const isMarkedFinished = isFinished ?? Boolean(progress?.isFinished);
  const finishedLabel = isMarkedFinished ? "Mark as Unread" : "Mark as Read";
  const finishedSystemImage:
    | "arrow.counterclockwise.circle"
    | "checkmark.circle" = isMarkedFinished
    ? "arrow.counterclockwise.circle"
    : "checkmark.circle";
  const favoriteLabel = isFavorite ? "Remove Favorite" : "Mark as Favorite";
  const favoriteSystemImage: "heart.slash" | "heart" = isFavorite
    ? "heart.slash"
    : "heart";
  const shareLabel = "Share Book";
  const shareSystemImage: "square.and.arrow.up" = "square.and.arrow.up";
  const continueListeningVisibilityLabel = progress?.hideFromContinueListening
    ? "Show in Continue Listening"
    : "Hide from Continue Listening";
  const continueListeningVisibilityIcon: "eye" | "eye.slash" =
    progress?.hideFromContinueListening ? "eye" : "eye.slash";

  const changeFinishedProgress = async (finished: boolean) => {
    const durationSeconds = Math.max(
      0,
      Math.floor(progress?.duration ?? 0),
      Math.floor(book.duration ?? 0),
      Math.floor(activeDurationMs / 1000),
    );
    const currentTimeSeconds = finished ? durationSeconds : 0;
    const ownerId = resolveListeningOwnerKey(book.id);
    if (!ownerId) throw new Error("Unable to resolve this book's listener.");
    const commandAuth = authStore.getState();
    let record = null;
    let isCurrent = () =>
      resolveListeningOwnerKey(book.id) === ownerId &&
      authStore.getState().serverUrl === commandAuth.serverUrl &&
      authStore.getState().activeSessionKey === commandAuth.activeSessionKey;
    let serverUrl: string | null | undefined = commandAuth.serverUrl;
    if (isBookLoaded) {
      if (finished)
        await playerService.finishActiveBook({
          libraryItemId: book.id,
          durationSeconds,
        });
      else
        await playerService.resetActiveBook({
          libraryItemId: book.id,
          durationSeconds,
        });
      if (nativeListeningPosition.capability() === "native") {
        record = await nativeListeningPosition.get({
          ownerId,
          libraryItemId: book.id,
          episodeId: null,
        });
      }
    } else {
      const committed = await commitListeningStateCommand({
        libraryItemId: book.id,
        positionMs: currentTimeSeconds * 1000,
        durationMs: durationSeconds * 1000,
        isFinished: finished,
        reason: finished ? "mark_read" : "mark_unread",
      });
      record = committed.record;
      serverUrl = committed.serverUrl;
      isCurrent = () =>
        committed.ticket.isLatest() && committed.isRouteCurrent();
    }
    if (
      !isCurrent() ||
      (record &&
        (record.isFinished !== finished ||
          Math.abs(record.positionMs - currentTimeSeconds * 1000) >= 1000))
    )
      return;
    const optimistic = buildOptimisticProgress(book, progress, {
      currentTimeSeconds,
      durationSeconds,
      isFinished: finished,
      progressId: progress?.progressId,
      hideFromContinueListening: progress?.hideFromContinueListening ?? false,
    });
    updateSqliteHomeProjectionProgress(queryClient, ownerId, book, progress, {
      currentTimeSeconds,
      durationSeconds,
      isFinished: finished,
      progressId: progress?.progressId,
      hideFromContinueListening: progress?.hideFromContinueListening ?? false,
    });
    queryClient.setQueryData<UserServerState>(
      queryKeys.userServerState(ownerId),
      (previousState) =>
        updateUserServerStateProgress(previousState, ownerId, {
          libraryItemId: book.id,
          currentTimeSeconds,
          durationSeconds,
          isFinished: finished,
          progressId: progress?.progressId,
        }),
    );
    await upsertShadowServerProgressProjection(ownerId, optimistic);
    if (!isCurrent()) return;
    if (record)
      await nativeListeningPosition.acknowledge(
        { ownerId, libraryItemId: book.id, episodeId: null },
        record.sequence,
        "projected",
      );
    if (!isBookLoaded || !finished) {
      await syncListeningPosition({
        state: {
          libraryItemId: book.id,
          ownerId,
          episodeId: null,
          sessionId: "local",
          positionSequence: record?.sequence ?? null,
          positionRevision: record?.positionRevision ?? null,
          secondaryTitle: null,
        } as PlaybackStoreState,
        reason: finished ? "mark_read" : "mark_unread",
        currentTimeSeconds,
        durationSeconds,
        timeListenedSeconds: 0,
        isFinished: finished,
        title: book.title,
        sessionKind: "unknown",
        serverUrl,
        intentKind: finished ? "mark_finished" : "mark_unread",
        updateLocalProgress: () => {},
        setLastSyncAt: () => {},
      });
    }
    invalidateSqliteOverlayProjections(queryClient);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.booksInProgress(activeLibraryId),
    });
    toast.success(
      `Marked ${finished ? "read" : "unread"}${canUseServer ? "" : " offline"}`,
    );
  };

  const syncFinishedProgress = () => changeFinishedProgress(true);
  const syncUnfinishedProgress = () => changeFinishedProgress(false);

  const toggleContinueListeningVisibility = async () => {
    if (!activeLibraryUserKey || !progress) {
      toast.error("No progress found to update");
      return;
    }

    const nextHiddenValue = !progress.hideFromContinueListening;
    // eslint-disable-next-line react-hooks/purity -- event-handler timestamp, not render work
    const updatedAt = Date.now();
    updateSqliteHomeProjectionProgress(
      queryClient,
      activeLibraryUserKey,
      book,
      progress,
      {
        currentTimeSeconds: progress.currentTime,
        durationSeconds: progress.duration,
        hideFromContinueListening: nextHiddenValue,
        isFinished: progress.isFinished,
        progressId: progress.progressId,
      },
    );
    await meApi.updateProgress(book.id, {
      currentTime: progress.currentTime,
      isFinished: progress.isFinished,
      hideFromContinueListening: nextHiddenValue,
    });
    await upsertShadowServerProgressProjection(activeLibraryUserKey, {
      ...progress,
      hideFromContinueListening: nextHiddenValue,
      lastUpdate: updatedAt,
    });
    queryClient.setQueryData<UserServerState>(
      queryKeys.userServerState(activeLibraryUserKey),
      (previousState) =>
        updateUserServerStateProgress(previousState, activeLibraryUserKey, {
          libraryItemId: book.id,
          currentTimeSeconds: progress.currentTime,
          durationSeconds: progress.duration,
          hideFromContinueListening: nextHiddenValue,
          isFinished: progress.isFinished,
          progressId: progress.progressId,
        }),
    );
    invalidateSqliteOverlayProjections(queryClient);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.booksInProgress(activeLibraryId),
    });
    toast.success(
      nextHiddenValue
        ? "Hidden from Continue Listening"
        : "Shown in Continue Listening",
    );
  };

  const handlePrimaryAction = async () => {
    if (busyAction || !canPlay) return;

    setBusyAction("primary");
    try {
      if (isBookPlaying) {
        await playerService.requestPause();
        return;
      }

      if (isBookLoaded) {
        await playerService.requestPlay();
        return;
      }

      await playerService.requestStart(book.id);
    } catch {
      toast.error(`Unable to ${primaryLabel.toLowerCase()}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleFinished = async () => {
    if (busyAction) return;

    const alertTitle = isMarkedFinished ? "Mark as Unread" : "Mark as Read";
    const alertMessage = isMarkedFinished
      ? `Reset "${book.title}" progress to the beginning and mark it as unread?`
      : isBookLoaded
        ? `Pause active playback, set progress in Audiobookshelf to the end of "${book.title}", and mark it as finished?`
        : `Set progress in Audiobookshelf to the end of "${book.title}" and mark it as finished?`;
    const confirmLabel = isMarkedFinished ? "Mark Unread" : "Mark Read";

    Alert.alert(alertTitle, alertMessage, [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: confirmLabel,
        onPress: () => {
          setBusyAction("finished");
          void (
            isMarkedFinished ? syncUnfinishedProgress() : syncFinishedProgress()
          )
            .catch(() => {
              invalidateSqliteOverlayProjections(queryClient);
              toast.error(
                isMarkedFinished
                  ? "Unable to mark as unread"
                  : "Unable to mark as read",
              );
            })
            .finally(() => {
              setBusyAction(null);
            });
        },
      },
    ]);
  };

  const handleToggleContinueListeningVisibility = async () => {
    if (busyAction || !canToggleContinueListeningVisibility) return;

    setBusyAction("hide");
    try {
      await toggleContinueListeningVisibility();
    } catch {
      invalidateSqliteOverlayProjections(queryClient);
      toast.error(
        `Unable to ${continueListeningVisibilityLabel.toLowerCase()}`,
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleFavorite = async () => {
    if (busyAction || !canToggleFavorite) return;

    setBusyAction("favorite");
    try {
      await toggleFavorite({
        libraryItemId: book.id,
        currentTags: book.tags,
        isFavorite,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleShareBook = async () => {
    if (busyAction || !book.id) return;

    try {
      await shareBook({
        libraryItemId: book.id,
        title: book.title,
        author: book.author,
        coverUri: book.coverFull ?? book.cover ?? null,
        localCoverUri: coverLocalUri,
        version: book.updatedAt,
      });
    } catch {
      toast.error("Unable to share book");
    }
  };

  const handleToggleShelfMembership = async (option: ShelfMembershipOption) => {
    if (busyAction || !canMutateShelves || !option.canMutate) return;

    setBusyAction("shelf");
    const scopeOptions = {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    };

    try {
      if (option.kind === "custom") {
        if (option.isMember) {
          removeBookFromCustomShelf(option.shelfId, book.id, scopeOptions);
        } else {
          addBookToCustomShelf(option.shelfId, book.id, scopeOptions);
        }
      } else {
        if (option.isMember) {
          await removeBooksFromPlaylistShelfOptimistic(
            option.shelfId,
            [book.id],
            scopeOptions,
          );
        } else {
          await addBooksToPlaylistShelfOptimistic(
            option.shelfId,
            [book.id],
            scopeOptions,
          );
        }
      }

      toast.success(
        option.isMember
          ? `Removed from ${option.title}`
          : `Added to ${option.title}`,
      );
    } catch {
      toast.error(
        `Unable to ${option.isMember ? "remove from" : "add to"} shelf`,
      );
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null || isToggleFavoritePending;
  const primaryDisabled = isBusy || !canPlay;
  const shareDisabled = isBusy || !book.id;
  const favoriteDisabled = isBusy || !canToggleFavorite;
  const finishDisabled = isBusy;
  const hideDisabled = isBusy || !canToggleContinueListeningVisibility;
  const shelfDisabled = isBusy || !canMutateShelves;

  const resolvedActions: ResolvedBookAction[] = actionIds
    ? actionIds.flatMap((id): ResolvedBookAction[] => {
        switch (id) {
          case "playPause":
            return [
              {
                id,
                label: primaryLabel,
                systemImage: primarySystemImage,
                visible: true,
                disabled: primaryDisabled,
                onPress: handlePrimaryAction,
              },
            ];
          case "bookshelves":
            return [
              {
                id,
                label: "Bookshelves",
                systemImage: "books.vertical",
                visible: true,
                disabled: shelfDisabled,
                shelfOptions: shelfMembershipOptions,
                onSelectShelfOption: handleToggleShelfMembership,
              },
            ];
          case "favorite":
            return [
              {
                id,
                label: favoriteLabel,
                systemImage: favoriteSystemImage,
                visible: true,
                disabled: favoriteDisabled,
                onPress: handleToggleFavorite,
              },
            ];
          case "readUnread":
            return [
              {
                id,
                label: finishedLabel,
                systemImage: finishedSystemImage,
                visible: true,
                disabled: finishDisabled,
                onPress: handleToggleFinished,
              },
            ];
          case "share":
            return [
              {
                id,
                label: shareLabel,
                systemImage: shareSystemImage,
                visible: true,
                disabled: shareDisabled,
                onPress: handleShareBook,
              },
            ];
          case "viewAuthor": {
            const author = book.author?.trim();
            if (!author || !actionHandlers?.viewAuthor) return [];

            return [
              {
                id,
                label: "View Author",
                systemImage: "person.text.rectangle",
                visible: true,
                disabled: false,
                onPress: () => actionHandlers.viewAuthor?.({ book }),
              },
            ];
          }
          case "continueListeningVisibility":
            if (!hasContinueListeningVisibilityOption) return [];

            return [
              {
                id,
                label: continueListeningVisibilityLabel,
                systemImage: continueListeningVisibilityIcon,
                visible: true,
                disabled: hideDisabled,
                onPress: handleToggleContinueListeningVisibility,
              },
            ];
        }
      })
    : [];

  return {
    canMutateShelves,
    isBusy,
    primaryDisabled,
    shareDisabled,
    favoriteDisabled,
    finishDisabled,
    hideDisabled,
    shelfDisabled,
    continueListeningVisibilityIcon,
    continueListeningVisibilityLabel,
    favoriteLabel,
    favoriteSystemImage,
    finishedLabel,
    finishedSystemImage,
    shareLabel,
    shareSystemImage,
    hasContinueListeningVisibilityOption,
    primaryLabel,
    primarySystemImage,
    handleShareBook,
    handleToggleShelfMembership,
    shelfMembershipOptions,
    handleToggleContinueListeningVisibility,
    handlePrimaryAction,
    handleToggleFavorite,
    handleToggleFinished,
    resolvedActions,
  };
};
