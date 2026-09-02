import type {
  TranscriptSegmentTextRow,
  TranscriptSegmentWordTiming,
} from "@/data/sqlite/shadow-db-transcripts";
import type { ReadAlongBookmarkMarker } from "@/read-along/read-along-bookmark-markers";
import type { ReadAlongWordAppearance } from "@/read-along/read-along-rendering";

/**
 * The props and memoization contract for one Transcript Segment in the
 * Read-Along reader (`docs/read-along-implementation-plan.md` Phase 3.2).
 *
 * Split out from `read-along-segment-item.tsx` so the comparator can be
 * unit-tested: importing the component pulls in Reanimated's native module.
 * The contract below is load-bearing enough to deserve executable tests.
 *
 * ## Memoization contract (load-bearing)
 *
 * The word highlight ticks 2-4 times a second. Every one of those ticks must
 * re-render **exactly one** item — the active one — or a 5k-segment book pays
 * for the whole viewport on every word.
 *
 * That is what {@link areSegmentPropsEqual} enforces: an item re-renders only
 * when `row.id`, `isActive`, `fontSize` or `palette` change, and word-level
 * props (`words`, `activeWordIndex`) are compared **only while the item is
 * active**. Inactive items therefore ignore word ticks entirely, even though
 * the screen passes the same props down to every row.
 *
 * The consequences for callers:
 * - `palette` must be a memoized object, not rebuilt per render. The chosen
 *   word highlight style rides inside it, so changing the style re-renders
 *   every visible row exactly once and needs no extra prop.
 * - `onPress`, `onLongPress` and `onPressMarker` must be stable identities (they
 *   are intentionally not compared). This is a hard requirement, not a
 *   preference: a row whose other props are unchanged keeps whichever closure it
 *   last rendered with, so an unstable handler goes stale on exactly the rows
 *   that were not re-rendered. The symptom is a gesture doing the *previous*
 *   state's thing — a tap seeking instead of extending a selection, or extending
 *   from an anchor the reader already cancelled. The screen keeps these stable by
 *   reading mutable state through refs; see its `setSelection`.
 * - Never add a prop that changes per tick without extending the comparator.
 *
 * ## The two exempt props
 *
 * `isSelected` and `markers` (ADR 0035) are compared unconditionally, unlike the
 * word props. That is deliberate and safe: the rule above exists to keep
 * *playback-frequency* state cheap, and both of these change at **user**
 * frequency — a tap while selecting, or a bookmark being saved or deleted. A
 * handful of mounted rows re-rendering on a tap costs nothing. Do not read this
 * as licence to add a third such prop without the same argument.
 *
 * `markers` is compared by identity, so callers must hand every row a stable
 * array — `getMarkersForSegment` returns the shared `NO_MARKERS` for the
 * overwhelming majority that have none.
 */

export type ReadAlongSegmentPalette = {
  text: string;
  /** Accent at ~13% — the active segment's tint. */
  activeTint: string;
  /** Accent at ~22% — a segment inside the live Clip Selection. */
  selectionTint: string;
  /** The Bookmark Gutter's ink for a Clip Bookmark's rule and a Point Bookmark's dot. */
  markerColor: string;
  /**
   * How to mark the active word, already resolved from the user's chosen
   * highlight style. `null` means the word gets no treatment (`none`).
   *
   * It rides in the palette rather than arriving as its own prop so the memo
   * comparator below needs no new branch — see the contract above.
   */
  wordAppearance: ReadAlongWordAppearance | null;
};

export type ReadAlongSegmentItemProps = {
  row: TranscriptSegmentTextRow;
  isActive: boolean;
  /** True while this segment is inside the live Clip Selection. */
  isSelected: boolean;
  fontSize: number;
  palette: ReadAlongSegmentPalette;
  /** Word timings for THIS segment, or null (segment-tint-only mode). */
  words: readonly TranscriptSegmentWordTiming[] | null;
  activeWordIndex: number;
  /** Saved Bookmarks covering this segment. Must be a stable array identity. */
  markers: readonly ReadAlongBookmarkMarker[];
  onPress: (row: TranscriptSegmentTextRow) => void;
  onLongPress: (row: TranscriptSegmentTextRow) => void;
  onPressMarker: (marker: ReadAlongBookmarkMarker) => void;
};

export const areSegmentPropsEqual = (
  previous: ReadAlongSegmentItemProps,
  next: ReadAlongSegmentItemProps,
) => {
  if (
    previous.row.id !== next.row.id ||
    previous.isActive !== next.isActive ||
    previous.isSelected !== next.isSelected ||
    previous.markers !== next.markers ||
    previous.fontSize !== next.fontSize ||
    previous.palette !== next.palette
  ) {
    return false;
  }
  // Word props only matter to the segment that is actually showing them.
  if (!next.isActive) return true;
  return previous.words === next.words && previous.activeWordIndex === next.activeWordIndex;
};
