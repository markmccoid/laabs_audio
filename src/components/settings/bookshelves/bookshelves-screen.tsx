import { BookshelvesSettingsView } from "./bookshelves-settings-view";
import { useBookBookshelvesSettings } from "./use-book-bookshelves-settings";

export const BookshelvesScreen = () => (
  <BookshelvesSettingsView controller={useBookBookshelvesSettings()} />
);
