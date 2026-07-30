import {
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  aspectRatio,
  backgroundOverlay,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  containerBackground,
  containerRelativeFrame,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  resizable,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import {
  createEmptyAudioWidgetSnapshot,
  type AudioWidgetSnapshot,
} from "./widget-snapshot";

const LaabsAudioWidget = (
  props: AudioWidgetSnapshot,
  environment: WidgetEnvironment,
) => {
  "widget";

  const media = props.status === "active" ? props.media : null;

  if (!media) {
    return (
      <ZStack modifiers={[containerBackground("#F5F1E8", "widget")]}>
        <VStack spacing={8}>
          <Image
            systemName="headphones"
            color="#675F52"
            size={environment.widgetFamily === "systemSmall" ? 34 : 28}
          />
          <Text
            modifiers={[
              font({ size: 15, weight: "semibold" }),
              foregroundStyle("#2C2925"),
              lineLimit(1),
            ]}
          >
            LAABS Audio
          </Text>
          <Text
            modifiers={[
              font({ size: 12 }),
              foregroundStyle("#675F52"),
              lineLimit(2),
            ]}
          >
            Play an audiobook to get started.
          </Text>
        </VStack>
      </ZStack>
    );
  }

  const isPlaying = media.playback.state === "playing";
  const playbackLabel = isPlaying ? "Pause audiobook" : "Play audiobook";
  const playbackSymbol = isPlaying ? "pause.fill" : "play.fill";
  const totalMinutes = Math.max(
    0,
    Math.floor(media.playback.positionMs / 60_000),
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const progressText =
    hours > 0
      ? `${hours} hr ${minutes.toString().padStart(2, "0")} min`
      : `${minutes} min`;

  const playbackButton = (
    <Button
      target="laabs.audio.toggle"
      onPress={() => ({})}
      modifiers={[
        buttonStyle("borderedProminent"),
        buttonBorderShape("circle"),
        tint("#1F7665"),
        accessibilityLabel(playbackLabel),
      ]}
    >
      <Image systemName={playbackSymbol} size={16} />
    </Button>
  );

  const artwork = media.artworkUri ? (
    <Image
      uiImage={media.artworkUri}
      modifiers={[
        resizable(),
        aspectRatio({ contentMode: "fill" }),
        clipped(),
      ]}
    />
  ) : (
    <ZStack modifiers={[backgroundOverlay({ color: "#DDD6CA" })]}>
      <Image systemName="book.closed.fill" color="#675F52" size={32} />
    </ZStack>
  );

  if (environment.widgetFamily === "systemSmall") {
    return (
      <ZStack
        alignment="bottomTrailing"
        modifiers={[
          containerBackground("#F5F1E8", "widget"),
          widgetURL(media.detailUrl),
          clipShape("containerRelativeShape"),
        ]}
      >
        <ZStack
          modifiers={[
            containerRelativeFrame({ axes: "both" }),
            clipShape("containerRelativeShape"),
          ]}
        >
          {artwork}
        </ZStack>
        <ZStack modifiers={[padding({ all: 10 })]}>{playbackButton}</ZStack>
      </ZStack>
    );
  }

  return (
    <HStack
      spacing={12}
      modifiers={[
        containerBackground("#F5F1E8", "widget"),
        widgetURL(media.detailUrl),
        padding({ top: 12, bottom: 12, trailing: 12 }),
      ]}
    >
      <ZStack
        modifiers={[
          frame({ width: 130, height: 130 }),
          clipShape("roundedRectangle", 10),
        ]}
      >
        {artwork}
      </ZStack>
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ size: 16, weight: "bold" }),
            foregroundStyle("#201E1B"),
            lineLimit(2),
          ]}
        >
          {media.title}
        </Text>
        <Text
          modifiers={[
            font({ size: 12 }),
            foregroundStyle("#675F52"),
            lineLimit(1),
          ]}
        >
          {media.creator}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 13, weight: "semibold", design: "rounded" }),
            foregroundStyle("#3F3A33"),
            lineLimit(1),
          ]}
        >
          {progressText}
        </Text>
      </VStack>
      <VStack>
        <Spacer />
        {playbackButton}
        <Spacer />
      </VStack>
    </HStack>
  );
};

const audioWidget = createWidget<AudioWidgetSnapshot>("LAABSAudioWidget", LaabsAudioWidget);

audioWidget.updateSnapshot(createEmptyAudioWidgetSnapshot());

export default audioWidget;
