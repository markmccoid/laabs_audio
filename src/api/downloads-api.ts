import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";
import { authService } from "../auth/auth-service";
import { authStore } from "../auth/auth-store";

export type DownloadSpec = {
  url: string;
  urlWithToken: string;
  authHeader: { Authorization: string };
  libraryItemId: string;
};

const ensureAuthContext = async () => {
  const state = authStore.getState();
  const token = await state.actions.refreshSession({ force: false });
  const serverUrl = state.serverUrl;

  if (!token) {
    throw new Error("No access token available for download");
  }

  if (!serverUrl) {
    throw new Error("Missing server URL for download");
  }

  return {
    token,
    serverUrl: authService.normalizeServerUrl(serverUrl),
  };
};

export const downloadsApi = {
  async getDownloadSpec(itemId: string, fileIno: string): Promise<DownloadSpec> {
    const { token, serverUrl } = await ensureAuthContext();

    const authHeader = { Authorization: `Bearer ${token}` };
    const url = `${serverUrl}/api/items/${itemId}/file/${fileIno}/download`;
    const urlWithToken = `${url}?token=${token}`;

    return { url, urlWithToken, authHeader, libraryItemId: itemId };
  },

  async downloadEbook(itemId: string, fileIno: string, filenameWithExt: string) {
    let tempFileUri: string | null = null;
    const { url, authHeader } = await downloadsApi.getDownloadSpec(itemId, fileIno);

    try {
      if (!FileSystem.cacheDirectory) {
        throw new Error("Cache directory not available on this platform");
      }
      const tempDir = `${FileSystem.cacheDirectory}temp_downloads/`;
      await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
      tempFileUri = `${tempDir}${filenameWithExt}`;

      const downloadResult = await FileSystem.downloadAsync(url, tempFileUri, {
        headers: authHeader,
      });

      if (downloadResult.status === 200) {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(downloadResult.uri);
        } else {
          Alert.alert("Download Complete", "File downloaded successfully");
        }
      } else {
        throw new Error(`Download failed with status: ${downloadResult.status}`);
      }
    } catch (error) {
      console.error("Download error:", error);
      Alert.alert("Download Failed", "Unable to download the file. Please try again.");
    } finally {
      if (tempFileUri) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(tempFileUri);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(tempFileUri);
          }
        } catch (cleanupError) {
          console.warn("Failed to clean up temporary file:", cleanupError);
        }
      }
    }
  },
};
