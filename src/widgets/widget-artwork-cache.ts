import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

const AUDIO_WIDGET_APP_GROUP = "group.com.markmccoid.laabs-audio";
const WIDGETS_DIRECTORY_NAME = "ExpoWidgets";
const DEFAULT_ARTWORK_EXTENSION = "jpg";
const SUPPORTED_ARTWORK_EXTENSIONS = new Set([
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

export type CacheWidgetArtworkInput = {
  sourceUri?: string | null;
  libraryItemId: string;
};

export type WidgetArtworkCache = {
  resolve(input: CacheWidgetArtworkInput): string | null;
  prepare(input: CacheWidgetArtworkInput): Promise<string | null>;
};

type WidgetArtworkDirectory = {
  uri: string;
  create(options: { intermediates: boolean; idempotent: boolean }): void;
};

type WidgetArtworkFile = {
  uri: string;
  exists: boolean;
  copy(
    destination: WidgetArtworkFile,
    options: { overwrite: boolean },
  ): Promise<void>;
};

type WidgetArtworkCacheDependencies = {
  isIOS(): boolean;
  getSharedContainer(): WidgetArtworkDirectory | null;
  createDirectory(
    parent: WidgetArtworkDirectory,
    name: string,
  ): WidgetArtworkDirectory;
  createFile(
    parentOrUri: WidgetArtworkDirectory | string,
    filename?: string,
  ): WidgetArtworkFile;
  downloadFile(
    sourceUri: string,
    destination: WidgetArtworkFile,
  ): Promise<WidgetArtworkFile>;
};

export const sanitizeWidgetArtworkFilenameComponent = (value: string) => {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 96);

  return sanitized || "item";
};

const artworkExtension = (sourceUri: string) => {
  const path = sourceUri.split(/[?#]/, 1)[0];
  const match = path.match(/\.([a-zA-Z0-9]+)$/);
  const extension = match?.[1]?.toLowerCase();

  return extension && SUPPORTED_ARTWORK_EXTENSIONS.has(extension)
    ? extension
    : DEFAULT_ARTWORK_EXTENSION;
};

const sourceKind = (sourceUri: string) => {
  if (/^https?:\/\//i.test(sourceUri)) return "remote";
  if (/^file:\/\//i.test(sourceUri)) return "file";
  return null;
};

const normalizeInput = ({
  sourceUri,
  libraryItemId,
}: CacheWidgetArtworkInput) => {
  const normalizedSourceUri = sourceUri?.trim();
  const normalizedLibraryItemId = libraryItemId.trim();
  if (!normalizedSourceUri || !normalizedLibraryItemId) return null;

  const kind = sourceKind(normalizedSourceUri);
  if (!kind) return null;

  return {
    kind,
    sourceUri: normalizedSourceUri,
    filename: `cover-${sanitizeWidgetArtworkFilenameComponent(
      normalizedLibraryItemId,
    )}.${artworkExtension(normalizedSourceUri)}`,
  };
};

/**
 * Makes artwork available to both the app and its WidgetKit extension.
 *
 * Remote URLs may already contain their authentication token. The token remains
 * in the request URL and is never included in the destination filename.
 */
export const createWidgetArtworkCache = (
  dependencies: WidgetArtworkCacheDependencies,
): WidgetArtworkCache => {
  const destinationFor = (input: CacheWidgetArtworkInput) => {
    if (!dependencies.isIOS()) return null;
    const normalized = normalizeInput(input);
    if (!normalized) return null;

    const sharedContainer = dependencies.getSharedContainer();
    if (!sharedContainer) return null;

    const directory = dependencies.createDirectory(
      sharedContainer,
      WIDGETS_DIRECTORY_NAME,
    );
    const destination = dependencies.createFile(directory, normalized.filename);
    return { ...normalized, destination, directory };
  };

  const resolve = (input: CacheWidgetArtworkInput): string | null => {
    try {
      const cached = destinationFor(input);
      return cached?.destination.exists ? cached.destination.uri : null;
    } catch {
      return null;
    }
  };

  const prepare = async (
    input: CacheWidgetArtworkInput,
  ): Promise<string | null> => {
    try {
      const cached = destinationFor(input);
      if (!cached) return null;

      const { destination, directory, kind, sourceUri } = cached;
      directory.create({ intermediates: true, idempotent: true });

      if (kind === "remote") {
        const downloadedFile = await dependencies.downloadFile(
          sourceUri,
          destination,
        );
        return downloadedFile.exists ? downloadedFile.uri : null;
      }

      const source = dependencies.createFile(sourceUri);
      if (!source.exists) return null;
      if (source.uri !== destination.uri) {
        await source.copy(destination, { overwrite: true });
      }

      return destination.exists ? destination.uri : null;
    } catch {
      return null;
    }
  };

  return { prepare, resolve };
};

const audioWidgetArtworkCache = createWidgetArtworkCache({
  isIOS: () => Platform.OS === "ios",
  getSharedContainer: () =>
    Paths.appleSharedContainers[AUDIO_WIDGET_APP_GROUP] ?? null,
  createDirectory: (parent, name) =>
    new Directory(parent.uri, name) as WidgetArtworkDirectory,
  createFile: (parentOrUri, filename) =>
    new File(
      typeof parentOrUri === "string" ? parentOrUri : parentOrUri.uri,
      ...(filename ? [filename] : []),
    ) as WidgetArtworkFile,
  downloadFile: (sourceUri, destination) =>
    File.downloadFileAsync(sourceUri, new File(destination.uri), {
      idempotent: true,
    }),
});

export const resolveCachedWidgetArtworkUri = audioWidgetArtworkCache.resolve;
export const prepareWidgetArtwork = audioWidgetArtworkCache.prepare;
