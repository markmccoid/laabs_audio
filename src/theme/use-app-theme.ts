import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { useMemo, useEffect } from "react";
import { Uniwind, useCSSVariable, useUniwind } from "uniwind";
import { useSettingsStore } from "@/store/settings-store";
import {
  DEFAULT_LIGHT_ACCENT_COLOR,
  getAccentForegroundColor,
  resolveAccentThemeColors,
} from "./accent-color";

type ThemeColors = {
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
  bg: "#f7f8f6",
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
  const [bg, surface, text, textMuted, border, accent, accentForeground, absGold] = useCSSVariable([
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
