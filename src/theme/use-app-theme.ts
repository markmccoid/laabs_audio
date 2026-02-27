import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { useMemo } from "react";
import { useCSSVariable, useUniwind } from "uniwind";

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
  accent: "#1f6f43",
  accentForeground: "#f4fbf7",
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
