import { ImportedBookEditSheet } from "@/components/imported/imported-book-edit-sheet";
import { useLocalSearchParams } from "expo-router";

export default function ImportedBookEditRoute() {
  const { libraryItemId } = useLocalSearchParams<{ libraryItemId: string }>();
  return <ImportedBookEditSheet libraryItemId={libraryItemId} />;
}
