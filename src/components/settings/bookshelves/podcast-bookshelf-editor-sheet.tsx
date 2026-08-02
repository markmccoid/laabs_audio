import { BookshelfEditorView } from "./bookshelf-editor-view";
import { usePodcastBookshelfEditor } from "./use-podcast-bookshelf-editor";

export const PodcastBookshelfEditorSheet = () => (
  <BookshelfEditorView controller={usePodcastBookshelfEditor()} />
);
