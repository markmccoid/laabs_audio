# 🤖 AI Style Guide

This guide defines code style and clarity conventions for AI agents working on this codebase (e.g. Junie). It exists to reduce repeated feedback and ensure readable, maintainable, developer-friendly output.

> ❌ This is not a logic contract.
> ✅ It is a guide for how to express code, comments, and changes cleanly and consistently.

---

## ✂️ Code Removal

- ✅ **If you're removing functionality**, delete the code completely.
- ❌ **Do not** comment out code that’s no longer needed.
  - Example of what *not* to do:
    ```swift
    // currentTrack = nil
    ```
  - Instead:
    ```swift
    // Note: currentTrack is retained after stop for resume and lock screen metadata
    ```

---

## 💬 Comments

- Write comments that explain **why**, not what.
  - ✅ `// Ensure state is only emitted once per transition`
  - ❌ `// Set state`
- Do not leave dead code or ambiguous comments like `// maybe needed later`
- Use consistent comment headers to mark logical sections in Swift or Kotlin:
  ```swift
  ////////////////////////////////////////////////////////////
  // MARK: - Playback Events
  ////////////////////////////////////////////////////////////
  ```

---

## 🧱 Consistency

- Follow existing naming, spacing, and formatting conventions in the project.
- Match TypeScript, Swift, or Kotlin idioms as used in the existing codebase.
- Don’t introduce new coding styles or structures unless you're instructed to refactor.

---

## 🧼 Readability

- Use clear, meaningful variable names — even in private or scoped logic.
- Avoid unnecessary nesting or repetition.
- When editing, prefer clarity over cleverness — prioritize maintainability.

---

## 🧪 Testing Code Comments

- If tests or debug helpers are included, they should be clearly separated with a comment block.
- Avoid mixing production logic with temporary validation logic.

---

## 📄 Documentation Comments

- For exported methods or modules, leave a brief JSDoc or Swift/Kotlin docstring.
  ```swift
  /// Pauses the current track and emits a PAUSED state
  @objc func pause() { ... }
  ```

---

## ✅ Summary

| Do | Don’t |
|----|-------|
| Delete code that’s being removed | Leave it commented out |
| Explain *why*, not *what* | Write vague or obvious comments |
| Use clean, consistent formatting | Introduce new formatting styles |
| Mark logic sections clearly | Leave unrelated logic mixed together |
| Follow the contract in `logic.md` | Assume your own state or event rules |
