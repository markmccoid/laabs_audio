import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import {
  getBookTranscriptStatus,
  getSegmentTextRows,
  getTranscriptFrontierMs,
  type BookTranscriptSection,
  type TranscriptSegmentTextRow,
} from "@/data/sqlite/shadow-db-transcripts";
import { playbackStore, playerService, usePlaybackStore } from "@/player";
import {
  buildBookmarkMarkerMap,
  getMarkersForSegment,
  type ReadAlongBookmarkMarker,
} from "@/read-along/read-along-bookmark-markers";
import {
  deriveClipSelectionRange,
  extendSelection,
  getSelectionBounds,
  isSegmentSelected,
  startSelection,
  wouldExceedMaximumDuration,
  type ClipSelection,
} from "@/read-along/read-along-clip-selection";
import {
  buildReadAlongListModel,
  findListIndexForPosition,
  type ReadAlongListItem,
} from "@/read-along/read-along-list-model";
import {
  resolveWordHighlightStyle,
  withAlpha,
} from "@/read-along/read-along-rendering";
import { useFollowMode } from "@/read-along/use-follow-mode";
import { useReadAlongHighlight } from "@/read-along/use-read-along-highlight";
import { deviceBooksStore, useDeviceBooksStore } from "@/store/device-books-store";
import { useSettingsStore } from "@/store/settings-store";
import {
  useTranscriptionStore,
  type BookTranscriptionRuntimeStatus,
} from "@/store/transcription-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  getBookTranscriptUiStatus,
  resumeIfNeeded,
  startBookTranscription,
} from "@/transcription/book-transcription";
import { useShippedTranscriptIngest } from "@/transcription/use-shipped-transcript-ingest";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useKeepAwake } from "expo-keep-awake";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import { ReadAlongControls } from "./read-along-controls";
import { useAlignmentIngest } from "@/alignment/use-alignment-ingest";
import { EpubReadAlongSurface } from "./epub-read-along-surface";
import { ReadAlongEmptyState } from "./read-along-empty-state";
import {
  initialReadAlongSurface,
  ReadAlongSurfacePicker,
  type ReadAlongSurface,
} from "./read-along-surface-picker";
import { ReadAlongHeader } from "./read-along-header";
import { ReadAlongPendingBlock } from "./read-along-pending-block";
import { ReadAlongSegmentItem } from "./read-along-segment-item";
import { ReadAlongSelectionBar } from "./read-along-selection-bar";

/**
 * The Read-Along reader (`docs/read-along-implementation-plan.md` Phase 3).
 *
 * Renders the bound book's Book Transcript as a scrolling reader, highlights the
 * current Transcript Segment and word in sync with the Listening Position, and
 * follows playback down the page until the reader scrolls by hand.
 *
 * ## Render budget
 *
 * The word highlight ticks 2-4 times a second, so anything that re-renders this
 * component re-renders the FlashList container. Two rules keep that cheap:
 * - Everything that changes at playback frequency lives in a child that
 *   subscribes for itself (`ReadAlongControls`, `ReadAlongPendingBlock`), never
 *   in this component's props.
 * - Segment items are memoized on `(row.id, isActive, fontSize, palette)` — see
 *   `read-along-segment-props.ts` — so a word tick re-renders exactly one row.
 *
 * ## When there is nothing to read
 *
 * Everything that is not the reader — no transcript yet, a transcription still
 * running, an interrupted or failed one — lives in `ReadAlongEmptyState`
 * (Phase 4). This screen only decides *whether* the reader has content; that
 * component decides what the alternative looks like.
 *
 * ## Clip Selection and the Bookmark Gutter (ADR 0035)
 *
 * A long-press starts a **Clip Selection**; while one exists, taps extend or
 * shrink it instead of seeking, and Follow Mode is suspended so the page holds
 * still (audio keeps playing — the reader wants to hear what they are clipping).
 * Saving hands a seeded clip draft to the Add Bookmark Sheet rather than writing
 * a bookmark here, so there stays exactly one save path.
 *
 * Both selection state and the per-row bookmark markers are ordinary screen
 * state and are compared by the segment item's memo comparator. That is a
 * deliberate exemption from the render budget above, on the grounds that both
 * change at *user* frequency — a tap, a save — not at playback frequency. The
 * marker map is memoized so each row's `markers` array keeps a stable identity.
 */

