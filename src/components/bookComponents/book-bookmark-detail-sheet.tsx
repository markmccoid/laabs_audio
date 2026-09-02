import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import { BookmarkEditorView } from "@/components/bookmarks/bookmark-editor-view";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService } from "@/player";
import { resolveClipExportAvailability, resolveClipExportSourcePlan } from "@/sharing/clip-export";
import {
  deleteClipExportFile,
  extractClipExportFile,
  getClipExportErrorMessage,
} from "@/sharing/clip-export-extractor";
import {
  createClipTranscriptExportFile,
  deleteClipTranscriptExportFile,
} from "@/sharing/clip-transcript-export";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import {
  deriveClipTextForRange,
  isClipRangeTranscribed,
  resolveClipTranscriptionAvailability,
  resolveSectionTitle,
  transcribeClipSourcePlan,
  type ClipTextSource,
} from "@/transcription";
import {
  logClipTranscriptExportFailure,
  type ClipTranscriptExportStage,
} from "@/transcription/clip-transcript-export-log";
import type { Bookmark } from "@/types/absTypes";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Keyboard } from "react-native";
import { toast } from "react-native-sonner";
import { useBookAddBookmarkDraft } from "./book-addbookmark-draft-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getClipTranscriptExportErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unable to export clip transcript";
};

const areDraftAndBookmarkEqual = (
  draft: ReturnType<typeof useBookAddBookmarkDraft>,
  bookmark: LocalBookmarkRecord,
) => {
  const draftKind = draft.kind === "clip" && draft.clipEndSeconds !== null ? "clip" : "point";
  return (
    draftKind === bookmark.kind &&
    draft.title.trim() === bookmark.title.trim() &&
    draft.localNote.trim() === (bookmark.note ?? "").trim() &&
    draft.positionSeconds === bookmark.startTimeSeconds &&
    (draftKind === "clip" ? draft.clipEndSeconds : null) ===
      (bookmark.kind === "clip" ? (bookmark.endTimeSeconds ?? null) : null)
  );
};

