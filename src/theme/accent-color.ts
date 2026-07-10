export type AccentThemeName = "light" | "dark";

export const DEFAULT_LIGHT_ACCENT_COLOR = "#1F6F43";
export const DEFAULT_DARK_ACCENT_COLOR = "#3EA56D";
const ACCENT_FOREGROUND_LUMINANCE_THRESHOLD = 0.3;

export const DEFAULT_ACCENT_BY_THEME: Record<AccentThemeName, string> = {
  light: DEFAULT_LIGHT_ACCENT_COLOR,
  dark: DEFAULT_DARK_ACCENT_COLOR,
};
const DERIVED_DARK_ACCENT_LIGHTEN_AMOUNT = 0.24;

const HEX_3 = /^#([\da-f]{3})$/i;
const HEX_6 = /^#([\da-f]{6})$/i;
const HEX_8 = /^#([\da-f]{8})$/i;

const normalizeHexTriplet = (value: string) =>
  value
    .split("")
    .map((char) => `${char}${char}`)
    .join("");

export const normalizeAccentHex = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const threeDigitMatch = trimmed.match(HEX_3);
  if (threeDigitMatch) {
    return `#${normalizeHexTriplet(threeDigitMatch[1] ?? "").toUpperCase()}`;
  }

  const sixDigitMatch = trimmed.match(HEX_6);
  if (sixDigitMatch) {
    return `#${(sixDigitMatch[1] ?? "").toUpperCase()}`;
  }

  const eightDigitMatch = trimmed.match(HEX_8);
  if (eightDigitMatch) {
    return `#${(eightDigitMatch[1] ?? "").slice(0, 6).toUpperCase()}`;
  }

  return null;
};

const srgbChannelToLinear = (channel: number) => {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance (0–1) of a hex color. Returns 0 for invalid input. */
export const getRelativeLuminance = (color: string) => {
  const normalized = normalizeAccentHex(color);
  if (!normalized) {
    return 0;
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);

  return (
    0.2126 * srgbChannelToLinear(red) +
    0.7152 * srgbChannelToLinear(green) +
    0.0722 * srgbChannelToLinear(blue)
  );
};

export const getAccentForegroundColor = (accentColor: string) => {
  const normalizedAccent = normalizeAccentHex(accentColor);
  if (!normalizedAccent) {
    return "#FFFFFF";
  }

  return getRelativeLuminance(normalizedAccent) > ACCENT_FOREGROUND_LUMINANCE_THRESHOLD
    ? "#000000"
    : "#FFFFFF";
};

const lightenChannel = (channel: number, amount: number) =>
  Math.round(channel + (255 - channel) * amount);

const darkenChannel = (channel: number, amount: number) => Math.round(channel * (1 - amount));

const PROGRESS_FILL_DARKEN_AMOUNT = 0.25;
const PROGRESS_FILL_LIGHTEN_AMOUNT = 0.72;

/**
 * Muted accent used as the progress-pill fill: darkened in dark theme, lifted
 * toward white in light theme, so the theme text color stays >= 4.5:1 on top of
 * it as well as on the empty track behind it.
 */
export const deriveProgressFillColor = (accentColor: string, theme: AccentThemeName) => {
  const normalizedAccent = normalizeAccentHex(accentColor) ?? DEFAULT_ACCENT_BY_THEME[theme];
  const red = Number.parseInt(normalizedAccent.slice(1, 3), 16);
  const green = Number.parseInt(normalizedAccent.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedAccent.slice(5, 7), 16);
  const transform =
    theme === "dark"
      ? (channel: number) => darkenChannel(channel, PROGRESS_FILL_DARKEN_AMOUNT)
      : (channel: number) => lightenChannel(channel, PROGRESS_FILL_LIGHTEN_AMOUNT);

  return `#${[transform(red), transform(green), transform(blue)]
    .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
};

export const deriveDarkAccentFromLight = (lightAccentColor: string) => {
  const normalizedAccent = normalizeAccentHex(lightAccentColor) ?? DEFAULT_LIGHT_ACCENT_COLOR;
  const red = Number.parseInt(normalizedAccent.slice(1, 3), 16);
  const green = Number.parseInt(normalizedAccent.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedAccent.slice(5, 7), 16);

  return `#${[
    lightenChannel(red, DERIVED_DARK_ACCENT_LIGHTEN_AMOUNT),
    lightenChannel(green, DERIVED_DARK_ACCENT_LIGHTEN_AMOUNT),
    lightenChannel(blue, DERIVED_DARK_ACCENT_LIGHTEN_AMOUNT),
  ]
    .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
};

export const resolveAccentThemeColors = (
  theme: AccentThemeName,
  overrideColor: string | null | undefined,
) => {
  const accent = normalizeAccentHex(overrideColor) ?? DEFAULT_ACCENT_BY_THEME[theme];

  return {
    accent,
    accentForeground: getAccentForegroundColor(accent),
  };
};
