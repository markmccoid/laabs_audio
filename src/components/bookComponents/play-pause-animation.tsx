import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export type PlaybackControlVisualState =
  | "not-loaded"
  | "loading"
  | "loaded-active"
  | "playing"
  | "paused";

type PlayPauseAnimationProps = {
  visualState: PlaybackControlVisualState;
  size?: number;
  playIconName?: SFSymbol;
  pauseIconName?: SFSymbol;
  resumeIconName?: SFSymbol;
  tintColor?: string;
  duration?: number;
};

/**
 * Playback button animation:
 * - not-loaded: static resume icon
 * - loading: rotating resume icon
 * - loaded-active/paused: play icon
 * - playing: pause icon
 */
const PlayPauseAnimation = ({
  visualState,
  size = 32,
  playIconName = "play.fill",
  pauseIconName = "pause.fill",
  resumeIconName = "livephoto.play",
  tintColor = "#111827",
  duration = 300,
}: PlayPauseAnimationProps) => {
  const getInitialOpacity = (icon: "resume" | "play" | "pause") => {
    if (visualState === "not-loaded" || visualState === "loading") return icon === "resume" ? 1 : 0;
    if (visualState === "playing") return icon === "pause" ? 1 : 0;
    return icon === "play" ? 1 : 0;
  };

  const getInitialScale = (icon: "resume" | "play" | "pause") => {
    if (visualState === "not-loaded" || visualState === "loading") return icon === "resume" ? 1.1 : 0.5;
    if (visualState === "playing") return icon === "pause" ? 1 : 0.5;
    return icon === "play" ? 1 : 0.5;
  };

  // Shared values for resume icon animation (when book is not active)
  const resumeOpacity = useSharedValue(getInitialOpacity("resume"));
  const resumeScale = useSharedValue(getInitialScale("resume"));
  const resumeRotation = useSharedValue(0);

  // Shared values for play icon animation (when book is active but paused)
  const playOpacity = useSharedValue(getInitialOpacity("play"));
  const playScale = useSharedValue(getInitialScale("play"));

  // Shared values for pause icon animation (when book is active and playing)
  const pauseOpacity = useSharedValue(getInitialOpacity("pause"));
  const pauseScale = useSharedValue(getInitialScale("pause"));

  useEffect(() => {
    const morphEasing = Easing.bezier(0.4, 0.0, 0.2, 1);
    const isLoading = visualState === "loading";
    const showResume = visualState === "not-loaded" || isLoading;
    const showPlay = visualState === "loaded-active" || visualState === "paused";
    const showPause = visualState === "playing";

    if (isLoading) {
      resumeOpacity.value = withTiming(1, {
        duration: duration * 0.8,
        easing: morphEasing,
      });
      resumeScale.value = withTiming(1, {
        duration,
        easing: morphEasing,
      });
      resumeRotation.value = withRepeat(
        withTiming(360, {
          duration: 1000,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    } else {
      cancelAnimation(resumeRotation);
      resumeRotation.value = withTiming(0, {
        duration: duration * 0.5,
        easing: morphEasing,
      });
    }

    resumeOpacity.value = withTiming(showResume ? 1 : 0, {
      duration: duration * 0.8,
      easing: morphEasing,
    });
    resumeScale.value = withTiming(showResume ? 1 : 0.5, {
      duration,
      easing: morphEasing,
    });

    playOpacity.value = withTiming(showPlay ? 1 : 0, {
      duration: duration * 0.8,
      easing: morphEasing,
    });
    playScale.value = withTiming(showPlay ? 1 : 0.5, {
      duration,
      easing: morphEasing,
    });

    pauseOpacity.value = withTiming(showPause ? 1 : 0, {
      duration: duration * 0.8,
      easing: morphEasing,
    });
    pauseScale.value = withTiming(showPause ? 1 : 0.5, {
      duration,
      easing: morphEasing,
    });
  }, [
    visualState,
    duration,
    resumeOpacity,
    resumeScale,
    resumeRotation,
    playOpacity,
    playScale,
    pauseOpacity,
    pauseScale,
  ]);

  // Animated styles for resume icon (when not active or loading)
  const resumeAnimatedStyle = useAnimatedStyle(() => ({
    opacity: resumeOpacity.value,
    transform: [{ scale: resumeScale.value }, { rotate: `${resumeRotation.value}deg` }],
    position: "absolute",
  }));

  // Animated styles for play icon (when active but paused)
  const playAnimatedStyle = useAnimatedStyle(() => ({
    opacity: playOpacity.value,
    transform: [{ scale: playScale.value }],
    position: "absolute",
  }));

  // Animated styles for pause icon (when active and playing)
  const pauseAnimatedStyle = useAnimatedStyle(() => ({
    opacity: pauseOpacity.value,
    transform: [{ scale: pauseScale.value }],
    position: "absolute",
  }));

  return (
    <Animated.View style={{ width: size, height: size, position: "relative" }}>
      <Animated.View style={resumeAnimatedStyle}>
        <SymbolView name={resumeIconName} size={size} tintColor={tintColor} />
      </Animated.View>
      <Animated.View style={playAnimatedStyle}>
        <SymbolView name={playIconName} size={size} tintColor={tintColor} />
      </Animated.View>
      <Animated.View style={pauseAnimatedStyle}>
        <SymbolView name={pauseIconName} size={size} tintColor={tintColor} />
      </Animated.View>
    </Animated.View>
  );
};

export default PlayPauseAnimation;
