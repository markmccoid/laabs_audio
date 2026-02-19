# LAABS Theming Style Guide

## Principle
Use a small token set and apply it consistently across screens, controls, and navigation.

## Canonical Tokens
- `--color-bg`: app/page background
- `--color-surface`: cards, sheets, panels
- `--color-text`: primary text and icon color
- `--color-text-muted`: secondary/supporting text
- `--color-border`: borders, dividers, disabled tracks
- `--color-accent`: primary interactive emphasis (tabs, slider thumb, primary buttons)

## Where Tokens Live
- `src/global.css` in `@layer theme`.
- Use Uniwind variant syntax inside `:root`:
- `@variant light { ... }`
- `@variant dark { ... }`

## Access Patterns
1. Utility classes (preferred)
- `bg-bg`
- `bg-surface`
- `text-text`
- `text-text-muted`
- `border-border`
- `bg-accent` / `text-accent` / `border-accent`

2. JS style props / third-party props
- Use `useThemeColors()` from `src/theme/use-app-theme.ts`.
- Example targets: `ActivityIndicator`, `Slider`, `SymbolView`, inline `style`.

3. Navigation theme sync
- Use `useNavigationTheme()` from `src/theme/use-app-theme.ts`.
- Wrap app with `ThemeProvider` in `src/app/_layout.tsx`.

## Accent Usage Rules
- Use accent for:
- selected tab icon/label
- slider active track + thumb
- primary call-to-action buttons
- active selection states
- Avoid accent for large text blocks or whole-page backgrounds.

## Component Checklist
1. Replace hardcoded neutral colors with tokens.
2. Keep one dominant surface and one border tone.
3. Use muted text for metadata only.
4. Use accent only on actionable/high-emphasis elements.
5. Verify both light and dark via system theme switching.

## Non-Token Exceptions
- Error/warning/success semantic messaging can use dedicated semantic colors.
- Keep these isolated to semantic feedback components, not general layout styling.

## References
- [Uniwind Theming Basics](https://docs.uniwind.dev/theming/basics)
- [Uniwind Global CSS](https://docs.uniwind.dev/theming/global-css)
- [Uniwind Style Based on Themes](https://docs.uniwind.dev/theming/style-based-on-themes)
