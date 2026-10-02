import { Directory, File, Paths } from "expo-file-system";
import ReactNativeBlobUtil from "react-native-blob-util";
import { downloadsApi } from "@/api/downloads-api";

const directory = () => new Directory(Paths.document, "laabs-pdfs");
const assetFile = (bookId: string, ino: string, sha256: string) =>
  new File(
    directory(),
    `${encodeURIComponent(bookId)}.${encodeURIComponent(ino)}.${sha256}.pdf`,
  );

export const findPdfAsset = (
  bookId: string,
  ino: string,
  sha256: string,
): string | null => {
  const file = assetFile(bookId, ino, sha256);
  return file.exists ? file.uri : null;
};

const pending = new Map<string, Promise<{ uri: string; sha256: string }>>();

/** Native file hashing keeps the PDF bytes out of the JS heap. Partial downloads never become assets. */
export const ensurePdfAsset = (
  bookId: string,
  ino: string,
  expectedHash: string,
  refresh = false,
) => {
  const destination = assetFile(bookId, ino, expectedHash);
  const existingTask = pending.get(destination.uri);
  if (existingTask) return existingTask;
  const task = (async () => {
    directory().create({ intermediates: true, idempotent: true });
    if (refresh || !destination.exists) {
      const temporary = new File(directory(), `${destination.name}.download`);
      const temporaryUri = temporary.uri;
      try {
        if (temporary.exists) temporary.delete();
        const spec = await downloadsApi.getDownloadSpec(bookId, ino);
        const output = await File.downloadFileAsync(
          spec.urlWithToken,
          temporary,
          { headers: spec.authHeader as Record<string, string> },
        );
        if (!output.exists || !output.size)
          throw new Error("PDF download was empty");
        await output.move(destination, { overwrite: refresh });
      } finally {
        const leftover = new File(temporaryUri);
        if (leftover.exists) leftover.delete();
      }
    }
    const sha256 = await ReactNativeBlobUtil.fs.hash(
      decodeURIComponent(destination.uri.replace(/^file:\/\//, "")),
      "sha256",
    );
    return { uri: destination.uri, sha256 };
  })();
  pending.set(destination.uri, task);
  void task
    .finally(() => pending.delete(destination.uri))
    .catch(() => undefined);
  return task;
};
