import {
  areBookmarkDraftAndRecordEqual,
  type BookmarkViewRecord,
} from "@/bookmarks/bookmark-contracts";
import { BookmarkEditorView } from "@/components/bookmarks/bookmark-editor-view";
import {
  selectEpisodeBookmark,
  useEpisodeBookmarkActions,
  useEpisodeBookmarksStore,
  useResolvedEpisodeListeningOwnerKey,
} from "@/podcast/episode-bookmarks-store";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import { playerService } from "@/player";
import { resolveClipExportAvailability } from "@/sharing/clip-export";
import {
  deleteClipExportFile,
  extractClipExportFile,
  getClipExportErrorMessage,
} from "@/sharing/clip-export-extractor";
import {
  createClipTranscriptExportFile,
  deleteClipTranscriptExportFile,
} from "@/sharing/clip-transcript-export";
import { resolveEpisodeClipExportSourcePlan } from "@/sharing/episode-clip-export";
import { useDeviceEpisodeDownloadsStore } from "@/store/device-episode-downloads-store";
import {
  resolveClipTranscriptionAvailability,
  transcribeClipSourcePlan,
} from "@/transcription";
import { router, Stack } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, BackHandler, Keyboard } from "react-native";
import { toast } from "react-native-sonner";
import { useEpisodeBookmarkDraft } from "./episode-bookmark-draft-context";

