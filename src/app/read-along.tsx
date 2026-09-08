import ReadAlongScreen from "@/components/read-along/read-along-screen";
import { useLocalSearchParams } from "expo-router";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const ReadAlongRoute = () => {
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    surface?: string | string[];
  }>();
  const libraryItemId = resolveParam(params.libraryItemId);

  // Keyed on the book so a deep link to another book rebuilds the reader's
  // bound state instead of leaving it pointed at the previous one.
  return (
    <ReadAlongScreen
      key={libraryItemId ?? "none"}
      libraryItemId={libraryItemId}
      // Chooses the *initial* surface only. The picker inside the screen stays
      // the source of truth afterwards.
      initialSurface={resolveParam(params.surface)}
    />
  );
};

export default ReadAlongRoute;
