import type { LibraryItemSummary } from "@/api/library-items-api";
import {
  createEmptyUserServerState,
  meApi,
  type UserBookProgress,
  type UserServerState,
} from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { useFavoriteBookAction } from "@/hooks/use-favorite-book-action";
import {
  resolveStoredDownloadCoverUri,
  selectHasPlayableBookDownload,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { shareBook } from "@/sharing/book-share";
import {
  useHomeShelves,
  type HomeCustomShelf,
  type HomePlaylistShelf,
} from "@/hooks/use-home-shelves";
import { playerService, usePlaybackStore } from "@/player";
import {
  clearSyncedProgressSyncIntent,
  recordProgressSyncIntent,
} from "@/progress/progress-sync-intent-store";
import { queryKeys } from "@/query/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

export type ShelfBookCardMenuProps = {
  book: LibraryItemSummary;
  progress?: UserBookProgress;
  isFavorite?: boolean;
};

export type SelectableShelf = HomeCustomShelf | HomePlaylistShelf;
export type ShelfMembershipOption = {
  shelf: SelectableShelf;
  isMember: boolean;
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
  const previousProgress = nextState.progressByLibraryItemId[payload.libraryItemId];
  const now = Date.now();
  const resolvedDuration =
    (payload.durationSeconds ?? 0) > 0
      ? payload.durationSeconds ?? 0
      : (previousProgress?.duration ?? 0);
  const resolvedCurrentTime = Math.max(
    0,
    Math.floor(payload.currentTimeSeconds ?? previousProgress?.currentTime ?? 0),
  );
  const progressPercent =
    resolvedDuration > 0
      ? Math.max(0, Math.min(1, resolvedCurrentTime / resolvedDuration))
      : (previousProgress?.progressPercent ?? 0);
  const resolvedIsFinished = payload.isFinished ?? previousProgress?.isFinished ?? false;
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
        finishedAt: resolvedIsFinished ? (previousProgress?.finishedAt ?? now) : null,
        lastUpdate: now,
      },
    },
  };
};

