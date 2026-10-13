# Library / Session Switch Performance — To Do

Status: steps 1–2 and the token-refresh part of step 5 done on `perf/library-switch` (2026-10-13). Remaining: steps 3, 4 and the cheaper catalog-change check from step 5.

## Progress (2026-10-13)

- **Step 1 — gates instrumented.** `src/utils/switch-trace.ts` logs `switch_gate` rows (dev builds)
  per switch: `entry_resolved`, `active_library_ready`, `readiness_resolved`,
  `home_projection_resolved`, cover cleared, `home_ready`. `recordTimingLog` now reads the clock
  before waiting on the shared connection, so durations no longer include write-queue waits.
- **Finding (device, user switch to "mark"):** Home's data was ready at 2.35 s, but the cover held
  until 10.7 s — `enterUserSession` awaited a full Assistant Catalog rebuild (~8.3 s), which also
  blocked the post-switch overlay refresh ~7 s on the write guard; a second rebuild followed.
- **Step 2 — done.** `assistant-catalog-rebuild-scheduler.ts`: entry schedules the rebuild in the
  background; the SQLite refresh holds rebuilds while writing and requests one after, so one
  rebuild runs per switch; requests for a user who is no longer active are dropped and a boundary
  clear cancels pending ones. Device result: user switch **10.7 s → 1.7–2.9 s** to `home_ready`.
- **Step 5 (part) — done.** Restore reuses a remembered access token with >5 min left instead of
  refreshing it; `authFetch` answers a 401 with a forced refresh and retry. Sim QA: valid token
  restore 19 ms (no refresh), expired token refreshes, tampered-signature token recovers via
  401 → refresh → retry with no needs-attention state.
- **What remained in a switch before that:** `restore_remembered_session` 0.8–1.8 s (token refresh),
  then ~0.3 s to readiness/projection. Cold (uncached) library first visits are still slow
  (sim: 17 s, projection waits for the catalog download) — step 4. Do this on its own branch after
Imported Audiobooks ships. Touches User Session Entry and SQLite refresh, the fragile area
(ADR-0008, 0011, 0015, 0021), so it needs QA of login, logout, account switch and library switch.

## Symptom

Switching libraries or Remembered User Sessions (and logging in) shows a plain spinner with
"Loading library" for ~15 s with a 3,024-book library. The cached catalog for that library is already
in SQLite, so Home should be able to render almost immediately.

## Evidence (timing_logs, Settings → Shadow SQLite → Timing, dev builds)

One session switch to "tester", seconds from the tap:

| t (s) | Event | Notes |
|---|---|---|
| 0 → 7.3 | `login / restore_remembered_session` | token refresh (network) + **awaited** `replaceAssistantSurfaceContent` → `rebuildAssistantCatalog` |
| 2.7 → 9.6 | `sqlite_refresh_catalog` | full 6×500 page re-download; **0 inserted, 0 updated, 3,024 unchanged** |
| 9.6 → 10.8 | `sqlite_refresh_overlay` | progress; stale after only 2 min, so nearly every switch |
| 10.8 → 14.0 | `sqlite_refresh_assistant_catalog` | **second** full Assistant Catalog rebuild (3,024–6,828 rows, 2–6 s) |

Other observations across the log:
- Refreshes with nothing to do (`shouldRefreshCatalog:false, shouldRefreshOverlay:false`) still take
  2.7–5.6 s; one waited ~9.5 s before its overlay step began. Points at DB queueing.
- Catalog refresh with zero changes takes 2.5–9.8 s (network paging).
- Two users on the same server/library keep separate catalog copies, so switching users re-ingests.

## Likely causes

1. **One shared SQLite connection** (`shadow-db-core.ts` `getDb`). Home's readiness and projection reads
   (`use-home-shelves.ts` `readinessQuery` / `homeProjectionQuery`) queue behind refresh writes and
   Assistant rebuilds, so `isCatalogLoading` stays true.
2. **Assistant Catalog rebuilt twice per switch**: awaited in `enter-user-session.ts`
   (`replaceAssistantSurfaceContent`) and again in `refresh-coordinator.ts` after any refresh.
3. **Aggressive staleness**: catalog 15 min, overlay 2 min (`SQLITE_CATALOG_STALE_MS`,
   `SQLITE_OVERLAY_STALE_MS`); a no-change catalog still pages the whole library.
4. **Session restore always refreshes the token** (`authenticateRestore`) even when the stored access
   token is still valid.

## Plan (in order)

1. **Instrument the gates.** Timing marks for: Home overlay cleared (`home-shelves-screen.tsx` /
   `(home)/index.tsx` `pendingSessionKey` clear), readiness query resolved, home projection resolved,
   `entryResolved`, `activeLibraryReady`. Confirms which condition actually holds the spinner.
2. **Don't await the Assistant rebuild during entry.** Run one coalesced rebuild in the background after
   Home is presented (debounce entry + coordinator requests into a single job).
3. **Separate read connection.** Open a second expo-sqlite connection (`useNewConnection: true`) for
   readiness/home/search reads; WAL already allows concurrent reads, so reads stop queueing behind writes.
4. **Render Home from cache first.** Show the cached projection as soon as `hasCatalogRows`; run
   catalog/overlay refresh behind it and invalidate when done. Consider dropping the
   `lastOverlayRefreshAt` requirement from `isCatalogLoading` for libraries that have catalog rows.
5. **Cheaper refreshes.** Skip token refresh when the access token is unexpired; consider a cheaper
   "anything changed?" check (e.g. first page `updatedAt`) before paging the full catalog; revisit the
   2-min overlay threshold.

## Re-measure

Repeat the same switches on device (Debug is fine for relative numbers) and compare
`library_switch` / `login` rows before and after each step.
