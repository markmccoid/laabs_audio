import { Button, HStack, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { containerBackground } from "@expo/ui/swift-ui/modifiers";
import { createWidget } from "expo-widgets";

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

export default createWidget<Record<string, never>>("LAABSAudioWidget", LaabsAudioWidget);
