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

export type AudioImportPickResult =
  | { canceled: true }
  | {
      canceled: false;
      uri: string;
      name: string;
      size: number;
      securityScoped: boolean;
      /** Time from presenting the picker to the user's pick (includes browsing). */
      pickerOpenMs: number;
      /** Time waiting for NSFileCoordinator, e.g. downloading an iCloud-evicted file. */
      coordinationWaitMs: number;
      copyMs: number;
    };

export type PickerLeftoverReport = Record<string, { bytes: number; files: number }>;

declare class AudioImportModule extends NativeModule {
  pickAndCopyAudio(destinationDirectory: string): Promise<AudioImportPickResult>;
  pickerLeftoverReport(): Promise<PickerLeftoverReport>;
  clearPickerLeftovers(): Promise<boolean>;
  readAudioMetadata(fileUrl: string): Promise<AudioImportMetadata>;
  setExcludedFromBackup(fileUrl: string, excluded: boolean): Promise<boolean>;
  isExcludedFromBackup(fileUrl: string): Promise<boolean>;
}

export default requireNativeModule<AudioImportModule>("AudioImport");
