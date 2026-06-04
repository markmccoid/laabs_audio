import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";
import { authService } from "../auth/auth-service";
import { authStore } from "../auth/auth-store";

export type DownloadSpec = {
  url: string;
  urlWithToken: string;
  authHeader: Record<string, string>;
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

    const authHeader = {
      Authorization: `Bearer ${token}`,
      "Accept-Encoding": "identity",
    };
    const url = `${serverUrl}/api/items/${encodeURIComponent(itemId)}/file/${encodeURIComponent(fileIno)}/download`;
    const urlWithToken = `${url}?token=${encodeURIComponent(token)}`;

    return { url, urlWithToken, authHeader, libraryItemId: itemId };
  },

  async downloadEbook(itemId: string, fileIno: string, filenameWithExt: string) {
    let tempFile: File | null = null;
    const { urlWithToken, authHeader } = await downloadsApi.getDownloadSpec(itemId, fileIno);

    try {
      // 1. Check for cache directory using the new Paths API
      if (!Paths.cache) {
        throw new Error("Cache directory not available on this platform");
      }

      // 2. Create the temporary directory using the new Directory class
      const tempDir = new Directory(Paths.cache, "temp_downloads");
      // 'idempotent: true' prevents an error from being thrown if the directory already exists
      tempDir.create({ intermediates: true, idempotent: true });

      // 3. Define the temporary file destination
      tempFile = new File(tempDir, filenameWithExt);

      // 4. Download the file using the modern downloadFileAsync method
      const output = await File.downloadFileAsync(urlWithToken, tempFile, {
        headers: authHeader as Record<string, string>,
      });

      // The new API returns the downloaded File object rather than a status payload
      if (output.exists) {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(output.uri);
        } else {
          Alert.alert("Download Complete", "File downloaded successfully");
        }
      } else {
        throw new Error("Download failed: File could not be retrieved.");
      }
    } catch (error) {
      console.error("Download error:", error);
      Alert.alert("Download Failed", "Unable to download the file. Please try again.");
    } finally {
      // 5. Clean up the temporary file synchronously using the new object methods
      if (tempFile && tempFile.exists) {
        try {
          tempFile.delete();
        } catch (cleanupError) {
          console.warn("Failed to clean up temporary file:", cleanupError);
        }
      }
    }
  },
};
