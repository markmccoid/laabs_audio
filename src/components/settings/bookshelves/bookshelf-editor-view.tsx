import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CountStepper } from "./count-stepper";
import type {
  BookshelfEditorAction,
  BookshelfEditorController,
} from "./bookshelf-settings-types";

const Section = ({ children }: { children: ReactNode }) => {
  const themeColors = useThemeColors();
  return (
    <View
      style={{
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
};

const Row = ({
  label,
  value,
  isLast = false,
}: {
  label: string;
  value: ReactNode;
  isLast?: boolean;
}) => {
  const themeColors = useThemeColors();
  return (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: themeColors.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <Text
        selectable
        style={{ color: themeColors.text, fontSize: 16, fontWeight: "500", flex: 1 }}
      >
        {label}
      </Text>
      {value}
    </View>
  );
};

const actionColor = (
  action: BookshelfEditorAction,
  colors: ReturnType<typeof useThemeColors>,
) => {
  if (action.tone === "destructive") return "#d32424";
  if (action.tone === "playlist") return colors.absGold;
  return colors.accent;
};

export const BookshelfEditorView = ({
  controller,
}: {
  controller: BookshelfEditorController;
}) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      collapsable={false}
    >
      <View
        style={{
          paddingTop: Math.max(insets.top + 10, 18),
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 22, fontWeight: "700" }}>
          {controller.isCreateMode ? "New Bookshelf" : "Bookshelf"}
        </Text>
        <Pressable onPress={controller.done} style={{ paddingHorizontal: 2, paddingVertical: 4 }}>
          <Text selectable style={{ color: themeColors.accent, fontSize: 17, fontWeight: "600" }}>
            Done
          </Text>
        </Pressable>
      </View>

      {controller.status === "missing" ? (
        <View style={{ flex: 1, paddingHorizontal: 16, justifyContent: "center", gap: 10 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
            Shelf not found
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={{
              alignSelf: "flex-start",
              borderRadius: 12,
              borderCurve: "continuous",
              backgroundColor: themeColors.accent,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <Text selectable style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
              Close
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: Math.max(26, insets.bottom + 16),
            gap: 14,
          }}
        >
          <Section>
            <Row
              label="Show on Home"
              value={
                <Switch
                  value={controller.isVisible}
                  onValueChange={controller.setVisible}
                />
              }
            />
            <Row
              label="Home Items"
              isLast
              value={
                <CountStepper
                  value={controller.homeItemCount}
                  min={5}
                  max={25}
                  onDecrement={controller.decrementHomeItemCount}
                  onIncrement={controller.incrementHomeItemCount}
                />
              }
            />
          </Section>

          <Section>
            <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 8 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "500" }}>
                Name
              </Text>
              {controller.canRename ? (
                <TextInput
                  autoFocus={controller.isCreateMode}
                  value={controller.name}
                  onChangeText={controller.setName}
                  placeholder="Bookshelf name"
                  placeholderTextColor={themeColors.textMuted}
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    color: themeColors.text,
                    fontSize: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                />
              ) : (
                <View
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    paddingHorizontal: 12,
                    justifyContent: "center",
                  }}
                >
                  <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
                    {controller.name}
                  </Text>
                </View>
              )}
              <Text
                selectable
                style={{ color: themeColors.textMuted, fontSize: 12, marginBottom: 12 }}
              >
                {controller.helpText}
              </Text>
            </View>
          </Section>

          {controller.actions.length > 0 ? (
            <View style={{ gap: 10 }}>
              {controller.actions.map((action) => {
                const color = actionColor(action, themeColors);
                return (
                  <Pressable
                    key={action.id}
                    onPress={action.onPress}
                    style={{
                      minHeight: 48,
                      borderRadius: 12,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: color,
                      backgroundColor: themeColors.surface,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 12,
                    }}
                  >
                    <Text selectable style={{ color, fontSize: 16, fontWeight: "600" }}>
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
};
