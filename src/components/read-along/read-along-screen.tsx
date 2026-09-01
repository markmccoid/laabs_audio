import {
  getBookTranscriptStatus,
  getSegmentTextRows,
  getTranscriptFrontierMs,
  type BookTranscriptSection,
  type TranscriptSegmentTextRow,
} from "@/data/sqlite/shadow-db-transcripts";
import { playbackStore, playerService, usePlaybackStore } from "@/player";
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
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import { ReadAlongControls } from "./read-along-controls";
import { ReadAlongEmptyState } from "./read-along-empty-state";
import { ReadAlongHeader } from "./read-along-header";
import { ReadAlongPendingBlock } from "./read-along-pending-block";
import { ReadAlongSegmentItem } from "./read-along-segment-item";

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
 *   `read-along-segment-item.tsx` — so a word tick re-renders exactly one row.
 *
 * ## When there is nothing to read
 *
 * Everything that is not the reader — no transcript yet, a transcription still
 * running, an interrupted or failed one — lives in `ReadAlongEmptyState`
 * (Phase 4). This screen only decides *whether* the reader has content; that
 * component decides what the alternative looks like.
 */

/** Accent opacity for the active segment's tint (plan: ~12-15%). */
const ACTIVE_TINT_ALPHA = 0.13;

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
};

const ReadAlongScreen = ({ libraryItemId }: ReadAlongScreenProps) => {
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
  }, [boundLibraryItemId, completedTracks, runtimeStatus, activePhase, loadSnapshot]);

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

  const { followEnabled, resumeFollowing, handleScrollBeginDrag } = useFollowMode({
    listRef,
    activeListIndex,
  });

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

  //~~ Tap to seek --------------------------------------------------------
  const isSeekPendingRef = useRef(false);
  const handlePressSegment = useCallback(
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
  // (see the memoization contract in `read-along-segment-item.tsx`).
  const segmentPalette = useMemo(
    () => ({
      text: themeColors.text,
      activeTint: withAlpha(themeColors.accent, ACTIVE_TINT_ALPHA),
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
          fontSize={fontSize}
          palette={segmentPalette}
          words={isActive ? activeSegmentWords : null}
          activeWordIndex={activeWordIndex}
          onPress={handlePressSegment}
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
      fontSize,
      segmentPalette,
      activeSegmentWords,
      activeWordIndex,
      handlePressSegment,
    ],
  );

  const bookTitle = snapshot?.bookTitle ?? "Read Along";
  const hasReaderContent = model.items.length > 0;

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

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ActivityIndicator color={themeColors.accent} />
        </View>
      ) : !hasReaderContent ? (
        <ReadAlongEmptyState
          libraryItemId={boundLibraryItemId}
          status={snapshot?.status ?? "idle"}
          errorCode={snapshot?.errorCode ?? null}
          themeColors={themeColors}
          onResume={handleResumeTranscription}
          onRetry={handleRetryTranscription}
        />
      ) : (
        <FlashList
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

      {!followEnabled && activeListIndex >= 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume following the narration"
          onPress={resumeFollowing}
          style={({ pressed }) => ({
            position: "absolute",
            alignSelf: "center",
            bottom: Math.max(insets.bottom, 10) + 80,
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

      {boundLibraryItemId ? (
        <ReadAlongControls
          boundLibraryItemId={boundLibraryItemId}
          themeColors={themeColors}
          bottomInset={insets.bottom}
        />
      ) : null}
    </View>
  );
};

export default ReadAlongScreen;
