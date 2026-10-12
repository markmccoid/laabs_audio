import type { AudioImportMetadata } from "@/native/audio-import/AudioImportModule";

/** File extensions Audio Import accepts. The picker's mimeType is unreliable (m4b arrives as octet-stream). */
export const SUPPORTED_IMPORT_EXTENSIONS = ["m4b", "m4a", "mp3", "aac", "wav", "flac"] as const;

export const getFileExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
};

export const isSupportedImportFileName = (fileName: string) =>
  (SUPPORTED_IMPORT_EXTENSIONS as readonly string[]).includes(getFileExtension(fileName));

export type ImportedChapter = {
  title: string;
  startSeconds: number;
  endSeconds: number;
};

export type ResolvedImportedAudiobookMetadata = {
  title: string;
  author: string | null;
  narrator: string | null;
  description: string | null;
  durationSeconds: number;
  /** Empty when the file has no meaningful chapters; playback then treats each file as one chapter. */
  chapters: ImportedChapter[];
};

// AVFoundation returns raw identifiers percent-encoded: ©nrt arrives as itsk/%A9nrt.
const RAW_ALBUM_ARTIST_IDENTIFIERS = ["itsk/aART"];
const RAW_NARRATOR_IDENTIFIERS = ["itsk/%A9nrt"];
const RAW_DESCRIPTION_IDENTIFIERS = ["itsk/%A9des", "itsk/desc", "itsk/ldes", "itsk/%A9cmt", "id3/COMM"];
const NARRATED_BY_PATTERN = /narrated by[:\s]+([^\n.;]+)/i;

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const firstRawValue = (metadata: AudioImportMetadata, identifiers: string[]) => {
  for (const identifier of identifiers) {
    const match = metadata.raw.find((item) => item.identifier === identifier && clean(item.value));
    if (match) return clean(match.value);
  }
  return null;
};

const stripExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

const resolveChapters = (metadata: AudioImportMetadata, fileName: string): ImportedChapter[] => {
  // mp3 chapters (ID3 CHAP) are not supported.
  if (getFileExtension(fileName) === "mp3") return [];

  const chapters = metadata.chapters
    .map((chapter, index) => ({
      title: clean(chapter.title) ?? `Chapter ${index + 1}`,
      startSeconds: Math.max(0, chapter.startMs / 1000),
      endSeconds: Math.max(0, (chapter.startMs + chapter.durationMs) / 1000),
    }))
    .filter((chapter) => chapter.endSeconds > chapter.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);

  // A single chapter spanning the whole file (ffmpeg's default "Chapter 01") is no chapters.
  if (chapters.length <= 1) return [];
  return chapters;
};

export const resolveImportedAudiobookMetadata = (
  metadata: AudioImportMetadata,
  fileName: string,
): ResolvedImportedAudiobookMetadata => {
  const common = metadata.common ?? {};
  const durationSeconds = Math.max(0, (metadata.durationMs ?? 0) / 1000);
  const description =
    clean(common.description) ?? firstRawValue(metadata, RAW_DESCRIPTION_IDENTIFIERS);
  const narrator =
    firstRawValue(metadata, RAW_NARRATOR_IDENTIFIERS) ??
    clean(description?.match(NARRATED_BY_PATTERN)?.[1]);

  return {
    title: clean(common.title) ?? clean(common.albumName) ?? stripExtension(fileName),
    author:
      firstRawValue(metadata, RAW_ALBUM_ARTIST_IDENTIFIERS) ??
      clean(common.artist) ??
      clean(common.creator),
    narrator,
    description,
    durationSeconds,
    chapters: resolveChapters(metadata, fileName),
  };
};
