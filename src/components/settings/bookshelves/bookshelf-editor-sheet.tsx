import { BookshelfEditorView } from "./bookshelf-editor-view";
import { useBookBookshelfEditor } from "./use-book-bookshelf-editor";

export const BookshelfEditorSheet = () => (
  <BookshelfEditorView controller={useBookBookshelfEditor()} />
);
