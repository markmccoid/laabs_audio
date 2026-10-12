// Phase 0 spike for Imported Audiobooks — dev only, delete after the spike.
// See docs/imported-audiobooks-implementation-plan.md and docs/imported-audiobooks-spike.md.
import AudioImport, {
  type AudioImportMetadata,
  type AudioImportPickResult,
  type PickerLeftoverReport,
} from "@/native/audio-import/AudioImportModule";
import {
  discardPendingAudioImport,
  pickAndImportAudio,
  removeImportedAudiobook,
} from "@/imported/imported-audiobook-library";
import { playerService } from "@/player/player-service";
import { usePlaybackStore } from "@/player/playback-store";
import { ensureAppDirectory, getDocumentDirectory } from "@/store/fileSystemAccess";
import { useImportedBooksStore } from "@/store/imported-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

const SPIKE_DIRECTORY = "laabs-imports-spike";

type SpikeResult = {
  step: string;
  picker?: "expo" | "native";
  nativePick?: AudioImportPickResult;
  leftoversAfter?: PickerLeftoverReport;
  pickerMs?: number;
  moveMs?: number;
  pickedUri?: string;
  storedUri?: string;
  pickerSize?: number | null;
  mimeType?: string | null;
  dirExcludedFromBackup?: boolean;
  fileExcludedFromBackup?: boolean;
  metadata?: AudioImportMetadata;
  error?: string;
};

const log = (result: SpikeResult) => {
  console.log("[import-spike]", JSON.stringify(result));
};

