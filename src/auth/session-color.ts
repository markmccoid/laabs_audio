import {
  DEFAULT_LIGHT_ACCENT_COLOR,
  deriveDarkAccentFromLight,
  getRelativeLuminance,
  normalizeAccentHex,
} from "@/theme/accent-color";

export type ColorScheme = "light" | "dark";

/**
 * Minimum WCAG contrast ratio the tint must reach against the surface it sits on.
 * 3.0 is the AA threshold for large/bold text, which the Home username button is.
 */
const MIN_CONTRAST_RATIO = 3;

/** Representative surface colors per scheme, used when a caller doesn't pass one. */
const SCHEME_BACKGROUND: Record<ColorScheme, string> = {
  light: "#F5F0E6",
  dark: "#10140F",
};

const contrastRatio = (luminanceA: number, luminanceB: number) => {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
};

const mixTowardChannel = (color: string, targetChannel: number, amount: number) => {
  const normalized = normalizeAccentHex(color) ?? DEFAULT_LIGHT_ACCENT_COLOR;
  const channels = [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
  return `#${channels
    .map((channel) => Math.round(channel + (targetChannel - channel) * amount))
    .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
};

/**
 * Nudge a tint toward white (dark scheme) or black (light scheme) until it clears
 * MIN_CONTRAST_RATIO against the given background, so a near-background user pick stays
 * legible. Returns the color unchanged when it already has enough contrast.
 */
export const ensureReadableTint = (
  color: string,
  scheme: ColorScheme,
  backgroundHex?: string,
) => {
  const background = normalizeAccentHex(backgroundHex) ?? SCHEME_BACKGROUND[scheme];
  const backgroundLuminance = getRelativeLuminance(background);
  const base = normalizeAccentHex(color) ?? color;

  if (contrastRatio(getRelativeLuminance(base), backgroundLuminance) >= MIN_CONTRAST_RATIO) {
    return base;
  }

  const targetChannel = scheme === "dark" ? 255 : 0;
  const STEPS = 12;
  let candidate = base;
  for (let step = 1; step <= STEPS; step += 1) {
    candidate = mixTowardChannel(base, targetChannel, step / STEPS);
    if (contrastRatio(getRelativeLuminance(candidate), backgroundLuminance) >= MIN_CONTRAST_RATIO) {
      break;
    }
  }
  return candidate;
};

/**
 * Curated light-mode base colors for Remembered User Sessions. Each is mid-dark so it
 * reads on a light background; the dark-mode variant is derived by lightening (see
 * resolveColorForScheme), reusing the accent-color helpers so a single stored color
 * works in both schemes.
 */
export const SESSION_COLOR_PALETTE = [
  "#1F6F43", // green
  "#1D4ED8", // blue
  "#9333EA", // purple
  "#BE123C", // rose
  "#0E7490", // teal
  "#B45309", // amber
  "#4D7C0F", // olive
  "#C2410C", // orange
] as const;

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

/** Deterministic palette color for a session key, used when no color is chosen. */
export const getDefaultSessionColor = (key: string) =>
  SESSION_COLOR_PALETTE[hashString(key) % SESSION_COLOR_PALETTE.length] ??
  DEFAULT_LIGHT_ACCENT_COLOR;

/** The light-mode base color for a session: the user's choice, else the auto default. */
export const getSessionBaseColor = (session: { key: string; color: string | null }) =>
  normalizeAccentHex(session.color) ?? getDefaultSessionColor(session.key);

/** Adjust a base (light-mode) hex for the active scheme. */
export const resolveColorForScheme = (baseHex: string, scheme: ColorScheme) =>
  scheme === "dark" ? deriveDarkAccentFromLight(baseHex) : (normalizeAccentHex(baseHex) ?? baseHex);

/**
 * Scheme-appropriate tint for a session. An explicit user-chosen color is used as
 * picked; the auto-assigned default is lightened for dark mode. Either way the result
 * is passed through a contrast safeguard so it stays readable on `backgroundHex` (the
 * surface it will tint), nudging it toward white/black only when it's too low-contrast.
 */
export const resolveSessionColor = (
  session: { key: string; color: string | null },
  scheme: ColorScheme,
  backgroundHex?: string,
) => {
  const userColor = normalizeAccentHex(session.color);
  const base = userColor ?? resolveColorForScheme(getDefaultSessionColor(session.key), scheme);
  return ensureReadableTint(base, scheme, backgroundHex);
};
