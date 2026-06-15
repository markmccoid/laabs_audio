import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type DownloadLifecycleEvent,
  type DownloadProgress,
  type DownloadStage,
} from "@/store/device-books-store";
import { formatMegabytes } from "@/utils/formatUtils";
import { getBookDetailHref, type BookDetailRouteSource } from "@/navigation/book-links";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Text } from "react-native";
import { toast } from "react-native-sonner";

const ACTIVE_DOWNLOAD_TOAST_ID = "active-download";

const clampPercent = (value: number | undefined) => Math.max(0, Math.min(100, Math.round(value ?? 0)));

const buildLoadingTitle = (title: string | null, phase: DownloadStage, progress?: number) => {
  const resolvedTitle = title?.trim() ? title.trim() : "Downloading book";
  if (phase === "cancelling") {
    return (
      <Text selectable numberOfLines={1}>
        {`Cancelling · ${resolvedTitle}`}
      </Text>
    );
  }
  return (
    <Text selectable numberOfLines={1}>
      {`${clampPercent(progress)}% · ${resolvedTitle}`}
    </Text>
  );
};

const buildLoadingDescription = (progress?: DownloadProgress) => {
  if (!progress) {
    return (
      <Text selectable numberOfLines={1}>
        Preparing download...
      </Text>
    );
  }

  if (progress.stage === "finalizing") {
    return (
      <Text selectable numberOfLines={1}>
        Finalizing download...
      </Text>
    );
  }

  const currentFileName = progress.currentFileName?.trim();
  if (!currentFileName) {
    return (
      <Text selectable numberOfLines={1}>
        Preparing download...
      </Text>
    );
  }

  const filePosition =
    progress.numberOfFiles > 1 && progress.currentFileIndex > 0
      ? `File ${progress.currentFileIndex}/${progress.numberOfFiles} · `
      : "";

  return (
    <Text selectable numberOfLines={2}>
      {`${filePosition}${currentFileName} · ${formatMegabytes(progress.currentFileSize)}`}
    </Text>
  );
};

const openDownloadSheetFromToast = (
  libraryItemId: string,
  sourceBookRoute?: BookDetailRouteSource | null,
) => {
  router.push(
    getBookDetailHref(libraryItemId, {
      openDownloadSheet: String(Date.now()),
      routeSource: sourceBookRoute,
    }),
  );
};

const buildTerminalToast = (event: DownloadLifecycleEvent) => {
  switch (event.status) {
    case "completed":
      return {
        type: "success" as const,
        title: "Download complete",
        description: event.title?.trim() ?? "This book is ready for offline playback.",
        duration: 4_000,
      };
    case "failed":
      return {
        type: "error" as const,
        title: "Download failed",
        description: event.errorMessage?.trim() || "Unable to download the book. Please try again.",
        duration: 5_000,
      };
    case "cancelled":
      return {
        type: "info" as const,
        title: "Download cancelled",
        description: event.title?.trim() ?? "The download was cancelled.",
        duration: 3_000,
      };
  }
};

export const ActiveDownloadToastCoordinator = () => {
  const { cancelDownload, clearLastDownloadEvent } = useDeviceBooksActions();
  const activeDownloadSession = useDeviceBooksStore((state) => state.activeDownloadSession);
  const downloadProgress = useDeviceBooksStore((state) => state.downloadProgress);
  const lastDownloadEvent = useDeviceBooksStore((state) => state.lastDownloadEvent);
  const lastHandledEventIdRef = useRef<number | null>(null);
  const cancelRequestedRef = useRef(false);
  const lastLoadingSignatureRef = useRef<string | null>(null);
  const currentToastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeDownloadSession) {
      cancelRequestedRef.current = false;
      lastLoadingSignatureRef.current = null;
      return;
    }

    const title = buildLoadingTitle(
      activeDownloadSession.title,
      activeDownloadSession.phase,
      downloadProgress?.progress,
    );
    const description = buildLoadingDescription(downloadProgress);
    const toastId = `${ACTIVE_DOWNLOAD_TOAST_ID}-${activeDownloadSession.libraryItemId}-${activeDownloadSession.startedAt}`;
    currentToastIdRef.current = toastId;
    const canOpen = Boolean(activeDownloadSession.libraryItemId);
    const canCancel = !(activeDownloadSession.phase === "cancelling" || cancelRequestedRef.current);
    const signature = JSON.stringify({
      toastId,
      phase: activeDownloadSession.phase,
      progress: downloadProgress?.progress ?? null,
      currentFileName: downloadProgress?.currentFileName ?? null,
      currentFileSize: downloadProgress?.currentFileSize ?? null,
      stage: downloadProgress?.stage ?? null,
      canOpen,
      canCancel,
    });

    if (lastLoadingSignatureRef.current === signature) {
      return;
    }

    lastLoadingSignatureRef.current = signature;

    const options = {
      id: toastId,
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
      important: true,
      description,
      action: canOpen
        ? {
            label: "Open",
            onClick: () => {
              openDownloadSheetFromToast(
                activeDownloadSession.libraryItemId,
                activeDownloadSession.sourceBookRoute,
              );
            },
          }
        : undefined,
      cancel: canCancel
        ? {
            label: "Cancel",
            onClick: () => {
              if (cancelRequestedRef.current) return;
              cancelRequestedRef.current = true;
              lastLoadingSignatureRef.current = null;
              toast.update(toastId, {
                type: "loading",
                title: buildLoadingTitle(activeDownloadSession.title, "cancelling"),
                description: buildLoadingDescription(
                  downloadProgress
                    ? {
                        ...downloadProgress,
                        stage: "cancelling",
                      }
                    : undefined,
                ),
                duration: Number.POSITIVE_INFINITY,
                dismissible: false,
                important: true,
                action: canOpen
                  ? {
                      label: "Open",
                      onClick: () => {
                        openDownloadSheetFromToast(
                          activeDownloadSession.libraryItemId,
                          activeDownloadSession.sourceBookRoute,
                        );
                      },
                    }
                  : undefined,
                cancel: undefined,
              });
              void cancelDownload();
            },
          }
        : undefined,
    } as const;

    if (toast.isActive(toastId)) {
      toast.update(toastId, {
        type: "loading",
        title,
        ...options,
      });
      return;
    }

    toast.loading(title, options);
  }, [activeDownloadSession, cancelDownload, downloadProgress]);

  useEffect(() => {
    if (!lastDownloadEvent) {
      return;
    }
    if (lastHandledEventIdRef.current === lastDownloadEvent.id) {
      return;
    }

    lastHandledEventIdRef.current = lastDownloadEvent.id;
    cancelRequestedRef.current = false;
    lastLoadingSignatureRef.current = null;
    const toastId = currentToastIdRef.current ?? `${ACTIVE_DOWNLOAD_TOAST_ID}-${lastDownloadEvent.id}`;

    const nextToast = buildTerminalToast(lastDownloadEvent);
    const didUpdate = toast.update(toastId, {
      type: nextToast.type,
      title: nextToast.title,
      description: nextToast.description,
      duration: nextToast.duration,
      dismissible: true,
      important: false,
      action: undefined,
      cancel: undefined,
    });

    if (!didUpdate) {
      toast[nextToast.type](nextToast.title, {
        id: toastId,
        description: nextToast.description,
        duration: nextToast.duration,
        dismissible: true,
        action: undefined,
        cancel: undefined,
      });
    }

    clearLastDownloadEvent();
  }, [clearLastDownloadEvent, lastDownloadEvent]);

  return null;
};

export default ActiveDownloadToastCoordinator;
