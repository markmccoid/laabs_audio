import { useThemeColors } from "@/theme/use-app-theme";
import { Pressable, Text, View } from "react-native";

type CountStepperProps = {
  value: number;
  min: number;
  max: number;
  onDecrement: () => void;
  onIncrement: () => void;
};

export const CountStepper = ({
  value,
  min,
  max,
  onDecrement,
  onIncrement,
}: CountStepperProps) => {
  const themeColors = useThemeColors();
  const decrementDisabled = value <= min;
  const incrementDisabled = value >= max;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable
        disabled={decrementDisabled}
        onPress={onDecrement}
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: decrementDisabled ? themeColors.surface : themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 20, lineHeight: 22 }}>
          -
        </Text>
      </Pressable>

      <View
        style={{
          minWidth: 50,
          borderRadius: 10,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.bg,
          paddingVertical: 7,
          paddingHorizontal: 8,
          alignItems: "center",
        }}
      >
        <Text
          selectable
          style={{ color: themeColors.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] }}
        >
          {value}
        </Text>
      </View>

      <Pressable
        disabled={incrementDisabled}
        onPress={onIncrement}
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: incrementDisabled ? themeColors.surface : themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 20, lineHeight: 22 }}>
          +
        </Text>
      </Pressable>
    </View>
  );
};
