import { Button, HStack, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { containerBackground } from "@expo/ui/swift-ui/modifiers";
import { createWidget } from "expo-widgets";

import {
  createEmptyAudioWidgetSnapshot,
  type AudioWidgetSnapshot,
} from "./widget-snapshot";

const LaabsAudioWidget = () => {
  "widget";
  return (
    <HStack>
      <ZStack modifiers={[containerBackground("#fff", "widget")]}>
        <VStack>
          <Text>LAABS Audio</Text>
          <Button
            label="Play or pause"
            systemImage="playpause.fill"
            target="laabs.audio.toggle"
            onPress={() => ({})}
          />
        </VStack>
      </ZStack>
    </HStack>
  );
};

const audioWidget = createWidget<AudioWidgetSnapshot>("LAABSAudioWidget", LaabsAudioWidget);

audioWidget.updateSnapshot(createEmptyAudioWidgetSnapshot());

export default audioWidget;
