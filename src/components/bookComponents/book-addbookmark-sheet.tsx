import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import { findBookmarkAtStartSecond } from "@/bookmarks/bookmark-contracts";
import { BookmarkEditorView } from "@/components/bookmarks/bookmark-editor-view";
import { playerService } from "@/player";
import { useDeviceBooksActions, useDeviceBooksStore } from "@/store/device-books-store";
import type { Bookmark } from "@/types/absTypes";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Keyboard } from "react-native";
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

  const localBookmarksForUser = useDeviceBooksStore((state) =>
    resolvedUserKey ? state.localBookmarksByUser[resolvedUserKey] : undefined,
  );
  // `addBookmark` adopts whatever record already holds this start second unless
  // told otherwise, so an occupied second is a fork in the flow, not a detail —
  // see ADR 0035 and `findBookmarkAtStartSecond`.
  const collidingBookmark = useMemo(() => {
    if (!draft.libraryItemId) return null;
    return findBookmarkAtStartSecond(
      Object.values(localBookmarksForUser ?? {}),
      draft.libraryItemId,
      draft.positionSeconds,
      { ignoreBookmarkId: draft.sourceBookmarkId ?? null },
    );
  }, [
    localBookmarksForUser,
    draft.libraryItemId,
    draft.positionSeconds,
    draft.sourceBookmarkId,
  ]);

  useEffect(
    () => () => {
      void playerService.restoreListeningPositionAfterPreview();
    },
    [],
  );

  const saveDraft = async ({ forceNewRecord }: { forceNewRecord: boolean }) => {
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
        // Replace threads the existing record's identity; Save as new refuses the
        // start-time match outright.
        localBookmarkId: forceNewRecord ? null : (collidingBookmark?.id ?? null),
        forceNewRecord,
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

  const handleSave = async () => {
    if (!draft.libraryItemId || !canSave) return;
    if (!collidingBookmark) {
      await saveDraft({ forceNewRecord: false });
      return;
    }

    Keyboard.dismiss();
    Alert.alert(
      "A bookmark already starts here",
      `"${collidingBookmark.title.trim()}" starts at the same second. Replace it, or keep both?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save as new",
          onPress: () => void saveDraft({ forceNewRecord: true }),
        },
        {
          text: "Replace",
          style: "destructive",
          onPress: () => void saveDraft({ forceNewRecord: false }),
        },
      ],
    );
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
