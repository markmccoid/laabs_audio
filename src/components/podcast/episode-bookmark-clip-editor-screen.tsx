import {
  BookmarkDraftAdapterProvider,
  type BookmarkDraftContextValue,
} from "@/components/bookComponents/book-addbookmark-draft-context";
import { BookmarkClipEditor } from "@/components/bookmarks/bookmark-clip-editor";
import { useEpisodeBookmarkDraft } from "./episode-bookmark-draft-context";

export const EpisodeBookmarkClipEditorScreen = () => {
  const draft = useEpisodeBookmarkDraft();
  const adapter: BookmarkDraftContextValue = {
    kind: draft.kind,
    sourceBookmarkId: draft.bookmarkId,
    sourceBookmarkKind: draft.sourceBookmarkKind,
    libraryItemId: draft.identity.libraryItemId,
    targetEpisodeId: draft.identity.episodeId,
    mediaDurationSeconds: draft.durationSeconds,
    title: draft.title,
    localNote: draft.note,
    positionSeconds: draft.startTimeSeconds,
    clipEndSeconds: draft.endTimeSeconds,
    createdAt: draft.createdAt,
    setTitle: draft.setTitle,
    setLocalNote: draft.setNote,
    setPointPosition: draft.setPointTime,
    setClipRange: draft.setClipRange,
    convertToClipDraft: () => {
      const endSeconds = Math.min(
        draft.durationSeconds,
        draft.startTimeSeconds + 30,
      );
      draft.setClipRange(draft.startTimeSeconds, endSeconds);
    },
    removeClip: draft.removeClip,
    seedFromBookmark: () => {
      // Episode drafts are seeded by EpisodeBookmarkDraftProvider.
    },
  };

  return (
    <BookmarkDraftAdapterProvider value={adapter}>
      <BookmarkClipEditor />
    </BookmarkDraftAdapterProvider>
  );
};
