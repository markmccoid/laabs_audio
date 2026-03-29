import * as FileSystem from "expo-file-system/legacy";

export const AMBIENT_DOWNLOAD_DIRECTORY = "laabs-ambient";
export const BOOK_DOWNLOADS_DIRECTORY = "laabs-downloads";

export type DownloadFileResult = {
  task: Promise<FileSystem.FileSystemDownloadResult | undefined>;
  cancelDownload: () => Promise<void>;
  cleanFileName: string;
  fileUri: string;
  nativePath: string;
};

const sanitizeFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();

const normalizeRelativePath = (value: string) => value.replace(/^\/+/, "").trim();
const isAbsoluteUri = (value: string) =>
  value.startsWith("file://") ||
  value.startsWith("/") ||
  value.startsWith("http://") ||
  value.startsWith("https://") ||
  value.startsWith("content://") ||
  value.startsWith("data:");

export const getDocumentDirectory = () => FileSystem.documentDirectory ?? null;

export const ensureDirectory = async (directoryUri: string) => {
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });
};

export const ensureAppDirectory = async (relativeDirectory: string) => {
  const documentDirectory = getDocumentDirectory();
  if (!documentDirectory) {
    throw new Error("Missing document directory for app storage");
  }
  const normalizedRelativeDirectory = normalizeRelativePath(relativeDirectory);
  const directoryUri = documentDirectory.endsWith("/")
    ? `${documentDirectory}${normalizedRelativeDirectory}/`
    : `${documentDirectory}/${normalizedRelativeDirectory}/`;
  await ensureDirectory(directoryUri);
  return directoryUri;
};

export const isRelativeDocumentPath = (value?: string | null) =>
  typeof value === "string" && value.trim().length > 0 && !isAbsoluteUri(value.trim());

export const toDocumentRelativePath = (fileUri: string) => {
  const documentDirectory = getDocumentDirectory();
  if (!documentDirectory) return null;

  const normalizedUri = fileUri.trim();
  if (!normalizedUri.startsWith(documentDirectory)) {
    return null;
  }

  return normalizeRelativePath(normalizedUri.slice(documentDirectory.length));
};

export const resolveDocumentRelativePath = (relativePath?: string | null) => {
  if (!isRelativeDocumentPath(relativePath)) return null;

  const documentDirectory = getDocumentDirectory();
  if (!documentDirectory) return null;

  const safeRelativePath = relativePath as string;
  const normalizedRelativePath = normalizeRelativePath(safeRelativePath.trim());
  return documentDirectory.endsWith("/")
    ? `${documentDirectory}${normalizedRelativePath}`
    : `${documentDirectory}/${normalizedRelativePath}`;
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
