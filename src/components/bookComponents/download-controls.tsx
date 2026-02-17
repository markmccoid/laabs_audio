import type { LibraryItemSummary } from "@/api/library-items-api";
import { useAuthStore } from "@/auth/auth-store";
import { useBooksActions, useBooksStore } from "@/store/store-books";
import { Pressable, Text, View } from "react-native";

const formatPercent = (value: number | undefined) =>
  Number.isFinite(value) ? `${Math.max(0, Math.min(100, value))}%` : "0%";

type Props = {
  libraryItemId?: string;
  summary?: LibraryItemSummary | null;
};

const DownloadControls = ({ libraryItemId, summary }: Props) => {
  const { downloadBook, cancelDownload, deleteDownloadedBookData } = useBooksActions();
  const downloadProgress = useBooksStore((state) => state.downloadProgress);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const resolvedUserKey =
    activeLibraryUserKey ??
    (storedUsername && serverUrl ? `${storedUsername}::${serverUrl}` : null);
  const summaryFromStore = useBooksStore((state) => {
    if (!libraryItemId) return null;
    const key = resolvedUserKey ?? state.lastActiveUserKey;
    if (!key) return null;
    return state.byUserKey[key]?.books[libraryItemId] ?? null;
  });

  const isDownloaded = summaryFromStore?.isDownloaded ?? false;
  const isDownloading = downloadProgress?.libraryItemId === libraryItemId;
  const isAnotherDownloadActive =
    Boolean(downloadProgress?.libraryItemId) && downloadProgress?.libraryItemId !== libraryItemId;
  const progressValue = isDownloading ? (downloadProgress?.progress ?? 0) : 0;

  const handleDownload = () => {
    if (!libraryItemId) return;
    // Prefer the freshest summary for download metadata
    const resolvedSummary = summary ?? summaryFromStore ?? undefined;
    void downloadBook(libraryItemId, { summary: resolvedSummary });
  };

  const handleCancel = () => {
    void cancelDownload();
  };

  const handleDelete = () => {
    if (!libraryItemId) return;
    void deleteDownloadedBookData(libraryItemId);
  };

  return (
    <View
      style={{
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: "#f4d7b0",
        backgroundColor: "#fff7ed",
        padding: 16,
        gap: 10,
        boxShadow: "0 10px 22px rgba(120, 53, 15, 0.12)",
      }}
    >
      <Text
        selectable
        style={{ fontSize: 16, fontWeight: "600", color: "#7c2d12" }}
      >
        Offline Download
      </Text>
      <Text selectable style={{ fontSize: 12, color: "#92400e" }}>
        {isDownloaded
          ? "Downloaded and ready for offline playback."
          : "Download this book for offline playback."}
      </Text>

      {isDownloading ? (
        <View style={{ gap: 8 }}>
          <View
            style={{
              height: 6,
              width: "100%",
              borderRadius: 999,
              backgroundColor: "#fde8cd",
            }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 999,
                backgroundColor: "#f59e0b",
                width: `${progressValue}%`,
              }}
            />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text selectable style={{ fontSize: 12, color: "#b45309" }}>
              {downloadProgress?.currentFileProcessing ?? "Preparing download..."}
            </Text>
            <Text selectable style={{ fontSize: 12, color: "#b45309" }}>
              {formatPercent(progressValue)}
            </Text>
          </View>
          <Text selectable style={{ fontSize: 12, color: "#b45309" }}>
            {downloadProgress?.numberOfFilesDownloaded ?? 0}/{downloadProgress?.numberOfFiles ?? 0}{" "}
            files
          </Text>
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => ({
              marginTop: 4,
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: "#f59e0b",
              paddingVertical: 8,
              opacity: pressed ? 0.8 : 1,
              backgroundColor: "#fff7ed",
            })}
          >
            <Text
              selectable
              style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: "#7c2d12" }}
            >
              Cancel Download
            </Text>
          </Pressable>
        </View>
      ) : isDownloaded ? (
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: "#f59e0b",
              paddingVertical: 8,
              opacity: pressed ? 0.8 : 1,
              backgroundColor: "#fff7ed",
            })}
          >
            <Text
              selectable
              style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: "#7c2d12" }}
            >
              Delete Download
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={handleDownload}
            disabled={isAnotherDownloadActive}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              paddingVertical: 10,
              backgroundColor: isAnotherDownloadActive ? "#fdba74" : "#f97316",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              selectable
              style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: "#fff7ed" }}
            >
              {isAnotherDownloadActive ? "Download In Progress" : "Download Book"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

export default DownloadControls;
