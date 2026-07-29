import { HStack, Text, ZStack } from "@expo/ui/swift-ui";
import { containerBackground } from "@expo/ui/swift-ui/modifiers";
import { createWidget } from "expo-widgets";

const LaabsAudioWidget = () => {
  "widget";
  return (
    <HStack>
      <ZStack modifiers={[containerBackground("#fff", "widget")]}>
        <Text>LAABS Audio</Text>
      </ZStack>
    </HStack>
  );
};

export default createWidget<Record<string, never>>("LAABSAudioWidget", LaabsAudioWidget);
