import { CollectionDetailScreen } from "@/components/LibraryTab/collection-detail-screen";
import { useLocalSearchParams } from "expo-router";

const getFirstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function CollectionDetailRoute() {
  const { collectionId } = useLocalSearchParams<{ collectionId?: string | string[] }>();

  return <CollectionDetailScreen collectionId={getFirstParam(collectionId) ?? ""} />;
}

