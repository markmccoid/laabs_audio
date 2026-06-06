import { ambientService } from "@/ambient/ambient-service";
import { useAmbientStore } from "@/store/store-ambient";
import { useThemeColors } from "@/theme/use-app-theme";
import * as DocumentPicker from "expo-document-picker";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";

export const SettingsAmbientScreen = () => {
  const themeColors = useThemeColors();
  const isEnabled = useAmbientStore((state) => state.isEnabled);
  const trackOrder = useAmbientStore((state) => state.trackOrder);
  const tracksById = useAmbientStore((state) => state.tracksById);
  const ambientTracks = useMemo(
    () => trackOrder.map((trackId) => tracksById[trackId]).filter(Boolean),
    [trackOrder, tracksById],
  );
  const [isImporting, setIsImporting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleImport = async () => {
    try {
      setIsImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) {
        throw new Error("The selected file could not be loaded.");
      }

      await ambientService.importTrackFromFile({
        sourceUri: asset.uri,
        fileName: asset.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import ambient audio.";
      Alert.alert("Import failed", message);
    } finally {
      setIsImporting(false);
    }
  };

  const requestDeleteTrack = (trackId: string, fileName: string) => {
    Alert.alert("Delete ambient track", `Remove ${fileName} from downloaded ambient audio?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setPendingDeleteId(trackId);
          void ambientService
            .removeTrack(trackId)
            .catch((error) => {
              const message =
                error instanceof Error ? error.message : "Unable to delete ambient audio.";
              Alert.alert("Delete failed", message);
            })
            .finally(() =>
              setPendingDeleteId((currentId) => (currentId === trackId ? null : currentId)),
            );
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 28,
          gap: 16,
        }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 16,
            borderCurve: "continuous",
            padding: 14,
            gap: 10,
            backgroundColor: themeColors.surface,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
                Enable Ambient Audio
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                When off, ambient controls are hidden from the main player and any active ambient
                playback stops immediately.
              </Text>
            </View>
            <Switch
              value={isEnabled}
              onValueChange={(enabled) => ambientService.setEnabled(enabled)}
              trackColor={{ false: themeColors.border, true: themeColors.accent }}
              thumbColor={isEnabled ? themeColors.accentForeground : "#f4f4f5"}
            />
          </View>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 16,
            borderCurve: "continuous",
            padding: 14,
            gap: 10,
            backgroundColor: themeColors.surface,
          }}
        >
          <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
            Ambient Audio Library
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Import local audio files from Files or iCloud and use them as looped ambient tracks
            while listening.
          </Text>
          <Pressable
            onPress={() => {
              void handleImport();
            }}
            disabled={isImporting}
            style={({ pressed }) => ({
              minHeight: 46,
              borderRadius: 12,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: themeColors.accent,
              opacity: isImporting ? 0.55 : pressed ? 0.82 : 1,
            })}
          >
            <Text
              selectable
              style={{ color: themeColors.accentForeground, fontWeight: "700", fontSize: 15 }}
            >
              {isImporting ? "Importing..." : "Import Ambient Track"}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 16,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: themeColors.surface,
          }}
        >
          {ambientTracks.length ? (
            ambientTracks.map((track, index) => {
              const isDeleting = pendingDeleteId === track.id;
              return (
                <View
                  key={track.id}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderBottomWidth: index === ambientTracks.length - 1 ? 0 : 1,
                    borderBottomColor: themeColors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      borderCurve: "continuous",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: themeColors.bg,
                    }}
                  >
                    <SymbolView name="waveform" size={18} tintColor={themeColors.accent} />
                    {/* <SymbolView name="waveform" size={18} tintColor={themeColors.accent} /> */}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                    >
                      {track.fileName}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${track.fileName}`}
                    onPress={() => requestDeleteTrack(track.id, track.fileName)}
                    disabled={isDeleting}
                    style={({ pressed }) => ({
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      borderCurve: "continuous",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: themeColors.bg,
                      opacity: isDeleting ? 0.5 : pressed ? 0.75 : 1,
                    })}
                  >
                    <SymbolView name="trash" size={17} tintColor={themeColors.textMuted} />
                  </Pressable>
                </View>
              );
            })
          ) : (
            <View style={{ paddingHorizontal: 16, paddingVertical: 18, gap: 6 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                No ambient tracks yet
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                Import audio files here, then select them from the main player.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
};
