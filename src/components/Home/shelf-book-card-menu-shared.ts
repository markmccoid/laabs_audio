import type { LibraryItemSummary } from "@/api/library-items-api";
import { meApi, type UserBookProgress, type UserServerState } from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import {
  selectHasPlayableBookDownload,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import {
  useHomeShelves,
  type HomeCustomShelf,
  type HomePlaylistShelf,
} from "@/hooks/use-home-shelves";
import { playerService, usePlaybackStore } from "@/player";
import { queryKeys } from "@/query/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

export type ShelfBookCardMenuProps = {
  book: LibraryItemSummary;
  progress?: UserBookProgress;
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
    userId: userKey,
    progressByLibraryItemId: {},
    bookmarksByLibraryItemId: {},
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

export const useShelfBookCardMenuActions = ({ book, progress }: ShelfBookCardMenuProps) => {
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
  const queueProgressSync = useDeviceBooksStore((state) => state.actions.queueProgressSync);
  const clearPendingProgressSync = useDeviceBooksStore(
    (state) => state.actions.clearPendingProgressSync,
  );
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const activeQueueLength = usePlaybackStore((state) =>
    state.libraryItemId === book.id ? state.queue.length : 0,
  );
  const activeDurationMs = usePlaybackStore((state) =>
    state.libraryItemId === book.id ? state.durationMs : 0,
  );
  const [busyAction, setBusyAction] = useState<"primary" | "finished" | "hide" | "shelf" | null>(
    null,
  );

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
  const primarySystemImage = isBookPlaying ? "pause.fill" : "play.fill";
  const isMarkedFinished = Boolean(progress?.isFinished);
  const finishedLabel = isMarkedFinished ? "Mark as Unread" : "Mark as Read";
  const finishedSystemImage = isMarkedFinished
    ? "arrow.counterclockwise.circle"
    : "checkmark.circle";
  const continueListeningVisibilityLabel = progress?.hideFromContinueListening
    ? "Show in Continue Listening"
    : "Hide from Continue Listening";
  const continueListeningVisibilityIcon = progress?.hideFromContinueListening ? "eye" : "eye.slash";
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

    if (isOnline !== false && authStatus === "authenticated") {
      await meApi.updateProgress(book.id, {
        currentTime: durationSeconds,
        isFinished: true,
      });
      clearPendingProgressSync(book.id);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booksInProgress(activeLibraryId),
      });
      toast.success("Marked read");
      return;
    }

    queueProgressSync(book.id, {
      currentTime: durationSeconds,
      isFinished: true,
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
      await meApi.updateProgress(book.id, {
        currentTime: 0,
        isFinished: false,
        hideFromContinueListening: progress?.hideFromContinueListening ?? false,
      });
      clearPendingProgressSync(book.id);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booksInProgress(activeLibraryId),
      });
      toast.success("Marked unread");
      return;
    }

    queueProgressSync(book.id, {
      currentTime: 0,
      isFinished: false,
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
        await playerService.pause();
        return;
      }

      if (isBookLoaded) {
        await playerService.play();
        return;
      }

      await playerService.loadBook(book.id, { autoPlay: true });
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
      : `Mark "${book.title}" as read and move progress to the end?`;
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
    isBusy: busyAction !== null,
    primaryDisabled: busyAction !== null || !canPlay,
    finishDisabled: busyAction !== null,
    hideDisabled: busyAction !== null || !canToggleContinueListeningVisibility,
    shelfDisabled: busyAction !== null || !canMutateShelves,
    continueListeningVisibilityIcon,
    continueListeningVisibilityLabel,
    finishedLabel,
    finishedSystemImage,
    hasContinueListeningVisibilityOption,
    primaryLabel,
    primarySystemImage,
    handleToggleShelfMembership,
    shelfMembershipOptions,
    handleToggleContinueListeningVisibility,
    handlePrimaryAction,
    handleToggleFinished,
  };
};
