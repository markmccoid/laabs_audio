import { useThemeColors } from "@/theme/use-app-theme";
import { Stack, useGlobalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LibraryItem = () => {
  const themeColors = useThemeColors();
  const { libraryItemId } = useGlobalSearchParams();
  const { top: topOffset } = useSafeAreaInsets();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  return (
    <View style={{ marginTop: topOffset, flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={router.back}>
          <Stack.Toolbar.Icon sf="chevron.backward" />
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => setHidden(false)} icon={"square.and.arrow.up"} />
        <Stack.Toolbar.Button onPress={() => setHidden(true)} icon={"info"} hidden={hidden} />
        <Stack.Toolbar.Spacer width={30} />
        <Stack.Toolbar.Menu icon="07.square.fill.hi">
          <Stack.Toolbar.MenuAction
            icon={hidden ? "sensor.tag.radiowaves.forward" : "sensor.tag.radiowaves.forward.fill"}
          >
            One
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction>two</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.View hidden={!hidden}>
          <Pressable
            onPress={() => setHidden(false)}
            style={
              {
                // alignItems: "center",
                // justifyContent: "center",
                // width: 200,
                // height: 40,
              }
            }
          >
            <Text style={{ color: themeColors.text }}> This is a test</Text>
          </Pressable>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      <Text style={{ color: themeColors.text }}>LibraryItem</Text>
    </View>
  );
};

export default LibraryItem;
