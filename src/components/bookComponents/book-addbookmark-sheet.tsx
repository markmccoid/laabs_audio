import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import { BookmarkEditorView } from "@/components/bookmarks/bookmark-editor-view";
import { playerService } from "@/player";
import { useDeviceBooksActions } from "@/store/device-books-store";
import type { Bookmark } from "@/types/absTypes";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { toast } from "react-native-sonner";
import { useBookAddBookmarkDraft } from "./book-addbookmark-draft-context";

export const BookAddBookmarkSheet = () => {
  const { addBookmark } = useDeviceBooksActions();
  const draft = useBookAddBookmarkDraft();
  const resolvedUserKey = useResolvedListeningOwnerKey(draft.libraryItemId);
  const [isSaving, setIsSaving] = useState(false);
  const isClip = draft.kind === "clip" && draft.clipEndSeconds !== null;
  const screenTitle = isClip ? "Create Clip" : "Add Bookmark";
  const canSave = Boolean(draft.libraryItemId && draft.title.trim() && !isSaving);

  useEffect(
    () => () => {
      void playerService.restoreListeningPositionAfterPreview();
    },
    [],
  );

  const handleSave = async () => {
    if (!draft.libraryItemId || !canSave) return;
    const title = draft.title.trim();
    const localNote = draft.localNote.trim();
    const bookmarkPayload: Bookmark = {
      libraryItemId: draft.libraryItemId,
      time: draft.positionSeconds,
      title,
      createdAt: Date.now(),
      ...(localNote ? { notes: localNote } : {}),
    };

    setIsSaving(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      await addBookmark(draft.libraryItemId, bookmarkPayload, {
        userKey: resolvedUserKey,
        localNote: localNote || null,
        endTimeSeconds: isClip ? draft.clipEndSeconds : null,
      });
      Keyboard.dismiss();
      toast.success(isClip ? "Clip saved" : "Bookmark added");
      router.back();
    } catch (error) {
      console.warn("[BookAddBookmarkSheet] Failed to add bookmark", error);
      toast.error("Unable to add bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const closeDraft = async () => {
    await playerService.restoreListeningPositionAfterPreview();
    Keyboard.dismiss();
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: screenTitle }} />
      <BookmarkEditorView
        model={{
          mode: "add",
          draft: {
            kind: draft.kind,
            title: draft.title,
            note: draft.localNote,
            startTimeSeconds: draft.positionSeconds,
            endTimeSeconds: draft.clipEndSeconds,
            createdAt: draft.createdAt,
          },
          recordFound: true,
          isBusy: isSaving,
          isSaving,
          canSave,
          targetAvailable: Boolean(draft.libraryItemId),
          targetUnavailableMessage:
            "No active book is loaded. Start playback, then reopen this sheet.",
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
            if (
              !draft.libraryItemId ||
              !draft.title.trim() ||
              draft.kind !== "clip" ||
              draft.clipEndSeconds === null ||
              isSaving
            ) {
              return;
            }
            router.push("/book-addbookmark/clip-editor");
          },
          onSave: () => void handleSave(),
          onCancel: () => void closeDraft(),
        }}
      />
    </>
  );
};
