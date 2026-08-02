import { BookshelvesScreen } from "@/components/settings/bookshelves/bookshelves-screen";
import { PodcastBookshelvesScreen } from "@/components/settings/bookshelves/podcast-bookshelves-screen";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";

export default function BookshelvesRoute() {
  const experience = useActiveLibraryExperience();
  return experience === "podcast" ? <PodcastBookshelvesScreen /> : <BookshelvesScreen />;
}
