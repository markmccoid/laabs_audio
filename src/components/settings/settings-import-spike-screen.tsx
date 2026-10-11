// Phase 0 spike for Imported Audiobooks — dev only, delete after the spike.
// See docs/imported-audiobooks-implementation-plan.md and docs/imported-audiobooks-spike.md.
import AudioImport, { type AudioImportMetadata } from "@/native/audio-import/AudioImportModule";
import { ensureAppDirectory, getDocumentDirectory } from "@/store/fileSystemAccess";
import { useThemeColors } from "@/theme/use-app-theme";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

const SPIKE_DIRECTORY = "laabs-imports-spike";

type SpikeResult = {
  step: string;
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

  const finish = (next: SpikeResult) => {
    log(next);
    setResult(next);
  };

  const pickAndImport = async () => {
    setBusy(true);
    const partial: SpikeResult = { step: "pick" };
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
      finish({ ...partial, step: "done" });
    } catch (error) {
      finish({ ...partial, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
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
    finish({ step: "cleared" });
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
      {button("Pick audio file and import", pickAndImport, "import-spike-pick")}
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
      {button("Clear spike folder", clearSpikeFolder, "import-spike-clear")}
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
