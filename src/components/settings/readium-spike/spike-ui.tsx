/**
 * Presentational pieces of the Readium anchor spike screen. Kept apart from the
 * screen so the experiment wiring reads as experiments rather than as styling.
 */

import { useThemeColors } from "@/theme/use-app-theme";
import type { CaseVerdict } from "@/spikes/readium-anchor/types";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, Text, View } from "react-native";

export const Section = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => {
  const themeColors = useThemeColors();

  return (
    <View style={{ gap: 8 }}>
      <Text
        selectable
        style={{
          color: themeColors.textMuted,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          paddingHorizontal: 4,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, paddingHorizontal: 4 }}>
          {subtitle}
        </Text>
      ) : null}
      <View
        style={{
          borderWidth: 1,
          borderColor: themeColors.border,
          borderRadius: 14,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
          padding: 12,
          gap: 12,
        }}
      >
        {children}
      </View>
    </View>
  );
};

export const ActionButton = ({
  title,
  icon,
  disabled,
  tone = "neutral",
  onPress,
}: {
  title: string;
  icon?: React.ComponentProps<typeof SymbolView>["name"];
  disabled?: boolean;
  tone?: "neutral" | "accent";
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();
  const isAccent = tone === "accent" && !disabled;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        borderRadius: 8,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isAccent ? themeColors.accent : themeColors.border,
        backgroundColor: isAccent
          ? themeColors.accent
          : pressed
            ? themeColors.border
            : themeColors.surface,
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      })}
    >
      {icon ? (
        <SymbolView
          name={icon}
          tintColor={isAccent ? themeColors.accentForeground : themeColors.text}
          size={16}
        />
      ) : null}
      <Text
        style={{
          color: isAccent ? themeColors.accentForeground : themeColors.text,
          fontSize: 14,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
};

export const Stat = ({ label, value }: { label: string; value: string | number | null | undefined }) => {
  const themeColors = useThemeColors();

  return (
    <View style={{ gap: 2, minWidth: "45%" }}>
      <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
        {label}
      </Text>
      <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
        {value ?? "—"}
      </Text>
    </View>
  );
};

export const Mono = ({ children }: { children: React.ReactNode }) => {
  const themeColors = useThemeColors();

  return (
    <Text
      selectable
      style={{
        color: themeColors.text,
        fontSize: 12,
        fontFamily: "Menlo",
        lineHeight: 17,
      }}
    >
      {children}
    </Text>
  );
};

const VERDICT_OPTIONS: { verdict: CaseVerdict; label: string; color: string }[] = [
  { verdict: "pass", label: "Pass", color: "#2e7d32" },
  { verdict: "shifted", label: "Shifted", color: "#ef6c00" },
  { verdict: "fail", label: "Fail", color: "#c62828" },
];

/**
 * Whether a case passed is a human judgement — the highlight is either on the
 * right words or it isn't — so the verdict is recorded by hand, next to the
 * button that ran the case.
 */
export const VerdictButtons = ({
  value,
  onChange,
}: {
  value: CaseVerdict | undefined;
  onChange: (verdict: CaseVerdict | undefined) => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {VERDICT_OPTIONS.map((option) => {
        const isSelected = value === option.verdict;
        return (
          <Pressable
            key={option.verdict}
            onPress={() => onChange(isSelected ? undefined : option.verdict)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: isSelected ? option.color : themeColors.border,
              backgroundColor: isSelected ? option.color : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: isSelected ? "#ffffff" : themeColors.textMuted,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

/** One experiment case: what it does, a button to run it, and its verdict. */
export const CaseRow = ({
  title,
  detail,
  runLabel = "Apply",
  disabled,
  verdict,
  onRun,
  onVerdict,
}: {
  title: string;
  detail?: string;
  runLabel?: string;
  disabled?: boolean;
  verdict: CaseVerdict | undefined;
  onRun: () => void;
  onVerdict: (verdict: CaseVerdict | undefined) => void;
}) => {
  const themeColors = useThemeColors();

  return (
    <View
      style={{
        gap: 8,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: themeColors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}>
            {title}
          </Text>
          {detail ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {detail}
            </Text>
          ) : null}
        </View>
        <ActionButton title={runLabel} disabled={disabled} onPress={onRun} />
      </View>
      <VerdictButtons value={verdict} onChange={onVerdict} />
    </View>
  );
};
