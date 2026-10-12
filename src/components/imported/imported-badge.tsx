import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Text, View } from "react-native";

// One recognisable mark for "came from your files, not Audiobookshelf", used on every surface.
export const IMPORTED_SYMBOL = "folder.fill" as const;
export const IMPORTED_TINT = "#C46A12";

/** Corner badge on cover art; sits where the downloaded badge would (they never both apply). */
export const ImportedCoverBadge = ({ size, inset }: { size: number; inset: number }) => (
  <View
    pointerEvents="none"
    accessibilityLabel="Imported audiobook"
    style={{
      position: "absolute",
      bottom: inset,
      left: inset,
      borderRadius: 999,
      borderCurve: "continuous",
      backgroundColor: "rgba(255,255,255,0.88)",
      boxShadow: "0 4px 10px rgba(15, 23, 42, 0.22)",
      paddingHorizontal: 4,
      paddingVertical: 4,
    }}
  >
    <SymbolView name={IMPORTED_SYMBOL} size={size * 0.85} tintColor={IMPORTED_TINT} />
  </View>
);

/** Inline label for detail screens and rows: "Imported · Not from Audiobookshelf". */
export const ImportedSourceLabel = ({ compact = false }: { compact?: boolean }) => {
  const themeColors = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 5,
        borderRadius: 999,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: IMPORTED_TINT,
        paddingHorizontal: compact ? 6 : 9,
        paddingVertical: compact ? 2 : 4,
      }}
    >
      <SymbolView name={IMPORTED_SYMBOL} size={compact ? 10 : 12} tintColor={IMPORTED_TINT} />
      <Text
        style={{ color: themeColors.text, fontSize: compact ? 10.5 : 12, fontWeight: "600" }}
        numberOfLines={1}
      >
        {compact ? "Imported" : "Imported · Not from Audiobookshelf"}
      </Text>
    </View>
  );
};
