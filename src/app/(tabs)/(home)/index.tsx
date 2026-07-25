import HomeShelvesScreen from "@/components/Home/home-shelves-screen";
import { PodcastHomeShelvesScreen } from "@/components/podcast/podcast-home-shelves-screen";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";

export default function HomeIndex() {
  const experience = useActiveLibraryExperience();

  if (experience === "podcast") {
    return <PodcastHomeShelvesScreen />;
  }

  return experience === "book" ? <HomeShelvesScreen /> : null;
}
