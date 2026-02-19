# Theming Implementation Plan

## Goals
- Keep styling minimal and token-based.
- Use Uniwind CSS variables for light/dark with system mode.
- Keep React Navigation colors in sync with the same tokens.
- Introduce one accent color per theme for action emphasis.

## Source References
- [Uniwind Theming Basics](https://docs.uniwind.dev/theming/basics)
- [Uniwind Global CSS](https://docs.uniwind.dev/theming/global-css)
- [Uniwind Style Based on Themes](https://docs.uniwind.dev/theming/style-based-on-themes)

## Theme Tokens (v1)
- `--color-bg`
- `--color-surface`
- `--color-text`
- `--color-text-muted`
- `--color-border`
- `--color-accent`

## Initial Values (v1)
- Light accent: `#1f6f43`
- Dark accent: `#3ea56d`

## Phase 1 (Implemented)
1. Define theme variables in `src/global.css` using `@layer theme` with `@variant light` and `@variant dark` inside `:root`.
2. Add `src/theme/use-app-theme.ts` to read CSS vars via `useCSSVariable`.
3. Sync React Navigation theme in `src/app/_layout.tsx` through `ThemeProvider`.
4. Apply v1 token wiring to high-visibility screens/components:
- `src/app/(tabs)/_layout.tsx`
- `src/components/bookComponents/book-time-slider.tsx`
- `src/app/login.tsx`
- `src/app/library-picker.tsx`
- `src/app/(tabs)/settings/index.tsx`
- `src/app/(tabs)/(home)/index.tsx`

## Phase 2 (Implemented: Core Playback Screens)
Migrated hardcoded neutrals/actions to tokens in these files:

1. `src/app/chapter-viewer.tsx`
2. `src/components/bookComponents/book-details.tsx`
3. `src/components/bookComponents/download-controls.tsx`
4. `src/components/bookComponents/book-controls.tsx`
5. `src/components/bookComponents/book-rate-setter.tsx`
6. `src/components/bookComponents/BookContainer.tsx`
7. `src/components/bookComponents/book-image.tsx`

## Phase 3 (Remaining Cleanup)
Continue migration for lower-priority remnants and defaults:

1. `src/components/bookComponents/play-pause-animation.tsx`
- Remove remaining hardcoded default tint in props fallback.

2. Any future/new component work
- Avoid introducing new hardcoded neutral color values in `src/`.

## Migration Rules
- Prefer utility classes: `bg-bg`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`, `bg-accent`.
- For inline styles and third-party props, use `useThemeColors()`.
- Keep hardcoded hex only for explicit semantic alerts/states not covered by base tokens.

## Done Criteria
- No generic hardcoded neutral/surface text colors remain in `src/` UI code.
- Navigation, tabs, sliders, and primary actions remain visually consistent in light and dark system mode.