export const SettingsImportSpikeScreen = () => {
  const themeColors = useThemeColors();
  const [copyToCache, setCopyToCache] = useState(true);
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SpikeResult | null>(null);
  const importedBooksById = useImportedBooksStore((state) => state.importedBooksById);
  const importedBookOrder = useImportedBooksStore((state) => state.importedBookOrder);
  const importedBooks = useMemo(
    () => importedBookOrder.map((id) => importedBooksById[id]).filter(Boolean),
    [importedBookOrder, importedBooksById],
  );
  const playingId = usePlaybackStore((state) => state.libraryItemId);
  const playingOwner = usePlaybackStore((state) => state.ownerId);
  const playingPositionMs = usePlaybackStore((state) => state.positionMs);
  const playingState = usePlaybackStore((state) => state.playbackState);

  // Phase 1 harness: the real import pipeline and player, without the Phase 2 UI.
  const phase1Import = async () => {
    setBusy(true);
    try {
      const outcome = await pickAndImportAudio();
      if (outcome.status === "duplicate") await discardPendingAudioImport(outcome.pending);
      finish({
        step: `phase1-${outcome.status}`,
        storedUri: "record" in outcome ? outcome.record.id : "existing" in outcome ? outcome.existing.id : undefined,
      });
      console.log("[import-spike] phase1-import", JSON.stringify(outcome));
    } catch (error) {
      finish({ step: "phase1-import", error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const phase1Play = async (id: string) => {
    try {
      await playerService.loadBook(id, { autoPlay: true });
    } catch (error) {
      finish({ step: "phase1-play", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const finish = (next: SpikeResult) => {
    log(next);
    setResult(next);
  };

  const pickAndImport = async () => {
    setBusy(true);
    const partial: SpikeResult = { step: "pick", picker: "expo" };
    try {
      const pickStarted = Date.now();
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["audio/*"],
        copyToCacheDirectory: copyToCache,
        multiple: false,
      });
      partial.pickerMs = Date.now() - pickStarted;
      if (picked.canceled) {
        finish({ ...partial, step: "cancelled" });
        return;
      }
      const asset = picked.assets[0];
      partial.pickedUri = asset.uri;
      partial.pickerSize = asset.size ?? null;
      partial.mimeType = asset.mimeType ?? null;

      partial.step = "move";
      const directoryUri = await ensureAppDirectory(`${SPIKE_DIRECTORY}/${Date.now()}`);
      const storedUri = `${directoryUri}${encodeURIComponent(asset.name)}`;
      const moveStarted = Date.now();
      if (copyToCache) {
        await FileSystem.moveAsync({ from: asset.uri, to: storedUri });
      } else {
        await FileSystem.copyAsync({ from: asset.uri, to: storedUri });
      }
      partial.moveMs = Date.now() - moveStarted;
      partial.storedUri = storedUri;

      partial.step = "backup";
      const root = `${getDocumentDirectory()}${SPIKE_DIRECTORY}/`;
      partial.dirExcludedFromBackup = await AudioImport.setExcludedFromBackup(root, true);
      partial.fileExcludedFromBackup = await AudioImport.isExcludedFromBackup(storedUri);

      partial.step = "metadata";
      partial.metadata = await AudioImport.readAudioMetadata(storedUri);
      partial.leftoversAfter = await AudioImport.pickerLeftoverReport();
      finish({ ...partial, step: "done" });
    } catch (error) {
      finish({ ...partial, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const nativePickAndImport = async () => {
    setBusy(true);
    const partial: SpikeResult = { step: "pick", picker: "native" };
    try {
      const directoryUri = await ensureAppDirectory(`${SPIKE_DIRECTORY}/${Date.now()}`);
      const picked = await AudioImport.pickAndCopyAudio(directoryUri);
      partial.nativePick = picked;
      if (picked.canceled) {
        finish({ ...partial, step: "cancelled" });
        return;
      }
      partial.storedUri = picked.uri;
      partial.step = "backup";
      const root = `${getDocumentDirectory()}${SPIKE_DIRECTORY}/`;
      partial.dirExcludedFromBackup = await AudioImport.setExcludedFromBackup(root, true);
      partial.step = "metadata";
      partial.metadata = await AudioImport.readAudioMetadata(picked.uri);
      partial.leftoversAfter = await AudioImport.pickerLeftoverReport();
      finish({ ...partial, step: "done" });
    } catch (error) {
      finish({ ...partial, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const showLeftovers = async () => {
    finish({ step: "leftovers", leftoversAfter: await AudioImport.pickerLeftoverReport() });
  };

  const readFromPath = async () => {
    const value = pathInput.trim();
    if (!value) return;
    setBusy(true);
    try {
      const uri = value.startsWith("/") || value.startsWith("file://")
        ? value
        : `${getDocumentDirectory()}${value}`;
      finish({ step: "done", storedUri: uri, metadata: await AudioImport.readAudioMetadata(uri) });
    } catch (error) {
      finish({ step: "path", error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const clearSpikeFolder = async () => {
    const root = `${getDocumentDirectory()}${SPIKE_DIRECTORY}/`;
    await FileSystem.deleteAsync(root, { idempotent: true });
    await AudioImport.clearPickerLeftovers();
    finish({ step: "cleared", leftoversAfter: await AudioImport.pickerLeftoverReport() });
  };

  const button = (title: string, onPress: () => void, testID: string) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={busy}
      onPress={onPress}
      style={{
        borderRadius: 8,
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        opacity: busy ? 0.5 : 1,
        padding: 12,
      }}
    >
      <Text style={{ color: themeColors.text, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: themeColors.text }}>copyToCacheDirectory</Text>
        <Switch testID="import-spike-copy-toggle" value={copyToCache} onValueChange={setCopyToCache} />
      </View>
      {button("Pick audio file and import (expo picker)", pickAndImport, "import-spike-pick")}
      {button("Pick audio file and import (native picker)", nativePickAndImport, "import-spike-native-pick")}
      {button("Show picker leftovers (tmp Inbox, cache)", showLeftovers, "import-spike-leftovers")}
      <TextInput
        testID="import-spike-path"
        value={pathInput}
        onChangeText={setPathInput}
        placeholder="Path relative to Documents, or absolute"
        placeholderTextColor={themeColors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: themeColors.text, borderWidth: 1, borderColor: themeColors.border, borderRadius: 8, padding: 10, fontSize: 15 }}
      />
      {button("Read metadata from path", readFromPath, "import-spike-read-path")}
      {button("Clear spike folder and picker leftovers", clearSpikeFolder, "import-spike-clear")}
      <Text style={{ color: themeColors.text, fontWeight: "700", marginTop: 8 }}>Phase 1: Imported Audiobooks</Text>
      {button("Import as Imported Audiobook", phase1Import, "phase1-import")}
      <Text testID="phase1-playback" selectable style={{ color: themeColors.textMuted, fontFamily: "Menlo", fontSize: 11 }}>
        {`playing=${playingId ?? "-"} owner=${playingOwner ?? "-"} state=${playingState} positionMs=${Math.round(playingPositionMs)}`}
      </Text>
      {importedBooks.map((book) => (
        <View key={book.id} testID={`phase1-book-${book.id}`} style={{ gap: 6, borderWidth: 1, borderColor: themeColors.border, borderRadius: 8, padding: 10 }}>
          <Text selectable style={{ color: themeColors.text, fontWeight: "600" }}>
            {`${book.title}${book.removedAt ? " (removed)" : book.audioPresent ? "" : " (audio missing)"}`}
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 11 }}>
            {`${book.id} · ${book.author ?? "-"} · narrator ${book.narrator ?? "-"} · ${Math.round(book.durationSeconds)}s · ${book.chapters.length} chapters`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {button("Play", () => void phase1Play(book.id), `phase1-play-${book.id}`)}
            {button("Pause", () => void playerService.pause(), `phase1-pause-${book.id}`)}
            {button("Remove", () => void removeImportedAudiobook(book.id), `phase1-remove-${book.id}`)}
          </View>
        </View>
      ))}
      {result?.metadata?.artworkUri ? (
        <Image source={{ uri: result.metadata.artworkUri }} style={{ width: 120, height: 120, borderRadius: 8 }} />
      ) : null}
      {result ? (
        <Text testID="import-spike-result" selectable style={{ color: themeColors.text, fontFamily: "Menlo", fontSize: 11 }}>
          {JSON.stringify(result, null, 2)}
        </Text>
      ) : null}
    </ScrollView>
  );
};