export const BookBookmarkDetailSheet = () => {
  const draft = useBookAddBookmarkDraft();
  const { addBookmark } = useDeviceBooksActions();
  const { libraryItemId: libraryItemIdParam, bookmarkId: bookmarkIdParam } =
    useLocalSearchParams<{
      libraryItemId?: string | string[];
      bookmarkId?: string | string[];
    }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const bookmarkId = resolveParam(bookmarkIdParam);
  const resolvedUserKey = useResolvedListeningOwnerKey(libraryItemId);
  const bookmark = useDeviceBooksStore((state) =>
    resolvedUserKey && bookmarkId
      ? state.localBookmarksByUser[resolvedUserKey]?.[bookmarkId]
      : null,
  );
  const downloadInfo = useDeviceBooksStore((state) =>
    libraryItemId ? state.downloadedBookData[libraryItemId] : undefined,
  );
  const activeDownloadLibraryItemId = useDeviceBooksStore(
    (state) => state.activeDownloadSession?.libraryItemId,
  );
  const { data: itemDetails } = useGetItemDetails(libraryItemId);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingTranscript, setIsExportingTranscript] = useState(false);
  const seededBookmarkIdRef = useRef<string | null>(null);
  const isClip = draft.kind === "clip" && draft.clipEndSeconds !== null;
  const hasUnsavedChanges = Boolean(bookmark && !areDraftAndBookmarkEqual(draft, bookmark));
  const bookTitle = itemDetails?.title ?? itemDetails?.media?.metadata?.title ?? "Book";
  const savedPlan = useMemo(() => {
    if (!bookmark || bookmark.kind !== "clip" || !libraryItemId || !bookmark.endTimeSeconds) {
      return null;
    }
    return resolveClipExportSourcePlan({
      libraryItemId,
      downloadInfo,
      itemDetails,
      range: {
        startTimeSeconds: bookmark.startTimeSeconds,
        endTimeSeconds: bookmark.endTimeSeconds,
      },
    });
  }, [bookmark, downloadInfo, itemDetails, libraryItemId]);
  const audioAvailability = useMemo(
    () =>
      resolveClipExportAvailability(savedPlan, {
        hasDownloadedAudio: Boolean(downloadInfo?.audioTracks.length),
      }),
    [downloadInfo?.audioTracks.length, savedPlan],
  );
  const transcriptAvailability = useMemo(
    () =>
      resolveClipTranscriptionAvailability(savedPlan, {
        hasDownloadedAudio: Boolean(downloadInfo?.audioTracks.length),
      }),
    [downloadInfo?.audioTracks.length, savedPlan],
  );
  /**
   * Whether the Book Transcript already covers this clip (ADR 0036). Checked on
   * open rather than at export time so the button's enabled state tells the
   * truth: a cross-track clip the recognizer refuses can still be exported when
   * the transcript reaches it, and only this answer knows that.
   */
  const [isTranscribed, setIsTranscribed] = useState(false);
  const clipEndSeconds = bookmark?.kind === "clip" ? (bookmark.endTimeSeconds ?? null) : null;
  useEffect(() => {
    let cancelled = false;
    const resolveCoverage = async () => {
      if (!libraryItemId || !clipEndSeconds) return false;
      return isClipRangeTranscribed({ libraryItemId, endSeconds: clipEndSeconds });
    };
    void resolveCoverage()
      .catch(() => false)
      .then((covered) => {
        if (!cancelled) setIsTranscribed(covered);
      });
    return () => {
      cancelled = true;
    };
  }, [clipEndSeconds, libraryItemId]);

  const activeDownload = Boolean(libraryItemId && activeDownloadLibraryItemId === libraryItemId);
  const audioUnavailableReason =
    bookmark?.kind !== "clip"
      ? null
      : hasUnsavedChanges
        ? "Save changes before exporting"
        : activeDownload
          ? "Download is still finishing"
          : audioAvailability.available
            ? null
            : audioAvailability.reason;
  const transcriptUnavailableReason =
    bookmark?.kind !== "clip"
      ? null
      : hasUnsavedChanges
        ? "Save changes before exporting"
        : activeDownload
          ? "Download is still finishing"
          : isTranscribed
            ? null
            : process.env.EXPO_OS !== "ios"
              ? "Clip Transcription is unavailable on this platform"
              : transcriptAvailability.available
                ? null
                : transcriptAvailability.reason;
  const isBusy = isSaving || isExporting || isExportingTranscript;
  const canSave = Boolean(bookmark && draft.title.trim() && hasUnsavedChanges && !isBusy);
  const canExportAudio = Boolean(
    bookmark?.kind === "clip" &&
      !hasUnsavedChanges &&
      !activeDownload &&
      audioAvailability.available &&
      !isBusy,
  );
  const canExportTranscript = Boolean(
    bookmark?.kind === "clip" &&
      !hasUnsavedChanges &&
      !activeDownload &&
      // The transcript path needs no recognizer, no extractable audio plan and
      // no platform gate — only words already in SQLite (ADR 0036).
      (isTranscribed || (process.env.EXPO_OS === "ios" && transcriptAvailability.available)) &&
      !isBusy,
  );

  useEffect(() => {
    if (!bookmark || seededBookmarkIdRef.current === bookmark.id) return;
    draft.seedFromBookmark(bookmark);
    seededBookmarkIdRef.current = bookmark.id;
  }, [bookmark, draft]);

  useEffect(
    () => () => {
      void playerService.restoreListeningPositionAfterPreview();
    },
    [],
  );

  const closeDetail = useCallback(async () => {
    await playerService.restoreListeningPositionAfterPreview();
    Keyboard.dismiss();
    router.back();
  }, []);

  const requestCloseDetail = useCallback(() => {
    if (isBusy) return;
    if (!hasUnsavedChanges) {
      void closeDetail();
      return;
    }
    Alert.alert("Discard changes?", "Your bookmark changes have not been saved.", [
      { text: "Keep Editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void closeDetail() },
    ]);
  }, [closeDetail, hasUnsavedChanges, isBusy]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      requestCloseDetail();
      return true;
    });
    return () => subscription.remove();
  }, [requestCloseDetail]);

  const handleSave = async () => {
    if (!bookmark || !libraryItemId || !canSave) return;
    const localNote = draft.localNote.trim();
    const payload: Bookmark = {
      libraryItemId,
      time: draft.positionSeconds,
      title: draft.title.trim(),
      createdAt: bookmark.createdAt,
      ...(localNote ? { notes: localNote } : {}),
    };
    setIsSaving(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      await addBookmark(libraryItemId, payload, {
        userKey: resolvedUserKey,
        localBookmarkId: bookmark.id,
        localNote: localNote || null,
        endTimeSeconds: isClip ? draft.clipEndSeconds : null,
      });
      Keyboard.dismiss();
      toast.success(isClip ? "Clip saved" : "Bookmark saved");
      router.back();
    } catch (error) {
      console.warn("[BookBookmarkDetailSheet] Failed to save bookmark draft", error);
      toast.error("Unable to save bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportAudio = async () => {
    if (!bookmark || !savedPlan || !audioAvailability.available || !canExportAudio) {
      if (audioUnavailableReason) toast.info(audioUnavailableReason);
      return;
    }
    let fileUri: string | null = null;
    setIsExporting(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      const result = await extractClipExportFile({
        plan: savedPlan,
        bookTitle,
        bookmarkTitle: bookmark.title,
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
      console.warn("[BookBookmarkDetailSheet] Failed to export clip", error);
      toast.error(getClipExportErrorMessage(error));
    } finally {
      setIsExporting(false);
      await deleteClipExportFile(fileUri);
    }
  };

  const handleExportTranscript = async () => {
    if (!bookmark || !libraryItemId || !canExportTranscript) {
      if (transcriptUnavailableReason) toast.info(transcriptUnavailableReason);
      return;
    }
    const range = savedPlan?.range ?? {
      startTimeSeconds: bookmark.startTimeSeconds,
      endTimeSeconds: bookmark.endTimeSeconds ?? bookmark.startTimeSeconds,
    };
    let fileUri: string | null = null;
    let stage: ClipTranscriptExportStage = "unknown";
    try {
      setIsExportingTranscript(true);
      stage = "restore_listening_position";
      await playerService.restoreListeningPositionAfterPreview();

      // Source selection (ADR 0036): the Book Transcript answers when it covers
      // the range, and the recognizer runs only when it does not. An empty
      // derived result is an answer, not a reason to fall back — SpeechAnalyzer
      // found no words in that audio, so SFSpeechRecognizer will not either.
      stage = "derive_clip_text";
      const derived = await deriveClipTextForRange({
        libraryItemId,
        startSeconds: range.startTimeSeconds,
        endSeconds: range.endTimeSeconds,
      });

      let text: string;
      let source: ClipTextSource;
      let sectionTitle: string | null = null;
      if (derived.covered) {
        text = derived.text;
        source = "transcript";
        sectionTitle = await resolveSectionTitle(libraryItemId, range.startTimeSeconds);
      } else {
        if (!transcriptAvailability.available) throw new Error(transcriptAvailability.reason);
        if (!savedPlan) throw new Error("Downloaded audio is unavailable");
        stage = "transcribe_clip";
        const transcription = await transcribeClipSourcePlan({ plan: savedPlan });
        if (!transcription.text.trim()) throw new Error("Clip Transcription did not return text");
        text = transcription.text;
        source = "recognized";
      }

      stage = "create_export_file";
      const result = await createClipTranscriptExportFile({
        bookTitle,
        bookmarkTitle: bookmark.title,
        range,
        text,
        source,
        sectionTitle,
        note: bookmark.note,
      });
      fileUri = result.fileUri;
      stage = "check_sharing";
      if (!(await Sharing.isAvailableAsync())) {
        toast.info("Sharing is not available on this device");
        return;
      }
      stage = "share_export_file";
      await Sharing.shareAsync(fileUri, {
        dialogTitle: "Export clip transcript",
        mimeType: result.mimeType,
        UTI: result.uti,
      });
    } catch (error) {
      console.warn("[BookBookmarkDetailSheet] Failed to export clip transcript", error);
      logClipTranscriptExportFailure({
        trigger: "book_bookmark_edit",
        libraryItemId,
        bookTitle,
        bookmarkId: bookmark.id,
        bookmarkTitle: bookmark.title,
        range,
        stage,
        error,
      });
      toast.error(getClipTranscriptExportErrorMessage(error));
    } finally {
      setIsExportingTranscript(false);
      await deleteClipTranscriptExportFile(fileUri);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: isClip ? "Clip Bookmark" : "Bookmark Detail" }} />
      <BookmarkEditorView
        model={{
          mode: "detail",
          draft: {
            kind: draft.kind,
            title: draft.title,
            note: draft.localNote,
            startTimeSeconds: draft.positionSeconds,
            endTimeSeconds: draft.clipEndSeconds,
            createdAt: draft.createdAt,
          },
          recordFound: Boolean(bookmark),
          isBusy,
          isSaving,
          canSave,
          targetAvailable: Boolean(libraryItemId),
          export: {
            show: bookmark?.kind === "clip",
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
          onNoteChange: draft.setLocalNote,
          onAdjustPosition: (deltaSeconds) =>
            draft.setPointPosition(draft.positionSeconds + deltaSeconds),
          onClipModeChange: (enabled) => {
            if (enabled) {
              draft.convertToClipDraft();
            } else {
              draft.removeClip();
            }
          },
          onOpenClipEditor: () => {
            if (!bookmark || !draft.title.trim() || !isClip || isBusy) return;
            router.push("/book-bookmark-detail/clip-editor");
          },
          onSave: () => void handleSave(),
          onCancel: requestCloseDetail,
          onExportAudio: () => void handleExportAudio(),
          onExportTranscript: () => void handleExportTranscript(),
        }}
      />
    </>
  );
};
