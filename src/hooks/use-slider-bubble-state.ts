import { useCallback, useState } from "react";
import { useSharedValue, withSpring, withTiming } from "react-native-reanimated";

const SHOW_BUBBLE_SPRING = {
  damping: 16,
  stiffness: 180,
};

const HIDE_BUBBLE_SPRING = {
  damping: 18,
  stiffness: 220,
};

export const useSliderBubbleState = () => {
  const [isSliding, setIsSliding] = useState(false);
  const bubbleProgress = useSharedValue(0);

  const showBubble = useCallback(() => {
    setIsSliding(true);
    bubbleProgress.value = withSpring(1);
    // bubbleProgress.value = withSpring(1, SHOW_BUBBLE_SPRING);
  }, [bubbleProgress]);

  const hideBubble = useCallback(() => {
    setIsSliding(false);
    bubbleProgress.value = withTiming(0);
    // bubbleProgress.value = withSpring(0, HIDE_BUBBLE_SPRING);
  }, [bubbleProgress]);

  return {
    bubbleProgress,
    isSliding,
    showBubble,
    hideBubble,
  };
};