/** Accent opacity for the active segment's tint (plan: ~12-15%). */
const ACTIVE_TINT_ALPHA = 0.13;
/**
 * The Clip Selection's tint, deliberately stronger than the active segment's so
 * the two are separable when playback runs through a selection — which it does,
 * because selecting only suspends Follow Mode, never the audio (ADR 0035).
 */
const SELECTION_TINT_ALPHA = 0.28;

type TranscriptSnapshot = {
  libraryItemId: string;
  /** The bound book's own title — never the player's, which may be another book. */
  bookTitle: string | null;
  sections: BookTranscriptSection[] | null;
  segments: TranscriptSegmentTextRow[];
  frontierMs: number;
  status: BookTranscriptionRuntimeStatus;
  localeIdentifier: string | null;
  errorCode: string | null;
};

type ReadAlongScreenProps = {
  libraryItemId?: string;
  /** Route param: which surface to open on. See `initialReadAlongSurface`. */
  initialSurface?: string;
};

const ReadAlongScreen = ({ libraryItemId, initialSurface }: ReadAlongScreenProps) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlashListRef<ReadAlongListItem>>(null);

  useKeepAwake();

  // The book this view is bound to. Only an explicit Switch on the
  // different-book notice changes it — the view never auto-follows the player.
  const [boundLibraryItemId, setBoundLibraryItemId] = useState<string | null>(
    libraryItemId ?? null,
  );
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot | null>(null);
  // No book id means there is nothing to load, so the reader is never "loading".
  const [isLoading, setIsLoading] = useState(Boolean(libraryItemId));

  const ingest = useShippedTranscriptIngest(boundLibraryItemId);
  const fontSize = useSettingsStore((state) => state.readAlongFontSize);
  const wordHighlightStyle = useSettingsStore((state) => state.readAlongWordHighlightStyle);
  const playingLibraryItemId = usePlaybackStore((state) => state.libraryItemId);

  //~~ Data assembly ------------------------------------------------------
  // A frontier advance re-runs this whole load: the transcription runtime store
  // reports each completed track, and the freshly written segments then replace
  // the pending block for the section that just became readable.
  const completedTracks = useTranscriptionStore((state) =>
    state.activeTask?.libraryItemId === boundLibraryItemId
      ? state.activeTask.completedTracks
      : null,
  );
  const runtimeStatus = useTranscriptionStore((state) =>
    boundLibraryItemId ? (state.statusById[boundLibraryItemId] ?? "idle") : "idle",
  );
  // The transcript row (and its frozen sections) is only written once the speech
  // model is ready, i.e. when the phase leaves `preparing_model`. Reloading on
  // that flip is what turns the "Preparing speech model..." state into the
  // reader's pending blocks without waiting for the first track to finish.
  const activePhase = useTranscriptionStore((state) =>
    state.activeTask?.libraryItemId === boundLibraryItemId ? state.activeTask.phase : null,
  );

  // Guards against an out-of-order reply when a frontier advance (or a Switch)
  // starts a second load before the first resolves.
  const loadRequestIdRef = useRef(0);
  const loadSnapshot = useCallback((bookId: string) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    // `getBookTranscriptStatus` carries the frozen `sections` as well as the
    // book's own title, so it stands in for `getTranscriptSections` here: one
    // row read instead of two for the same JSON.
    return Promise.all([
      getBookTranscriptStatus(bookId),
      getSegmentTextRows(bookId),
      getTranscriptFrontierMs(bookId),
      getBookTranscriptUiStatus(bookId),
    ])
      .then(([transcript, segments, frontierMs, uiStatus]): TranscriptSnapshot => {
        return {
          libraryItemId: bookId,
          bookTitle: transcript?.bookTitle ?? null,
          sections: transcript?.sections ?? null,
          segments,
          frontierMs,
          status: uiStatus.status,
          localeIdentifier: uiStatus.localeIdentifier,
          errorCode: uiStatus.errorCode,
        };
      })
      .catch(
        (): TranscriptSnapshot => ({
          // A read failure reads as "no transcript" — Phase 4's state screen —
          // rather than a dead reader.
          libraryItemId: bookId,
          bookTitle: null,
          sections: null,
          segments: [],
          frontierMs: 0,
          status: "idle",
          localeIdentifier: null,
          errorCode: null,
        }),
      )
      .then((next) => {
        if (requestId !== loadRequestIdRef.current) return;
        setSnapshot(next);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!boundLibraryItemId) return;
    void loadSnapshot(boundLibraryItemId);
  }, [
    boundLibraryItemId,
    completedTracks,
    runtimeStatus,
    activePhase,
    loadSnapshot,
    ingest.phase,
    ingest.outcome,
  ]);

  const model = useMemo(
    () =>
      buildReadAlongListModel({
        sections: snapshot?.sections ?? null,
        segments: snapshot?.segments ?? [],
        frontierMs: snapshot?.frontierMs ?? 0,
        isTranscriptComplete: snapshot?.status === "complete",
      }),
    [snapshot],
  );

  //~~ Highlight + follow -------------------------------------------------
  const { activeSegmentIndex, activeSegment, activeSegmentWords, activeWordIndex, isBookMismatch } =
    useReadAlongHighlight({
      boundLibraryItemId,
      segments: model.readableSegments,
      isWordHighlightEnabled: wordHighlightStyle !== "none",
    });

  // Where Follow Mode should park the viewport. The active segment when there
  // is one; otherwise the nearest preceding row, so an ASR gap holds still and
  // a seek past the frontier lands on the pending block. Selecting the *index*
  // (not the position) keeps this a segment-rate re-render, not a 1 Hz one.
  const coarseListIndex = usePlaybackStore((state) =>
    state.libraryItemId === boundLibraryItemId
      ? findListIndexForPosition(model.items, state.positionMs)
      : -1,
  );
  const activeListIndex =
    activeSegmentIndex >= 0
      ? (model.listIndexBySegmentIndex[activeSegmentIndex] ?? -1)
      : coarseListIndex;

  const { followEnabled, resumeFollowing, handleScrollBeginDrag, suspendFollowing } = useFollowMode(
    { listRef, activeListIndex },
  );

  // FlashList v2 can leave its render window behind after a data swap (see
  // src/components/Library/LibraryContainer.tsx:116-124). A frontier advance is
  // exactly such a swap, so re-anchor once the new rows have rendered — but
  // only while Follow Mode is on, since yanking a reader who scrolled away by
  // hand would be worse than the quirk.
  const listGeneration = model.items.length;
  useEffect(() => {
    if (!followEnabled) return;
    if (activeListIndex < 0) return;

    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: activeListIndex,
          animated: false,
          viewPosition: 0.4,
        });
      }, 100);
    });
    return () => cancelAnimationFrame(frame);
    // Deliberately keyed on the data generation only: this is the post-swap
    // re-anchor, not the continuous follow (that is useFollowMode's job).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listGeneration]);

  //~~ Bookmark Gutter ----------------------------------------------------
  // Bookmarks belong to the *bound* book's listening owner, not the player's,
  // so the reader stays correct while another book is loaded.
  const resolvedUserKey = useResolvedListeningOwnerKey(boundLibraryItemId ?? undefined);
  const localBookmarksForUser = useDeviceBooksStore((state) =>
    resolvedUserKey ? state.localBookmarksByUser[resolvedUserKey] : undefined,
  );
  const bookmarksForBook = useMemo(() => {
    if (!boundLibraryItemId) return [];
    return Object.values(localBookmarksForUser ?? {})
      .filter((bookmark) => bookmark.libraryItemId === boundLibraryItemId)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  }, [boundLibraryItemId, localBookmarksForUser]);

  // Rebuilt only when the bookmarks or the readable segments change, which is
  // what makes each row's `markers` array a stable identity between renders —
  // the segment item compares it by reference (see its memoization contract).
  const markerMap = useMemo(
    () => buildBookmarkMarkerMap({ bookmarks: bookmarksForBook, segments: model.readableSegments }),
    [bookmarksForBook, model.readableSegments],
  );

  const handlePressMarker = useCallback(
    (marker: ReadAlongBookmarkMarker) => {
      if (!boundLibraryItemId) return;
      router.push({
        pathname: "/book-bookmark-detail",
        params: { libraryItemId: boundLibraryItemId, bookmarkId: marker.bookmarkId },
      });
    },
    [boundLibraryItemId],
  );

  //~~ Clip Selection -----------------------------------------------------
  // Segment id -> index into `readableSegments`. Every selection gesture needs
  // that index and only has the row, and a scan would be over every segment in
  // the book — ~5k on a long one — on each tap.
  const segmentIndexById = useMemo(() => {
    const index = new Map<number, number>();
    model.readableSegments.forEach((segment, position) => index.set(segment.id, position));
    return index;
  }, [model.readableSegments]);

  /**
   * Selection state is mirrored into a ref and every mutation goes through
   * {@link setSelection}, which writes the ref **synchronously**.
   *
   * This is not belt-and-braces. `areSegmentPropsEqual` does not compare the
   * gesture callbacks — the memo contract requires them to be stable identities
   * — so a row whose other props are unchanged keeps whichever closure it last
   * rendered with. A handler that closed over `selection` would therefore go
   * stale on exactly the rows that were not re-rendered: the first tap after a
   * long-press would seek instead of extending, and a tap after a cancel would
   * extend from the *previous* selection's anchor. Reading through the ref keeps
   * the handlers stable and the contract intact.
   */
  const [selection, setSelectionState] = useState<ClipSelection | null>(null);
  const selectionRef = useRef<ClipSelection | null>(null);
  const setSelection = useCallback((next: ClipSelection | null) => {
    selectionRef.current = next;
    setSelectionState(next);
  }, []);

  // Same reasoning for the data the handlers read. A frontier advance grows both
  // without unmounting the list, so a handler that closed over them would keep
  // resolving against the shorter transcript.
  const readableSegmentsRef = useRef(model.readableSegments);
  const segmentIndexByIdRef = useRef(segmentIndexById);
  useEffect(() => {
    readableSegmentsRef.current = model.readableSegments;
    segmentIndexByIdRef.current = segmentIndexById;
  }, [model.readableSegments, segmentIndexById]);

  const selectionBounds = selection ? getSelectionBounds(selection) : null;
  const selectionRange = useMemo(
    () =>
      selection
        ? deriveClipSelectionRange({ segments: model.readableSegments, selection })
        : null,
    [selection, model.readableSegments],
  );

  const handleLongPressSegment = useCallback(
    (row: TranscriptSegmentTextRow) => {
      const segmentIndex = segmentIndexByIdRef.current.get(row.id);
      if (segmentIndex === undefined) return;
      // The page must hold still to be selectable; the audio deliberately does
      // not stop, so the reader can hear the passage they are clipping.
      suspendFollowing();
      setSelection(startSelection(segmentIndex));
    },
    [suspendFollowing, setSelection],
  );

  const handleCancelSelection = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  const handleSaveSelection = useCallback(() => {
    if (!boundLibraryItemId || !selectionRange) return;
    router.push({
      pathname: "/book-addbookmark",
      params: {
        libraryItemId: boundLibraryItemId,
        clipStartSeconds: String(selectionRange.startSeconds),
        clipEndSeconds: String(selectionRange.endSeconds),
      },
    });
  }, [boundLibraryItemId, selectionRange]);

  // Whether the selection survived the trip to the Add Bookmark Sheet is
  // inferred rather than reported: expo-router gives no return channel, and a
  // saved clip is visible in the store the moment we come back. A clip covering
  // the range means the save happened, so the selection gives way to its new
  // gutter rule; anything else means cancel, and the selection is still there to
  // adjust (ADR 0035).
  //
  // The check must fire on a focus *regain* and nothing else. Keying it on the
  // selection instead would run it the instant a reader selects a passage they
  // had already clipped, clearing the selection under their finger and reading
  // as a broken long-press. Hence the ref for the range and a direct store read
  // rather than the rendered values, which would drag both into the deps.
  const selectionRangeRef = useRef(selectionRange);
  useEffect(() => {
    selectionRangeRef.current = selectionRange;
  }, [selectionRange]);

  useFocusEffect(
    useCallback(() => {
      const range = selectionRangeRef.current;
      if (!range || !boundLibraryItemId || !resolvedUserKey) return;
      const records = deviceBooksStore.getState().localBookmarksByUser[resolvedUserKey] ?? {};
      const wasSaved = Object.values(records).some(
        (bookmark) =>
          bookmark.libraryItemId === boundLibraryItemId &&
          bookmark.kind === "clip" &&
          bookmark.startTimeSeconds === range.startSeconds &&
          bookmark.endTimeSeconds === range.endSeconds,
      );
      if (wasSaved) setSelection(null);
    }, [boundLibraryItemId, resolvedUserKey, setSelection]),
  );

  //~~ Tap to seek --------------------------------------------------------
  const isSeekPendingRef = useRef(false);
  const handleSeekToSegment = useCallback(
    (row: TranscriptSegmentTextRow) => {
      if (!boundLibraryItemId) return;
      if (isSeekPendingRef.current) return;
      const state = playbackStore.getState();
      // Read-Along binds to the playing book, so there is no load-if-needed
      // here — a tap while another book is loaded does nothing but leave the
      // different-book notice on screen.
      if (state.libraryItemId !== boundLibraryItemId || state.queue.length === 0) return;

      isSeekPendingRef.current = true;
      const wasPlaying = state.playbackState === "playing";
      void (async () => {
        try {
          await playerService.seekTo(row.startMs);
          if (!wasPlaying && playbackStore.getState().playbackState === "playing") {
            await playerService.pause();
          }
        } finally {
          isSeekPendingRef.current = false;
        }
      })().catch(() => {
        isSeekPendingRef.current = false;
      });
    },
    [boundLibraryItemId],
  );

  // One tap, two meanings, decided by whether a selection is live. Nothing else
  // in the reader overloads a gesture — the gutter marker is its own hit target
  // precisely so this stays the only fork.
  const handlePressSegment = useCallback(
    (row: TranscriptSegmentTextRow) => {
      const currentSelection = selectionRef.current;
      if (!currentSelection) {
        handleSeekToSegment(row);
        return;
      }
      const segmentIndex = segmentIndexByIdRef.current.get(row.id);
      if (segmentIndex === undefined) return;
      if (
        wouldExceedMaximumDuration({
          segments: readableSegmentsRef.current,
          selection: currentSelection,
          segmentIndex,
        })
      ) {
        toast.info("That is longer than a clip can be");
        return;
      }
      setSelection(extendSelection(currentSelection, segmentIndex));
    },
    [handleSeekToSegment, setSelection],
  );

  //~~ Pending block actions ---------------------------------------------
  const handleResumeTranscription = useCallback(() => {
    if (!boundLibraryItemId) return;
    void resumeIfNeeded(boundLibraryItemId).catch((error: unknown) => {
      toast.error("Transcription could not start", {
        description: error instanceof Error ? error.message : undefined,
      });
    });
  }, [boundLibraryItemId]);

  const handleRetryTranscription = useCallback(() => {
    if (!boundLibraryItemId) return;
    void startBookTranscription(boundLibraryItemId, {
      localeIdentifier: snapshot?.localeIdentifier ?? undefined,
    }).catch((error: unknown) => {
      toast.error("Transcription could not start", {
        description: error instanceof Error ? error.message : undefined,
      });
    });
  }, [boundLibraryItemId, snapshot?.localeIdentifier]);

  //~~ Different-book notice ---------------------------------------------
  // `isBookMismatch` is also true when nothing is loaded; the notice is only
  // honest when the player actually holds another book.
  const showDifferentBookNotice =
    isBookMismatch && playingLibraryItemId !== null && playingLibraryItemId !== boundLibraryItemId;
  const [switchTargetStatus, setSwitchTargetStatus] =
    useState<BookTranscriptionRuntimeStatus | null>(null);

  useEffect(() => {
    if (!showDifferentBookNotice || !playingLibraryItemId) return;
    let isCancelled = false;
    void getBookTranscriptUiStatus(playingLibraryItemId)
      .catch(() => null)
      .then((uiStatus) => {
        if (isCancelled) return;
        setSwitchTargetStatus(uiStatus?.status ?? null);
      });
    return () => {
      isCancelled = true;
    };
  }, [showDifferentBookNotice, playingLibraryItemId]);

  const canSwitchToPlayingBook =
    switchTargetStatus === "complete" ||
    switchTargetStatus === "active" ||
    switchTargetStatus === "resumable";

  const handleSwitchBook = useCallback(() => {
    if (!playingLibraryItemId) return;
    setSwitchTargetStatus(null);
    setIsLoading(true);
    setSnapshot(null);
    setBoundLibraryItemId(playingLibraryItemId);
  }, [playingLibraryItemId]);

  //~~ Rendering ----------------------------------------------------------
  // The chosen word treatment rides inside the palette so a style change costs
  // one re-render of the visible rows and the item comparator stays untouched
  // (see the memoization contract in `read-along-segment-props.ts`).
  const segmentPalette = useMemo(
    () => ({
      text: themeColors.text,
      activeTint: withAlpha(themeColors.accent, ACTIVE_TINT_ALPHA),
      selectionTint: withAlpha(themeColors.accent, SELECTION_TINT_ALPHA),
      markerColor: themeColors.accent,
      wordAppearance: resolveWordHighlightStyle(wordHighlightStyle, {
        accent: themeColors.accent,
      }),
    }),
    [themeColors.text, themeColors.accent, wordHighlightStyle],
  );

  const pendingPalette = useMemo(
    () => ({
      text: themeColors.text,
      textMuted: themeColors.textMuted,
      border: themeColors.border,
      surface: themeColors.surface,
      accent: themeColors.accent,
      accentForeground: themeColors.accentForeground,
    }),
    [
      themeColors.text,
      themeColors.textMuted,
      themeColors.border,
      themeColors.surface,
      themeColors.accent,
      themeColors.accentForeground,
    ],
  );

  const firstPendingSectionIndex = model.pendingSectionIndexes[0] ?? null;
  const activeSegmentId = activeSegment?.id ?? null;

  const renderItem = useCallback(
    ({ item }: { item: ReadAlongListItem }) => {
      if (item.type === "sectionHeader") {
        return (
          <Text
            style={{
              marginTop: 22,
              marginBottom: 6,
              paddingHorizontal: 10,
              fontSize: 13,
              fontWeight: "700",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: themeColors.textMuted,
            }}
          >
            {item.title}
          </Text>
        );
      }

      if (item.type === "pendingSection") {
        return (
          <ReadAlongPendingBlock
            boundLibraryItemId={boundLibraryItemId ?? ""}
            transcriptStatus={snapshot?.status ?? "idle"}
            isFirstPending={item.sectionIndex === firstPendingSectionIndex}
            palette={pendingPalette}
            onResume={handleResumeTranscription}
            onRetry={handleRetryTranscription}
          />
        );
      }

      const isActive = item.row.id === activeSegmentId;
      return (
        <ReadAlongSegmentItem
          row={item.row}
          isActive={isActive}
          isSelected={isSegmentSelected(selection, item.segmentIndex)}
          fontSize={fontSize}
          palette={segmentPalette}
          words={isActive ? activeSegmentWords : null}
          activeWordIndex={activeWordIndex}
          markers={getMarkersForSegment(markerMap, item.row.id)}
          onPress={handlePressSegment}
          onLongPress={handleLongPressSegment}
          onPressMarker={handlePressMarker}
        />
      );
    },
    [
      themeColors.textMuted,
      boundLibraryItemId,
      snapshot?.status,
      firstPendingSectionIndex,
      pendingPalette,
      handleResumeTranscription,
      handleRetryTranscription,
      activeSegmentId,
      selection,
      fontSize,
      segmentPalette,
      activeSegmentWords,
      activeWordIndex,
      markerMap,
      handlePressSegment,
      handleLongPressSegment,
      handlePressMarker,
    ],
  );

  /**
   * `enabled: false` — this instance never fetches anything. It is here purely
   * for `hasMapOnServer`, which is a free read of item details the app already
   * holds, and which decides whether the surface picker appears at all. The real
   * ingest belongs to `EpubReadAlongSurface`, and only runs once that mounts.
   */
  const alignment = useAlignmentIngest(boundLibraryItemId, { enabled: false });
  // iOS only: `plugins/with-readium.js` wires the iOS Podfile alone, and the
  // decoration cost model is a WKWebView number (ADR-0039).
  const canReadBook = Platform.OS === "ios" && alignment.hasMapOnServer;
  const [surface, setSurface] = useState<ReadAlongSurface>(() =>
    initialReadAlongSurface(initialSurface, canReadBook),
  );
  // The map's presence arrives with item details, a render or two after mount.
  // Without this, a book that should open on its EPUB opens on the transcript
  // and stays there.
  const settledInitialSurfaceRef = useRef(false);
  useEffect(() => {
    if (settledInitialSurfaceRef.current || !alignment.hasMapOnServer) return;
    settledInitialSurfaceRef.current = true;
    setSurface(initialReadAlongSurface(initialSurface, canReadBook));
  }, [alignment.hasMapOnServer, canReadBook, initialSurface]);

  const isBookSurface = surface === "book" && canReadBook;

  /**
   * Bumped every time the reader returns from the Book surface, to remount the
   * transcript list and re-anchor it.
   *
   * Coming back needs both halves. The list is remounted because recycled rows
   * can carry a stale tint (see the FlashList `key` below), and Follow Mode is
   * forced back on because the transcript's own follow state is untouched by
   * what happened on the other surface — the reader was following narration in
   * the EPUB, so landing on a transcript parked wherever it was left reads as
   * the reader having lost their place.
   *
   * This deliberately overrides a manual scroll the reader made before
   * switching away. Switching surfaces is an explicit request to see the
   * narrated text in the other form, which is exactly what Follow Mode is for.
   */
  const [transcriptGeneration, setTranscriptGeneration] = useState(0);
  const wasBookSurfaceRef = useRef(isBookSurface);
  useEffect(() => {
    const wasBook = wasBookSurfaceRef.current;
    wasBookSurfaceRef.current = isBookSurface;
    if (isBookSurface || !wasBook) return;
    setTranscriptGeneration((generation) => generation + 1);
  }, [isBookSurface]);

  useEffect(() => {
    if (transcriptGeneration === 0) return;
    // Same two-stage wait as the post-swap re-anchor above: the list has just
    // been remounted and cannot be scrolled to an index it has not laid out yet.
    const frame = requestAnimationFrame(() => {
      setTimeout(() => resumeFollowing(), 100);
    });
    return () => cancelAnimationFrame(frame);
  }, [transcriptGeneration, resumeFollowing]);

  const bookTitle = snapshot?.bookTitle ?? "Read Along";
  const hasReaderContent = model.items.length > 0;
  const waitingForIngest = ingest.phase === "pending" || ingest.phase === "ingesting";
  const showTranscriptLoading = isLoading || (waitingForIngest && !hasReaderContent);
  // The footer needs this too: its rate menu lifts to clear the pill rather
  // than covering it. The selection bar takes the pill's slot outright — both
  // float at the same offset, and resuming Follow Mode mid-selection would
  // scroll the page out from under the sentence being picked.
  const isSelecting = selection !== null;
  // The transcript's own Follow Mode pill. EPUB Read-Along carries its own, so
  // showing this one over the reader would put two of them on screen.
  const isResumePillVisible =
    !isBookSurface && !followEnabled && activeListIndex >= 0 && !isSelecting;
  const floatingBottomOffset = Math.max(insets.bottom, 10) + 80;

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ReadAlongHeader
        title={bookTitle}
        fontSize={fontSize}
        wordHighlightStyle={wordHighlightStyle}
        themeColors={themeColors}
        topInset={insets.top}
        onClose={() => router.back()}
        onOpenChapters={() => {
          if (!boundLibraryItemId) return;
          router.push({
            pathname: "/chapter-viewer",
            params: { libraryItemId: boundLibraryItemId },
          });
        }}
      />

      {showDifferentBookNotice ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 10,
            backgroundColor: themeColors.surface,
            borderBottomWidth: 1,
            borderBottomColor: themeColors.border,
          }}
        >
          <Text style={{ flex: 1, fontSize: 13, color: themeColors.textMuted }}>
            Now playing a different book
          </Text>
          {canSwitchToPlayingBook ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch to the playing book"
              onPress={handleSwitchBook}
              style={({ pressed }) => ({
                borderRadius: 999,
                borderCurve: "continuous",
                backgroundColor: themeColors.accent,
                paddingVertical: 6,
                paddingHorizontal: 12,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{ fontSize: 13, fontWeight: "600", color: themeColors.accentForeground }}
              >
                Switch
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Read-Along"
            onPress={() => router.back()}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderCurve: "continuous",
              backgroundColor: themeColors.bg,
              paddingVertical: 6,
              paddingHorizontal: 12,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: themeColors.textMuted }}>
              Close
            </Text>
          </Pressable>
        </View>
      ) : null}

      {canReadBook ? (
        <ReadAlongSurfacePicker
          surface={surface}
          onChange={setSurface}
          themeColors={themeColors}
        />
      ) : null}

      {isBookSurface ? (
        <EpubReadAlongSurface
          boundLibraryItemId={boundLibraryItemId}
          // Clears `ReadAlongControls`, which floats over both surfaces. This
          // route sits outside the tab navigator, so there is no tab bar or
          // mini-player to account for — only the reader's own footer.
          bottomInset={floatingBottomOffset}
        />
      ) : showTranscriptLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ActivityIndicator color={themeColors.accent} />
        </View>
      ) : !hasReaderContent ? (
        <ReadAlongEmptyState
          libraryItemId={boundLibraryItemId}
          status={snapshot?.status ?? "idle"}
          errorCode={snapshot?.errorCode ?? null}
          ingestOutcome={ingest.outcome}
          ingestErrorMessage={ingest.errorMessage}
          themeColors={themeColors}
          onResume={handleResumeTranscription}
          onRetry={handleRetryTranscription}
        />
      ) : (
        <FlashList
          // Remounted when the reader comes back from the Book surface. A
          // segment's tint is a Reanimated shared value initialised once per
          // component *instance*, and FlashList recycles instances — so a row
          // that was active when the list was torn down could come back wearing
          // a tint that no longer belongs to it, leaving two sentences lit.
          // Fresh instances cannot carry stale animation state.
          key={`transcript-${transcriptGeneration}`}
          ref={listRef}
          data={model.items}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          renderItem={renderItem}
          onScrollBeginDrag={handleScrollBeginDrag}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 8,
            paddingBottom: insets.bottom + 96,
          }}
        />
      )}

      {isResumePillVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume following the narration"
          onPress={resumeFollowing}
          style={({ pressed }) => ({
            position: "absolute",
            alignSelf: "center",
            bottom: floatingBottomOffset,
            borderRadius: 999,
            borderCurve: "continuous",
            backgroundColor: themeColors.accent,
            paddingVertical: 9,
            paddingHorizontal: 16,
            opacity: pressed ? 0.85 : 1,
            boxShadow: "0 10px 20px rgba(15, 23, 42, 0.22)",
          })}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: themeColors.accentForeground }}>
            Resume following
          </Text>
        </Pressable>
      ) : null}

      {isSelecting && selectionBounds ? (
        <ReadAlongSelectionBar
          segmentCount={selectionBounds.segmentCount}
          range={selectionRange}
          bottomOffset={floatingBottomOffset}
          themeColors={themeColors}
          onCancel={handleCancelSelection}
          onSave={handleSaveSelection}
        />
      ) : null}

      {boundLibraryItemId ? (
        <ReadAlongControls
          boundLibraryItemId={boundLibraryItemId}
          themeColors={themeColors}
          bottomInset={insets.bottom}
          isResumePillVisible={isResumePillVisible}
        />
      ) : null}
    </View>
  );
};

export default ReadAlongScreen;
