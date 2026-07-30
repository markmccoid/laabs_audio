import {
  createWidgetArtworkCache,
  sanitizeWidgetArtworkFilenameComponent,
} from "./widget-artwork-cache";

jest.mock("expo-file-system", () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { appleSharedContainers: {} },
}));

type FakeFile = {
  uri: string;
  exists: boolean;
  copy: jest.Mock<Promise<void>, [FakeFile, { overwrite: boolean }]>;
};

const sharedContainerUri =
  "file:///private/var/mobile/Containers/Shared/AppGroup/widget-group";

const createHarness = (options?: {
  isIOS?: boolean;
  hasSharedContainer?: boolean;
}) => {
  const files = new Map<string, FakeFile>();
  const directoryCreate = jest.fn();
  const copy = jest.fn<
    Promise<void>,
    [FakeFile, FakeFile, { overwrite: boolean }]
  >(async (_source, destination) => {
    destination.exists = true;
  });
  const downloadFile = jest.fn<
    Promise<FakeFile>,
    [string, FakeFile]
  >(async (_sourceUri, destination) => {
    destination.exists = true;
    return destination;
  });
  const sharedContainer = {
    uri: sharedContainerUri,
    create: jest.fn(),
  };

  const fileAt = (uri: string) => {
    const existing = files.get(uri);
    if (existing) return existing;

    const file: FakeFile = {
      uri,
      exists: false,
      copy: jest.fn(async (destination, copyOptions) => {
        await copy(file, destination, copyOptions);
      }),
    };
    files.set(uri, file);
    return file;
  };

  const artworkCache = createWidgetArtworkCache({
    isIOS: () => options?.isIOS ?? true,
    getSharedContainer: () =>
      options?.hasSharedContainer === false ? null : sharedContainer,
    createDirectory: (parent, name) => ({
      uri: `${parent.uri}/${name}`,
      create: directoryCreate,
    }),
    createFile: (parentOrUri, filename) =>
      fileAt(
        typeof parentOrUri === "string"
          ? parentOrUri
          : `${parentOrUri.uri}/${filename}`,
      ),
    downloadFile,
  });

  return {
    artworkCache,
    copy,
    directoryCreate,
    downloadFile,
    fileAt,
  };
};

describe("widget artwork cache", () => {
  it("downloads remote artwork into the shared ExpoWidgets directory", async () => {
    const harness = createHarness();
    const sourceUri = "https://example.com/covers/book.png?token=secret";

    await expect(
      harness.artworkCache.prepare({
        sourceUri,
        libraryItemId: "library/item 1",
      }),
    ).resolves.toBe(`${sharedContainerUri}/ExpoWidgets/cover-library-item-1.png`);

    expect(harness.directoryCreate).toHaveBeenCalledWith({
      intermediates: true,
      idempotent: true,
    });
    expect(harness.downloadFile).toHaveBeenCalledWith(
      sourceUri,
      expect.objectContaining({
        uri: `${sharedContainerUri}/ExpoWidgets/cover-library-item-1.png`,
      }),
    );
  });

  it("copies local artwork and permits repeated updates", async () => {
    const harness = createHarness();
    const sourceUri = "file:///app/cache/current-cover.jpeg";
    harness.fileAt(sourceUri).exists = true;
    const input = {
      sourceUri,
      libraryItemId: "book:123",
    };

    await expect(harness.artworkCache.prepare(input)).resolves.toBe(
      `${sharedContainerUri}/ExpoWidgets/cover-book-123.jpeg`,
    );
    await expect(harness.artworkCache.prepare(input)).resolves.toBe(
      `${sharedContainerUri}/ExpoWidgets/cover-book-123.jpeg`,
    );

    expect(harness.copy).toHaveBeenCalledTimes(2);
    expect(harness.copy).toHaveBeenLastCalledWith(
      expect.objectContaining({ uri: sourceUri }),
      expect.objectContaining({
        uri: `${sharedContainerUri}/ExpoWidgets/cover-book-123.jpeg`,
      }),
      { overwrite: true },
    );
  });

  it("does nothing outside iOS", async () => {
    const harness = createHarness({ isIOS: false });

    await expect(
      harness.artworkCache.prepare({
        sourceUri: "https://example.com/cover.jpg",
        libraryItemId: "book-1",
      }),
    ).resolves.toBeNull();

    expect(harness.directoryCreate).not.toHaveBeenCalled();
    expect(harness.downloadFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a missing source URI",
      sourceUri: null,
      libraryItemId: "book-1",
    },
    {
      name: "a missing library item id",
      sourceUri: "https://example.com/cover.jpg",
      libraryItemId: " ",
    },
    {
      name: "an unsupported source scheme",
      sourceUri: "content://covers/book-1",
      libraryItemId: "book-1",
    },
  ])("fails safely for $name", async ({ sourceUri, libraryItemId }) => {
    const harness = createHarness();

    await expect(
      harness.artworkCache.prepare({ sourceUri, libraryItemId }),
    ).resolves.toBeNull();
  });

  it("fails safely when the App Group is unavailable", async () => {
    const harness = createHarness({ hasSharedContainer: false });

    await expect(
      harness.artworkCache.prepare({
        sourceUri: "https://example.com/cover.jpg",
        libraryItemId: "book-1",
      }),
    ).resolves.toBeNull();
  });

  it("fails safely when a download rejects", async () => {
    const harness = createHarness();
    harness.downloadFile.mockRejectedValueOnce(new Error("offline"));

    await expect(
      harness.artworkCache.prepare({
        sourceUri: "https://example.com/cover.jpg?token=do-not-log",
        libraryItemId: "book-1",
      }),
    ).resolves.toBeNull();
  });

  it("sanitizes unsafe and non-ASCII filename characters", () => {
    expect(sanitizeWidgetArtworkFilenameComponent("  Bóók / ../ 42  ")).toBe(
      "Book-..-42",
    );
  });

  it("resolves an existing shared file synchronously without creating it", () => {
    const harness = createHarness();
    const cachedUri = `${sharedContainerUri}/ExpoWidgets/cover-book-1.webp`;
    harness.fileAt(cachedUri).exists = true;

    expect(
      harness.artworkCache.resolve({
        sourceUri: "https://example.com/cover.webp?token=secret",
        libraryItemId: "book-1",
      }),
    ).toBe(cachedUri);
    expect(harness.directoryCreate).not.toHaveBeenCalled();
    expect(harness.downloadFile).not.toHaveBeenCalled();
  });

  it("returns null synchronously on a cache miss", () => {
    const harness = createHarness();

    expect(
      harness.artworkCache.resolve({
        sourceUri: "file:///app/cache/cover.jpg",
        libraryItemId: "book-1",
      }),
    ).toBeNull();
  });
});