export const EpisodeBookmarkEditorScreen = () => {
  const draft = useEpisodeBookmarkDraft();
  const ownerUserId = useResolvedEpisodeListeningOwnerKey(draft.identity);
  const { save } = useEpisodeBookmarkActions();
  const savedBookmark = useEpisodeBookmarksStore((state) =>
    selectEpisodeBookmark(state, ownerUserId, draft.bookmarkId),
  );
  const key = episodeIdentityKey(draft.identity);
  const downloadInfo = useDeviceEpisodeDownloadsStore((state) =>
    key ? state.downloadedEpisodeData[key] : undefined,
  );
  const downloadDetails = useDeviceEpisodeDownloadsStore((state) =>
    key ? state.downloadedEpisodeDetailsById[key] : undefined,
  );
  const activeDownload = useDeviceEpisodeDownloadsStore((state) => state.activeDownloadSession);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingTranscript, setIsExportingTranscript] = useState(false);
  const isEditing = Boolean(draft.bookmarkId);
  const isClip = draft.kind === "clip" && draft.endTimeSeconds !== null;
  const viewDraft = {
    kind: draft.kind,
    title: draft.title,
    note: draft.note,
    startTimeSeconds: draft.startTimeSeconds,
    endTimeSeconds: draft.endTimeSeconds,
    createdAt: draft.createdAt,
  };
  const viewRecord: BookmarkViewRecord | null = savedBookmark
    ? {
        ...savedBookmark,
        endTimeSeconds: savedBookmark.endTimeSeconds ?? null,
      }
    : null;
  const hasUnsavedChanges = Boolean(
    isEditing && viewRecord && !areBookmarkDraftAndRecordEqual(viewDraft, viewRecord),
  );
  const savedPlan = useMemo(() => {
    if (!savedBookmark || savedBookmark.kind !== "clip" || !savedBookmark.endTimeSeconds) {
      return null;
    }
    return resolveEpisodeClipExportSourcePlan({
      identity: draft.identity,
      downloadInfo,
      downloadDetails,
      range: {
        startTimeSeconds: savedBookmark.startTimeSeconds,
        endTimeSeconds: savedBookmark.endTimeSeconds,
      },
    });
  }, [downloadDetails, downloadInfo, draft.identity, savedBookmark]);
  const audioAvailability = resolveClipExportAvailability(savedPlan, {
    hasDownloadedAudio: Boolean(downloadInfo?.audioTracks.length),
  });
  const transcriptAvailability = resolveClipTranscriptionAvailability(savedPlan, {
    hasDownloadedAudio: Boolean(downloadInfo?.audioTracks.length),
  });
  const isThisEpisodeDownloading =
    activeDownload?.libraryItemId === draft.identity.libraryItemId &&
    activeDownload?.episodeId === draft.identity.episodeId;
  const audioUnavailableReason =
    savedBookmark?.kind !== "clip"
      ? null
      : hasUnsavedChanges
        ? "Save changes before exporting"
        : isThisEpisodeDownloading
          ? "Download is still finishing"
          : process.env.EXPO_OS !== "ios"
            ? "Clip export is unavailable on this platform"
            : audioAvailability.available
              ? null
              : audioAvailability.reason;
  const transcriptUnavailableReason =
    savedBookmark?.kind !== "clip"
      ? null
      : hasUnsavedChanges
        ? "Save changes before exporting"
        : isThisEpisodeDownloading
          ? "Download is still finishing"
          : process.env.EXPO_OS !== "ios"
            ? "Clip Transcription is unavailable on this platform"
            : transcriptAvailability.available
              ? null
              : transcriptAvailability.reason;
  const isBusy = isSaving || isExporting || isExportingTranscript;
  const canSave = Boolean(
    ownerUserId &&
      draft.title.trim() &&
      !isBusy &&
      (!isEditing || (savedBookmark && hasUnsavedChanges)),
  );
  const canExportAudio = Boolean(
    savedPlan &&
      audioAvailability.available &&
      !audioUnavailableReason &&
      !hasUnsavedChanges &&
      !isBusy,
  );
  const canExportTranscript = Boolean(
    savedPlan &&
      transcriptAvailability.available &&
      !transcriptUnavailableReason &&
      !hasUnsavedChanges &&
      !isBusy,
  );

  useEffect(
    () => () => {
      void playerService.restoreListeningPositionAfterPreview();
    },
    [],
  );

  const closeEditor = useCallback(async () => {
    await playerService.restoreListeningPositionAfterPreview();
    Keyboard.dismiss();
    router.back();
  }, []);

  const requestClose = useCallback(() => {
    if (isBusy) return;
    if (!isEditing || !hasUnsavedChanges) {
      void closeEditor();
      return;
    }
    Alert.alert("Discard changes?", "Your bookmark changes have not been saved.", [
      { text: "Keep Editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void closeEditor() },
    ]);
  }, [closeEditor, hasUnsavedChanges, isBusy, isEditing]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]);

  const handleSave = async () => {
    if (!ownerUserId || !canSave) return;
    setIsSaving(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      save({
        id: draft.bookmarkId,
        userId: ownerUserId,
        identity: draft.identity,
        kind: draft.kind,
        startTimeSeconds: draft.startTimeSeconds,
        endTimeSeconds: draft.endTimeSeconds,
        title: draft.title,
        note: draft.note,
        createdAt: draft.createdAt,
      });
      Keyboard.dismiss();
      toast.success(isClip ? "Clip saved" : isEditing ? "Bookmark saved" : "Bookmark added");
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportAudio = async () => {
    if (!savedBookmark || !savedPlan || !audioAvailability.available || !canExportAudio) {
      if (audioUnavailableReason) toast.info(audioUnavailableReason);
      return;
    }
    let fileUri: string | null = null;
    setIsExporting(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      const result = await extractClipExportFile({
        plan: savedPlan,
        bookTitle: `${draft.podcastTitle} - ${draft.episodeTitle}`,
        bookmarkTitle: savedBookmark.title,
        outputFormat: audioAvailability.outputFormat,
      });
      fileUri = result.fileUri;
      if (!(await Sharing.isAvailableAsync())) {
        toast.info("Sharing is not available on this device");
        return;
      }
      await Sharing.shareAsync(fileUri, {
        dialogTitle: "Export clip",
        mimeType: result.mimeType,
        UTI: result.uti,
      });
    } catch (error) {
      toast.error(getClipExportErrorMessage(error));
    } finally {
      setIsExporting(false);
      await deleteClipExportFile(fileUri);
    }
  };

  const handleExportTranscript = async () => {
    if (
      !savedBookmark ||
      !savedPlan ||
      !transcriptAvailability.available ||
      !canExportTranscript
    ) {
      if (transcriptUnavailableReason) toast.info(transcriptUnavailableReason);
      return;
    }
    let fileUri: string | null = null;
    setIsExportingTranscript(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      const transcription = await transcribeClipSourcePlan({ plan: savedPlan });
      if (!transcription.text.trim()) throw new Error("Clip Transcription did not return text");
      const result = await createClipTranscriptExportFile({
        bookTitle: `${draft.podcastTitle} - ${draft.episodeTitle}`,
        sourceLabel: "Episode",
        sourceTitle: draft.episodeTitle,
        secondaryTitle: draft.podcastTitle,
        bookmarkTitle: savedBookmark.title,
        range: savedPlan.range,
        transcription,
      });
      fileUri = result.fileUri;
      if (!(await Sharing.isAvailableAsync())) {
        toast.info("Sharing is not available on this device");
        return;
      }
      await Sharing.shareAsync(fileUri, {
        dialogTitle: "Export clip transcript",
        mimeType: result.mimeType,
        UTI: result.uti,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export clip transcript");
    } finally {
      setIsExportingTranscript(false);
      await deleteClipTranscriptExportFile(fileUri);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: isEditing ? (isClip ? "Clip Bookmark" : "Bookmark Detail") : isClip ? "Create Clip" : "Add Bookmark",
        }}
      />
      <BookmarkEditorView
        model={{
          mode: isEditing ? "detail" : "add",
          draft: viewDraft,
          recordFound: !isEditing || Boolean(savedBookmark),
          isBusy,
          isSaving,
          canSave,
          targetAvailable: Boolean(draft.identity.libraryItemId && draft.identity.episodeId),
          targetUnavailableMessage:
            "No active episode is loaded. Start playback, then reopen this sheet.",
          persistenceNotice: "Audiobookshelf does not currently support episode-scoped bookmarks.",
          export: {
            show: savedBookmark?.kind === "clip",
            canExportAudio,
            canExportTranscript,
            isExportingAudio: isExporting,
            isExportingTranscript,
            audioUnavailableReason,
            transcriptUnavailableReason,
          },
        }}
        actions={{
          onTitleChange: draft.setTitle,
          onNoteChange: draft.setNote,
          onAdjustPosition: (deltaSeconds) =>
            draft.setPointTime(draft.startTimeSeconds + deltaSeconds),
          onOpenClipEditor: () => {
            if (!draft.title.trim() || isBusy) return;
            if (draft.kind !== "clip" || draft.endTimeSeconds === null) {
              draft.setClipRange(
                draft.startTimeSeconds,
                Math.min(draft.durationSeconds, draft.startTimeSeconds + 30),
              );
            }
            router.push(
              isEditing
                ? "/episode-bookmark-detail/clip-editor"
                : "/episode-addbookmark/clip-editor",
            );
          },
          onRemoveClip: draft.removeClip,
          onSave: () => void handleSave(),
          onCancel: requestClose,
          onExportAudio: () => void handleExportAudio(),
          onExportTranscript: () => void handleExportTranscript(),
        }}
      />
    </>
  );
};
