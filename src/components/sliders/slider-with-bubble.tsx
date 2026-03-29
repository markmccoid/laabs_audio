import { useSliderBubbleState } from "@/hooks/use-slider-bubble-state";
import Slider from "@react-native-community/slider";
import { useCallback, useEffect, useState } from "react";
import { View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import SliderValueBubble from "./slider-value-bubble";

type BaseSliderProps = React.ComponentProps<typeof Slider>;
type SlidingValue = Parameters<NonNullable<BaseSliderProps["onSlidingComplete"]>>[0];

type Props = Omit<BaseSliderProps, "style"> & {
  bubbleLabel: string;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  bubbleStyle?: StyleProp<ViewStyle>;
  bubbleLabelStyle?: StyleProp<TextStyle>;
  bubbleMinWidth?: number;
  bubbleTopOffset?: number;
};
const DEFAULT_BUBBLE_TOP_OFFSET = 44;

const SliderWithBubble = ({
  bubbleLabel,
  style,
  containerStyle,
  bubbleStyle,
  bubbleLabelStyle,
  bubbleMinWidth = 96,
  bubbleTopOffset = DEFAULT_BUBBLE_TOP_OFFSET,
  onSlidingStart,
  onSlidingComplete,
  ...sliderProps
}: Props) => {
  const { bubbleProgress, showBubble, hideBubble } = useSliderBubbleState();
  const [displayBubbleLabel, setDisplayBubbleLabel] = useState(bubbleLabel);
  const [isBubbleLabelFrozen, setIsBubbleLabelFrozen] = useState(true);

  useEffect(() => {
    if (!isBubbleLabelFrozen) {
      setDisplayBubbleLabel(bubbleLabel);
    }
  }, [bubbleLabel, isBubbleLabelFrozen]);

  const handleSlidingStart = useCallback(
    (value: SlidingValue) => {
      setIsBubbleLabelFrozen(false);
      setDisplayBubbleLabel(bubbleLabel);
      showBubble();
      onSlidingStart?.(value);
    },
    [bubbleLabel, onSlidingStart, showBubble],
  );

  const handleSlidingComplete = useCallback(
    (value: SlidingValue) => {
      setIsBubbleLabelFrozen(true);
      onSlidingComplete?.(value);
      hideBubble();
    },
    [hideBubble, onSlidingComplete],
  );

  return (
    <View
      style={[
        {
          position: "relative",
          overflow: "visible",
        },
        containerStyle,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -bubbleTopOffset,
          left: 0,
          right: 0,
          alignItems: "center",
          zIndex: 1,
        }}
      >
        <SliderValueBubble
          label={displayBubbleLabel}
          progress={bubbleProgress}
          placement="centered"
          minWidth={bubbleMinWidth}
          style={bubbleStyle}
          labelStyle={bubbleLabelStyle}
        />
      </View>
      <Slider
        {...sliderProps}
        style={style}
        onSlidingStart={handleSlidingStart}
        onSlidingComplete={handleSlidingComplete}
      />
    </View>
  );
};

export default SliderWithBubble;
