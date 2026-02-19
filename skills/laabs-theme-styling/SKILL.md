---
name: laabs-theme-styling
description: Apply LAABS app theming with Uniwind CSS variables and React Navigation theme sync. Use for styling new screens/components or refactoring hardcoded colors in this repo.
---

# LAABS Theme Styling

## Use This Skill When
- Styling or restyling UI in this repo.
- Refactoring hardcoded colors in `src/`.
- Adding components that must respect light/dark system theme.

## Primary References
- `docs/theming-style-guide.md`
- `docs/theming-implementation-plan.md`

## Workflow
1. Confirm token usage against `src/global.css`.
2. Prefer utility classes for standard layout/text/borders.
3. For JS styles and third-party props, use `useThemeColors()` from `src/theme/use-app-theme.ts`.
4. Keep navigation in sync through `useNavigationTheme()` and `ThemeProvider`.
5. Apply accent only to actionable/high-emphasis UI (tabs, slider thumb, primary CTA).

## Guardrails
- Default to six base tokens only:
- `--color-bg`
- `--color-surface`
- `--color-text`
- `--color-text-muted`
- `--color-border`
- `--color-accent`
- Keep theme mode system-based unless the user explicitly asks for manual override.
- Avoid new hardcoded neutral hex values in `src/` UI code.
- Keep semantic alert colors isolated to semantic feedback UI.

## Migration Pattern
1. Replace hardcoded neutrals with token classes.
2. Replace inline color styles with `useThemeColors()`.
3. Verify both light/dark system theme behavior.
4. Update docs if token policy changes.
