# Shared book presentations and context-specific action sets

**Status:** accepted

The app will use one canonical vertical `Book Presentation` for book-list rows, with shared book-action behavior and a shared menu renderer. Each presentation supplies an explicit `Book Action Set` by action ID, so library lists can expose Play/Pause, Bookshelves, Favorite, Read/Unread, Share, and optional actions such as View Author without forcing Home cards to expose the same menu. Navigation remains owned by the caller, long-press menus are enabled by default on vertical rows, and Home cards and sortable grids retain their distinct visual layouts while reusing shared action behavior.

This separates reusable behavior from presentation-specific composition. It avoids duplicating progress, favorite, playback, shelf, and sharing logic while preserving the intentional differences between Home, library lists, detail screens, and grid presentations.
