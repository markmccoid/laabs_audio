import { PlaylistDetailScreen } from "@/components/LibraryTab/playlist-detail-screen";
import { useLocalSearchParams } from "expo-router";

const getFirstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function PlaylistDetailRoute() {
  const { playlistId } = useLocalSearchParams<{ playlistId?: string | string[] }>();

  return <PlaylistDetailScreen playlistId={getFirstParam(playlistId) ?? ""} />;
}
