import { ensurePdfAsset, findPdfAsset } from "./pdf-asset";
import { File } from "expo-file-system";
import ReactNativeBlobUtil from "react-native-blob-util";

jest.mock("expo-file-system", () => {
  const files = new Map<string, number>();
  class FakeFile {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
    get name() {
      return this.uri.split("/").pop();
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri) ?? 0;
    }
    delete() {
      files.delete(this.uri);
    }
    async move(destination: FakeFile) {
      await Promise.resolve();
      files.set(destination.uri, this.size);
      files.delete(this.uri);
      this.uri = destination.uri;
    }
    static downloadFileAsync = jest.fn(async (_url, destination: FakeFile) => {
      files.set(destination.uri, 100);
      return destination;
    });
  }
  return {
    File: FakeFile,
    Directory: class {
      uri: string;
      constructor(...parts: any[]) {
        this.uri = parts.join("/");
      }
      create() {}
    },
    Paths: { document: "file:///documents" },
    __files: files,
  };
});
jest.mock("@/api/downloads-api", () => ({
  downloadsApi: {
    getDownloadSpec: async () => ({
      urlWithToken: "https://example.test/pdf",
      authHeader: { Authorization: "test" },
    }),
  },
}));
jest.mock("react-native-blob-util", () => ({
  __esModule: true,
  default: { fs: { hash: jest.fn() } },
}));
const files = jest.requireMock("expo-file-system").__files as Map<
  string,
  number
>;
const hash = "a".repeat(64);
describe("durable PDF asset", () => {
  beforeEach(() => {
    files.clear();
    jest.clearAllMocks();
    jest
      .mocked(ReactNativeBlobUtil.fs.hash)
      .mockImplementation(async (path) => {
        if (!files.has(`file://${path}`)) throw new Error("Missing PDF");
        return hash;
      });
  });
  it("awaits moving the download and never deletes the moved file during cleanup", async () => {
    const result = await ensurePdfAsset("book", "ino", hash);
    expect(findPdfAsset("book", "ino", hash)).toBe(result.uri);
    expect(result.sha256).toBe(hash);
    expect([...files.keys()]).toEqual([result.uri]);
    await ensurePdfAsset("book", "ino", hash);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(ReactNativeBlobUtil.fs.hash).toHaveBeenCalledTimes(2);
  });
  it("deduplicates concurrent requests and retains mismatched bytes for readable-only use", async () => {
    jest
      .mocked(ReactNativeBlobUtil.fs.hash)
      .mockResolvedValueOnce("b".repeat(64));
    const [first, second] = await Promise.all([
      ensurePdfAsset("book", "ino", hash),
      ensurePdfAsset("book", "ino", hash),
    ]);
    expect(first).toEqual(second);
    expect(first.sha256).not.toBe(hash);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(findPdfAsset("book", "ino", hash)).toBe(first.uri);
  });
  it("retains the previous asset when an explicit refresh fails", async () => {
    const first = await ensurePdfAsset("book", "ino", hash);
    jest
      .mocked(File.downloadFileAsync)
      .mockRejectedValueOnce(new Error("Offline"));
    await expect(ensurePdfAsset("book", "ino", hash, true)).rejects.toThrow(
      "Offline",
    );
    expect(findPdfAsset("book", "ino", hash)).toBe(first.uri);
  });
  it("removes partial failed downloads and permits a fresh retry", async () => {
    jest
      .mocked(File.downloadFileAsync)
      .mockImplementationOnce(async (_url, destination) => {
        files.set(destination.uri, 10);
        throw new Error("Connection lost");
      });
    await expect(ensurePdfAsset("book", "ino", hash)).rejects.toThrow(
      "Connection lost",
    );
    expect(files.size).toBe(0);
    await expect(ensurePdfAsset("book", "ino", hash)).resolves.toHaveProperty(
      "sha256",
      hash,
    );
  });
});
