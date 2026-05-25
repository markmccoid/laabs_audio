# Form Sheet Layout Notes

Expo Router `formSheet` screens should use a plain root `View` with `flex: 1` and `collapsable={false}`.

```tsx
return (
  <View style={{ flex: 1 }} collapsable={false}>
    {/* fixed header, list, or other sheet content */}
  </View>
);
```

Rules for future form sheet screens:

- The containing root `View` must set `collapsable={false}`.
- Do not use `KeyboardAvoidingView` as the root wrapper unless the sheet contains keyboard input and the layout has been tested on device.
- Prefer a fixed header sibling plus a single scrollable sibling (`FlatList`, `FlashList`, or `ScrollView`) when the sheet needs a header.
- Keep list padding in `contentContainerStyle` rather than adding another scroll wrapper.

This avoids native `formSheet` measurement issues where the first content view or scrollable child can collapse or measure incorrectly.
