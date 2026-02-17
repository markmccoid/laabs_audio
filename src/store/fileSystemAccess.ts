import * as FileSystem from "expo-file-system/legacy";

export type DownloadFileResult = {
  task: Promise<FileSystem.FileSystemDownloadResult | undefined>;
  cancelDownload: () => Promise<void>;
  cleanFileName: string;
  fileUri: string;
  nativePath: string;
};

const sanitizeFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

export const getDocumentDirectory = () => FileSystem.documentDirectory ?? null;

export const ensureDirectory = async (directoryUri: string) => {
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
};

export const deleteFromFileSystem = async (fileUri: string) => {
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  } catch {
    // Ignore cleanup errors
  }
};

export const downloadFileBlob = (
  url: string,
  filename: string,
  onProgress?: (received: number, total: number) => void,
  options?: { directory?: string; headers?: Record<string, string> },
): DownloadFileResult => {
  const cleanFileName = sanitizeFileName(filename);
  const directory = options?.directory ?? FileSystem.documentDirectory ?? "";
  const fileUri = directory.endsWith("/") ? `${directory}${cleanFileName}` : `${directory}/${cleanFileName}`;

  // Use the legacy download task internally, wrapped in this helper for future swaps.
  const task = FileSystem.createDownloadResumable(
    url,
    fileUri,
    { headers: options?.headers },
    (progress) => {
      const received = progress.totalBytesWritten ?? 0;
      const total = progress.totalBytesExpectedToWrite ?? 0;
      onProgress?.(received, total);
    },
  );

  return {
    task: task.downloadAsync(),
    cancelDownload: () => task.cancelAsync(),
    cleanFileName,
    fileUri,
    nativePath: fileUri.replace(/^file:\/\//, ""),
  };
};
