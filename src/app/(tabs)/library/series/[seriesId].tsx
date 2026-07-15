import { SeriesDetailScreen } from "@/components/LibraryTab/series-detail-screen";
import { useLocalSearchParams } from "expo-router";

const getFirstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function SeriesDetailRoute() {
  const { seriesId } = useLocalSearchParams<{ seriesId?: string | string[] }>();
  return <SeriesDetailScreen seriesId={getFirstParam(seriesId) ?? ""} />;
}
