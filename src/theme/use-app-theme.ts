import { DarkTheme, DefaultTheme, type Theme } from "expo-router/react-navigation";
import { useMemo, useEffect } from "react";
import { useColorScheme } from "react-native";
import { Uniwind, useCSSVariable, useUniwind } from "uniwind";
import { useSettingsStore } from "@/store/settings-store";
import {
  DEFAULT_LIGHT_ACCENT_COLOR,
  getAccentForegroundColor,
  resolveAccentThemeColors,
} from "./accent-color";

export type ThemeColors = {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentForeground: string;
  absGold: string;
};

const FALLBACK_COLORS: ThemeColors = {
  bg: "#f5f0e6",
  surface: "#ffffff",
  text: "#122017",
  textMuted: "#5a695f",
  border: "#d5ded8",
  accent: DEFAULT_LIGHT_ACCENT_COLOR,
  accentForeground: getAccentForegroundColor(DEFAULT_LIGHT_ACCENT_COLOR),
  absGold: "#d4af37",
};

const resolveColor = (value: string | number | undefined, fallback: string) =>
  typeof value === "string" ? value : fallback;

export const useThemeColors = (): ThemeColors => {
  const [bg, surface, text, textMuted, border, accent, accentForeground, absGold] =
    useCSSVariable([
      "--color-bg",
      "--color-surface",
      "--color-text",
      "--color-text-muted",
      "--color-border",
      "--color-accent",
      "--color-accent-foreground",
      "--color-abs-gold",
    ]);

  return {
    bg: resolveColor(bg, FALLBACK_COLORS.bg),
    surface: resolveColor(surface, FALLBACK_COLORS.surface),
    text: resolveColor(text, FALLBACK_COLORS.text),
    textMuted: resolveColor(textMuted, FALLBACK_COLORS.textMuted),
    border: resolveColor(border, FALLBACK_COLORS.border),
    accent: resolveColor(accent, FALLBACK_COLORS.accent),
    accentForeground: resolveColor(accentForeground, FALLBACK_COLORS.accentForeground),
    absGold: resolveColor(absGold, FALLBACK_COLORS.absGold),
  };
};

// Ebook availability reads as green everywhere it appears. There is no green
// token in ThemeColors, so the two shades live here instead of per component.
const EBOOK_GREEN_LIGHT = "#15803d";
const EBOOK_GREEN_DARK = "#4ade80";

export const useEbookAccentColor = () => {
  const { theme } = useUniwind();
  const colorScheme = useColorScheme();
  const isDark = theme === "dark" || (theme !== "light" && colorScheme === "dark");

  return isDark ? EBOOK_GREEN_DARK : EBOOK_GREEN_LIGHT;
};

export const useNavigationTheme = (): Theme => {
  const { theme } = useUniwind();
  const colors = useThemeColors();
  const scheme = theme === "dark" ? "dark" : "light";

  return useMemo(() => {
    const baseTheme = scheme === "dark" ? DarkTheme : DefaultTheme;

    return {
      ...baseTheme,
      dark: scheme === "dark",
      colors: {
        ...baseTheme.colors,
        primary: colors.accent,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.accent,
      },
    };
  }, [colors.accent, colors.bg, colors.border, colors.surface, colors.text, scheme]);
};

export const useApplyAccentThemeOverrides = () => {
  const lightAccentColorOverride = useSettingsStore((state) => state.lightAccentColorOverride);
  const darkAccentColorOverride = useSettingsStore((state) => state.darkAccentColorOverride);

  useEffect(() => {
    const lightColors = resolveAccentThemeColors("light", lightAccentColorOverride);
    const darkColors = resolveAccentThemeColors("dark", darkAccentColorOverride);

    Uniwind.updateCSSVariables("light", {
      "--color-accent": lightColors.accent,
      "--color-accent-foreground": lightColors.accentForeground,
    });
    Uniwind.updateCSSVariables("dark", {
      "--color-accent": darkColors.accent,
      "--color-accent-foreground": darkColors.accentForeground,
    });
  }, [darkAccentColorOverride, lightAccentColorOverride]);
};
