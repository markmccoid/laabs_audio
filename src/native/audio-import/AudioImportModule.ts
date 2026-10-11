import { NativeModule, requireNativeModule } from "expo";

export type AudioImportChapter = {
  index: number;
  title: string | null;
  startMs: number;
  durationMs: number;
};

export type AudioImportMetadata = {
  uri: string;
  fileName: string;
  fileSize: number | null;
  durationMs: number | null;
  isPlayable: boolean;
  codec: string | null;
  metadataFormats: string[];
  /** AVFoundation common keys (title, artist, albumName, creator, description, …). */
  common: Record<string, string>;
  artworkUri: string | null;
  chapterLocales: string[];
  chapters: AudioImportChapter[];
  rawMetadataCount: number;
  raw: { format: string; identifier: string; value: string | null }[];
  readMs: number;
};

declare class AudioImportModule extends NativeModule {
  readAudioMetadata(fileUrl: string): Promise<AudioImportMetadata>;
  setExcludedFromBackup(fileUrl: string, excluded: boolean): Promise<boolean>;
  isExcludedFromBackup(fileUrl: string): Promise<boolean>;
}

export default requireNativeModule<AudioImportModule>("AudioImport");