export const useShelfBookCardMenuActions = ({
  book,
  progress,
  isFavorite = false,
}: ShelfBookCardMenuProps) => {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOnline = useAuthStore((state) => state.isOnline);
  const { customShelves, playlistShelves } = useHomeShelves();
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
  const { canToggleFavorite, isToggleFavoritePending, toggleFavorite } = useFavoriteBookAction();

  const isBookActive = currentLibraryItemId === book.id;
  const isBookPlaying = isBookActive && playbackState === "playing";
  const isBookLoading = isBookActive && playbackState === "loading";
  const isBookLoaded = isBookActive && activeQueueLength > 0;
  const canPlay = !isBookLoading && (isOnline !== false || isDownloaded);
  const canMutateShelves = Boolean(activeLibraryId && activeLibraryUserKey);
  const hasStartedContinueListening =
    Math.max(0, Math.floor(progress?.currentTime ?? 0)) > 0 ||
    (progress?.progressPercent ?? 0) > 0;
  const hasContinueListeningVisibilityOption = Boolean(
    progress && hasStartedContinueListening && !progress.isFinished,
  );
  const canToggleContinueListeningVisibility = Boolean(
    authStatus === "authenticated" &&
    isOnline !== false &&
    hasContinueListeningVisibilityOption,
  );
  const primaryLabel = isBookPlaying ? "Pause" : "Play";
  const primarySystemImage: "pause.fill" | "play.fill" = isBookPlaying
    ? "pause.fill"
    : "play.fill";
  const isMarkedFinished = Boolean(progress?.isFinished);
  const finishedLabel = isMarkedFinished ? "Mark as Unread" : "Mark as Read";
  const finishedSystemImage: "arrow.counterclockwise.circle" | "checkmark.circle" =
    isMarkedFinished ? "arrow.counterclockwise.circle" : "checkmark.circle";
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
  const shelfMembershipOptions = useMemo<ShelfMembershipOption[]>(
    () =>
      [...customShelves, ...playlistShelves].map((shelf) => ({
        shelf,
        isMember: shelf.bookIds.includes(book.id),
      })),
    [book.id, customShelves, playlistShelves],
  );

  const syncFinishedProgress = async () => {
    const durationSeconds = Math.max(
      0,
      Math.floor(progress?.duration ?? 0),
      Math.floor(book.duration ?? 0),
      Math.floor(activeDurationMs / 1000),
    );

    if (activeLibraryUserKey) {
      queryClient.setQueryData<UserServerState>(
        queryKeys.userServerState(activeLibraryUserKey),
        (previousState) =>
          updateUserServerStateProgress(previousState, activeLibraryUserKey, {
            libraryItemId: book.id,
            currentTimeSeconds: durationSeconds,
            durationSeconds,
            isFinished: true,
          }),
      );
    }

    if (isBookLoaded) {
      await playerService.finishActiveBook({
        libraryItemId: book.id,
        durationSeconds,
      });
      toast.success("Marked read");
      return;
    }

    if (isOnline !== false && authStatus === "authenticated") {
      const intent = recordProgressSyncIntent({
        libraryItemId: book.id,
        currentTimeSeconds: durationSeconds,
        isFinished: true,
        title: book.title,
        trigger: "mark_read",
        intentKind: "mark_finished",
      });
      await meApi.updateProgress(book.id, {
        currentTime: durationSeconds,
        isFinished: true,
      });
      clearSyncedProgressSyncIntent({
        libraryItemId: book.id,
        syncedThroughUpdatedAt: intent?.updatedAt ?? Date.now(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booksInProgress(activeLibraryId),
      });
      toast.success("Marked read");
      return;
    }

    recordProgressSyncIntent({
      libraryItemId: book.id,
      currentTimeSeconds: durationSeconds,
      isFinished: true,
      title: book.title,
      trigger: "mark_read_offline",
      intentKind: "mark_finished",
    });
    toast.success("Marked read offline");
  };

  const syncUnfinishedProgress = async () => {
    const durationSeconds = Math.max(
      0,
      Math.floor(progress?.duration ?? 0),
      Math.floor(book.duration ?? 0),
      Math.floor(activeDurationMs / 1000),
    );

    if (activeLibraryUserKey) {
      queryClient.setQueryData<UserServerState>(
        queryKeys.userServerState(activeLibraryUserKey),
        (previousState) =>
          updateUserServerStateProgress(previousState, activeLibraryUserKey, {
            libraryItemId: book.id,
            currentTimeSeconds: 0,
            durationSeconds,
            isFinished: false,
            progressId: progress?.progressId,
          }),
      );
    }

    if (isOnline !== false && authStatus === "authenticated") {
      const intent = recordProgressSyncIntent({
        libraryItemId: book.id,
        currentTimeSeconds: 0,
        isFinished: false,
        title: book.title,
        trigger: "mark_unread",
        intentKind: "mark_unread",
      });
      await meApi.updateProgress(book.id, {
        currentTime: 0,
        isFinished: false,
        hideFromContinueListening: progress?.hideFromContinueListening ?? false,
      });
      clearSyncedProgressSyncIntent({
        libraryItemId: book.id,
        syncedThroughUpdatedAt: intent?.updatedAt ?? Date.now(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booksInProgress(activeLibraryId),
      });
      toast.success("Marked unread");
      return;
    }

    recordProgressSyncIntent({
      libraryItemId: book.id,
      currentTimeSeconds: 0,
      isFinished: false,
      title: book.title,
      trigger: "mark_unread_offline",
      intentKind: "mark_unread",
    });
    toast.success("Marked unread offline");
  };

  const toggleContinueListeningVisibility = async () => {
    if (!activeLibraryUserKey || !progress) {
      toast.error("No progress found to update");
      return;
    }

    const nextHiddenValue = !progress.hideFromContinueListening;
    await meApi.updateProgress(book.id, {
      currentTime: progress.currentTime,
      isFinished: progress.isFinished,
      hideFromContinueListening: nextHiddenValue,
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
    void queryClient.invalidateQueries({
      queryKey: queryKeys.booksInProgress(activeLibraryId),
    });
    toast.success(
      nextHiddenValue ? "Hidden from Continue Listening" : "Shown in Continue Listening",
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

    Alert.alert(
      alertTitle,
      alertMessage,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: confirmLabel,
          onPress: () => {
            setBusyAction("finished");
            void (isMarkedFinished ? syncUnfinishedProgress() : syncFinishedProgress())
              .catch(() => {
                toast.error(
                  isMarkedFinished ? "Unable to mark as unread" : "Unable to mark as read",
                );
              })
              .finally(() => {
                setBusyAction(null);
              });
          },
        },
      ],
    );
  };

  const handleToggleContinueListeningVisibility = async () => {
    if (busyAction || !canToggleContinueListeningVisibility) return;

    setBusyAction("hide");
    try {
      await toggleContinueListeningVisibility();
    } catch {
      toast.error(`Unable to ${continueListeningVisibilityLabel.toLowerCase()}`);
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
      });
    } catch {
      toast.error("Unable to share book");
    }
  };

  const handleToggleShelfMembership = async (shelf: SelectableShelf, isMember: boolean) => {
    if (busyAction || !canMutateShelves) return;

    setBusyAction("shelf");
    const scopeOptions = {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    };

    try {
      if (shelf.kind === "custom") {
        if (isMember) {
          removeBookFromCustomShelf(shelf.id, book.id, scopeOptions);
        } else {
          addBookToCustomShelf(shelf.id, book.id, scopeOptions);
        }
      } else {
        if (isMember) {
          await removeBooksFromPlaylistShelfOptimistic(shelf.id, [book.id], scopeOptions);
        } else {
          await addBooksToPlaylistShelfOptimistic(shelf.id, [book.id], scopeOptions);
        }
      }

      toast.success(isMember ? `Removed from ${shelf.title}` : `Added to ${shelf.title}`);
    } catch {
      toast.error(`Unable to ${isMember ? "remove from" : "add to"} bookshelf`);
    } finally {
      setBusyAction(null);
    }
  };

  return {
    canMutateShelves,
    isBusy: busyAction !== null || isToggleFavoritePending,
    primaryDisabled: busyAction !== null || isToggleFavoritePending || !canPlay,
    shareDisabled: busyAction !== null || isToggleFavoritePending || !book.id,
    favoriteDisabled: busyAction !== null || isToggleFavoritePending || !canToggleFavorite,
    finishDisabled: busyAction !== null || isToggleFavoritePending,
    hideDisabled:
      busyAction !== null || isToggleFavoritePending || !canToggleContinueListeningVisibility,
    shelfDisabled: busyAction !== null || isToggleFavoritePending || !canMutateShelves,
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
  };
};
