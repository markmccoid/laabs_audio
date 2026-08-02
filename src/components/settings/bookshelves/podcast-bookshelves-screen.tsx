import { BookshelvesSettingsView } from "./bookshelves-settings-view";
import { usePodcastBookshelvesSettings } from "./use-podcast-bookshelves-settings";

export const PodcastBookshelvesScreen = () => (
  <BookshelvesSettingsView controller={usePodcastBookshelvesSettings()} />
);
