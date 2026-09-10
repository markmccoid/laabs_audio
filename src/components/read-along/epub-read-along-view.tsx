/**
 * EPUB Read-Along — the publisher's own page, highlighted in time with the
 * narration (ADR-0039).
 *
 * The whole loop is four steps, and three of them are pure and tested in
 * `src/alignment/alignment-decorations.ts`:
 *
 *   1. `useReadAlongPosition` resolves the active *timed* unit, looking
 *      `ACTIVE_LEAD_MS` ahead so the decoration's ~0.4 s apply lands on time.
 *   2. `resolveReaderTarget` turns that into a spine href.
 *   3. `goTo` when the href changed.
 *   4. One decoration group, one decoration, re-sent on every move.
 *
 * Everything subtle here is a property of the binding rather than of the design:
 * decorations are never removed by omission (D21), `ready` can fire twice and a
 * remount silently drops what is painted, and swipes starting inside the reader
 * are swallowed by the WebView.
 */

import {
  ACTIVE_DECORATION_GROUP,
  armFollow,
  buildActiveDecorationGroups,
  classifyLocationChange,
  collapseArm,
  DEFAULT_ACTIVE_LEAD_MS,
  needsResourceTurn,
  resolveReaderTarget,
  toFollowLocator,
  toResourceLocator,
  type FollowArm,
  type GoToKind,
} from "@/alignment/alignment-decorations";
import {
  getAlignmentResources,
  getAlignmentUnit,
  getResourceUnits,
  getTimedAlignmentUnits,
  type AlignmentResourceRow,
  type AlignmentTimedUnitRow,
  type AlignmentUnitRow,
} from "@/data/sqlite/shadow-db-alignment";
import { resolveTapUnit } from "@/alignment/alignment-tap-point";
import { playbackStore, playerService } from "@/player";
import {
  buildReaderPreferences,
  toDecorationStyleType,
} from "@/read-along/epub-reading-preferences";
import { useReadAlongPosition } from "@/read-along/use-read-along-position";
import { useSettingsStore } from "@/store/settings-store";
import { useIsDarkTheme, useThemeColors } from "@/theme/use-app-theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ReadiumView,
  type DecorationGroup,
  type Locator,
  type ReadiumViewRef,
  type TapEvent,
} from "react-native-readium";

/** One instance, so the "no units yet" branch does not re-run every consumer. */
const NO_UNITS: AlignmentUnitRow[] = [];

export type EpubReadAlongViewProps = {
  boundLibraryItemId: string | null;
  /** Local `file://` URI of the EPUB, from `ensureEpubAsset`. */
  epubUri: string | null;
  /** Overrides the measured default when a device-calibrated lead exists. */
  leadMs?: number;
  /**
   * Space to keep clear at the bottom, for whatever chrome floats over this view
   * — the reader's own controls in the real route, or the tab bar and
   * mini-player in the dev harness.
   *
   * Measured on device: at `bottom: 16` with no inset the "Resume following"
   * pill landed entirely underneath the iOS 26 floating tab bar, and tapping
   * where it appeared switched tabs instead. A control the user cannot reach is
   * worse than no control, because the state it escapes from looks permanent.
   */
  bottomInset?: number;
};



export const EpubReadAlongView = ({
  boundLibraryItemId,
  epubUri,
  leadMs = DEFAULT_ACTIVE_LEAD_MS,
  bottomInset = 0,
}: EpubReadAlongViewProps) => {
  const themeColors = useThemeColors();
  const isDarkTheme = useIsDarkTheme();
  const insets = useSafeAreaInsets();
  const readerRef = useRef<ReadiumViewRef>(null);

  const fontScale = useSettingsStore((state) => state.readAlongEpubFontScale);
  const readerTheme = useSettingsStore((state) => state.readAlongEpubTheme);
  const readerFont = useSettingsStore((state) => state.readAlongEpubFont);
  const pageMargins = useSettingsStore((state) => state.readAlongEpubPageMargins);
  const lineHeight = useSettingsStore((state) => state.readAlongEpubLineHeight);
  const publisherStyles = useSettingsStore((state) => state.readAlongEpubPublisherStyles);
  const sentenceHighlightStyle = useSettingsStore(
    (state) => state.readAlongEpubSentenceHighlightStyle,
  );

  /**
   * Memoized because the native `preferences` setter is a `didSet`: an inline
   * object literal is a new value on every render, so Readium would re-submit
   * the whole preference set on every highlight move — several times a sentence,
   * for a value that changes only when the reader opens the `Aa` popover.
   */
  const readerPreferences = useMemo(
    () =>
      buildReaderPreferences(
        {
          fontScale,
          theme: readerTheme,
          font: readerFont,
          pageMargins,
          lineHeight,
          publisherStyles,
        },
        isDarkTheme,
      ),
    [fontScale, readerTheme, readerFont, pageMargins, lineHeight, publisherStyles, isDarkTheme],
  );

  const [timedUnits, setTimedUnits] = useState<AlignmentTimedUnitRow[]>([]);
  const [resources, setResources] = useState<AlignmentResourceRow[]>([]);
  const [isLoadingMap, setIsLoadingMap] = useState(true);

  const [activeUnit, setActiveUnit] = useState<AlignmentUnitRow | null>(null);
  const [renderedHref, setRenderedHref] = useState<string | null>(null);

  /**
   * What to hand Readium next — **only the groups that changed**.
   *
   * Native `updateDecorations` iterates exactly the groups present in this array
   * and leaves every other group painted and untouched (D21). That is not a
   * quirk to work around, it is the property the whole design rests on: the
   * one-decoration highlight re-applies in ~0.4 s while the ~61-decoration tap
   * window sits beside it costing nothing. Send both every time and the window's
   * ~1.5 s apply is paid once a sentence.
   */
  const [outgoingGroups, setOutgoingGroups] = useState<DecorationGroup[]>([]);
  /**
   * The group values Readium is believed to be holding, by name. Written after
   * a send rather than during one, so `queueGroups` can drop anything already
   * applied without a render of its own.
   */
  const appliedGroupsRef = useRef(new Map<string, DecorationGroup>());

  const queueGroups = useCallback((groups: DecorationGroup[]) => {
    setOutgoingGroups((current) => {
      const merged = new Map(current.map((group) => [group.name, group]));
      for (const group of groups) merged.set(group.name, group);
      // Merging with `current` rather than replacing it matters on a resource
      // turn, where the highlight moves and the window repaints in the same
      // commit — a plain overwrite would drop whichever ran first. Filtering
      // against what is already applied is what stops the array accumulating
      // into "re-send everything" one send later.
      const changed = [...merged.values()].filter(
        (group) => appliedGroupsRef.current.get(group.name) !== group,
      );
      // Nothing new: hand back the same array so React bails out of the render
      // instead of handing Readium a fresh identity holding what it already has.
      return changed.length > 0 ? changed : current;
    });
  }, []);

  useEffect(() => {
    for (const group of outgoingGroups) appliedGroupsRef.current.set(group.name, group);
  }, [outgoingGroups]);

  //~~ Tap-to-seek --------------------------------------------------------
  /**
   * The units, tagged with the resource they were loaded for.
   *
   * Kept as a pair rather than cleared on every turn: a resource turn and its
   * load are separated by a query, and a bare array would show the *previous*
   * chapter's units for that gap — long enough to paint a window of quotes that
   * are not on the page.
   */
  const [loadedResourceUnits, setLoadedResourceUnits] = useState<{
    resourceIndex: number;
    units: AlignmentUnitRow[];
  } | null>(null);
  /**
   * Read by the tap handler, which must see the units the tap was painted
   * against rather than whatever the last render closed over — a tap can land
   * during the repaint it triggered.
   */
  const resourceUnitsRef = useRef<AlignmentUnitRow[]>([]);
  /** One seek at a time; a double tap on two sentences would otherwise race. */
  const isSeekPendingRef = useRef(false);

  /**
   * Follow Mode, on the same contract as Transcript Read-Along: the view scrolls
   * itself to keep the narrated sentence in view, stops the moment the reader
   * scrolls by hand, and resumes only when asked.
   */
  const [isFollowing, setIsFollowing] = useState(true);
  const armRef = useRef<FollowArm>(null);
  /**
   * True once Readium has acknowledged a `goTo` of ours. Until then its own
   * initial location report is in flight and must not be read as the reader
   * taking over.
   */
  const hasAcknowledgedRef = useRef(false);

  const armSelfScroll = useCallback((href: string, kind: GoToKind) => {
    armRef.current = armFollow(href, Date.now(), kind);
  }, []);

  // Load the map. `getTimedAlignmentUnits` returns five numbers per unit and no
  // quote text, so a 4,700-unit book is a small array; quotes are fetched one at
  // a time as the highlight moves.
  useEffect(() => {
    if (!boundLibraryItemId) {
      setTimedUnits([]);
      setResources([]);
      setIsLoadingMap(false);
      return;
    }

    let cancelled = false;
    setIsLoadingMap(true);
    void Promise.all([
      getTimedAlignmentUnits(boundLibraryItemId),
      getAlignmentResources(boundLibraryItemId),
    ])
      .then(([units, spine]) => {
        if (cancelled) return;
        console.log(
          `[EpubReadAlong] map loaded book=${boundLibraryItemId} timedUnits=${units.length} resources=${spine.length}`,
        );
        setTimedUnits(units);
        setResources(spine);
        setIsLoadingMap(false);
      })
      .catch((error: unknown) => {
        // Same lesson as the ingest hook: a rejected read must not leave the
        // view spinning with nothing in the log.
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[EpubReadAlong] map load failed book=${boundLibraryItemId} ${message}`);
        setIsLoadingMap(false);
      });

    return () => {
      cancelled = true;
    };
  }, [boundLibraryItemId]);

  const { activeSegmentIndex } = useReadAlongPosition({
    boundLibraryItemId,
    segments: timedUnits,
    leadMs,
  });

  const target = useMemo(
    () => resolveReaderTarget(timedUnits, resources, activeSegmentIndex),
    [timedUnits, resources, activeSegmentIndex],
  );

  // Fetch the active unit's quote. One row per sentence, so this runs at
  // sentence rate rather than tick rate.
  useEffect(() => {
    if (!boundLibraryItemId || !target) {
      // An unaligned stretch of narration looks exactly like a stalled reader
      // from outside — nothing highlighted, nothing logged, audio still going.
      // Saying so is the difference between a diagnosis and a guess.
      if (boundLibraryItemId) console.log("[EpubReadAlong] no active unit — unaligned stretch");
      setActiveUnit(null);
      return;
    }

    let cancelled = false;
    void getAlignmentUnit(boundLibraryItemId, target.unitIndex).then((unit) => {
      if (!cancelled) setActiveUnit(unit);
    });

    return () => {
      cancelled = true;
    };
  }, [boundLibraryItemId, target?.unitIndex]);

  // Turn the page when the narration crosses into another spine document.
  //
  // Suspended following suppresses this too. A reader who scrolled back
  // deliberately was still being yanked into the next chapter at the boundary,
  // which is the one thing suspending Follow Mode is supposed to prevent.
  //
  // Gated on *acknowledgement*, not on `renderedHref`: Readium reports its own
  // cover page within a second of mount, so a `renderedHref !== null` guard
  // stranded the reader on the cover with turns suppressed and no way back but
  // the Resume pill. Until a `goTo` of ours has landed, the reader has chosen
  // nothing and there is no position to protect.
  useEffect(() => {
    if (!target || !needsResourceTurn(target, renderedHref)) return;
    if (!isFollowing && hasAcknowledgedRef.current) return;
    console.log(`[EpubReadAlong] resource turn -> ${target.href} unit=${target.unitIndex}`);
    armSelfScroll(target.href, "turn");
    readerRef.current?.goTo(toResourceLocator(target));
  }, [target, renderedHref, isFollowing, armSelfScroll]);

  // Paint. `activeUnit` lags `target` by one render while its quote loads, so
  // guard on the pair agreeing — painting a stale quote at a new href would
  // anchor the previous sentence into the current chapter.
  const groups = useMemo(() => {
    const matched = activeUnit && target && activeUnit.unitIndex === target.unitIndex;
    const styleType = toDecorationStyleType(sentenceHighlightStyle);
    // "None" still sends the group, empty. Dropping the group instead would
    // leave the last sentence lit for the rest of the book (D21).
    return buildActiveDecorationGroups(
      styleType && matched ? activeUnit : null,
      target,
      themeColors.accent,
      styleType ?? "highlight",
    );
  }, [activeUnit, target, themeColors.accent, sentenceHighlightStyle]);

  useEffect(() => {
    queueGroups(groups);
  }, [groups, queueGroups]);

  /**
   * Follow the narration *within* a resource.
   *
   * Readium will not scroll to a decoration on its own, so without this the lit
   * sentence leaves the screen within a minute and stays gone until the next
   * chapter — the highlight stays correct and stops being useful. The locator
   * carries the quote, which Readium resolves before any location, so this lands
   * on the sentence rather than near it.
   */
  useEffect(() => {
    if (!isFollowing || !activeUnit || !target) return;
    if (activeUnit.unitIndex !== target.unitIndex) return;
    // A resource turn already navigated; a second goTo would fight it.
    if (needsResourceTurn(target, renderedHref)) return;

    console.log(`[EpubReadAlong] follow -> unit=${target.unitIndex} ${target.href}`);
    armSelfScroll(target.href, "follow");
    readerRef.current?.goTo(toFollowLocator(activeUnit, target));
  }, [isFollowing, activeUnit, target, renderedHref, armSelfScroll]);

  /**
   * The rendered resource, as an index into the map. `renderedHref` is the only
   * thing Readium tells us about what is on screen, and it is the wrong shape
   * for every query.
   */
  const renderedResource = useMemo(
    () => resources.find((resource) => resource.href === renderedHref) ?? null,
    [resources, renderedHref],
  );

  // Every unit of the rendered resource, with quotes — what a tap is matched
  // against. One query per resource turn; the units are needed in full because a
  // tap can land anywhere in the document and must resolve without going back to
  // SQLite on the tap path.
  useEffect(() => {
    if (!boundLibraryItemId || !renderedResource) return;

    const { resourceIndex } = renderedResource;
    let cancelled = false;
    void getResourceUnits(boundLibraryItemId, resourceIndex)
      .then((units) => {
        if (cancelled) return;
        setLoadedResourceUnits({ resourceIndex, units });
      })
      .catch((error: unknown) => {
        // Tap-to-seek simply stops working if this fails, with the page looking
        // completely normal — so it has to say so.
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[EpubReadAlong] resource units failed resource=${renderedResource.resourceIndex} ${message}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [boundLibraryItemId, renderedResource]);

  const resourceUnits = useMemo(
    () =>
      loadedResourceUnits &&
      loadedResourceUnits.resourceIndex === renderedResource?.resourceIndex
        ? loadedResourceUnits.units
        : NO_UNITS,
    [loadedResourceUnits, renderedResource?.resourceIndex],
  );

  useEffect(() => {
    resourceUnitsRef.current = resourceUnits;
  }, [resourceUnits]);

  /**
   * A tap on the page: seek the narration to whatever was tapped.
   *
   * The binding resolves the tap inside the document with
   * `caretRangeFromPoint`, so this receives a character offset rather than a
   * point — see `alignment-tap-point.ts` for why that is the one measurement
   * comparable to a unit's progression.
   *
   * Resuming Follow Mode is deliberate. Tapping a sentence is the clearest
   * statement a reader can make about where they want to be, and leaving
   * following suspended would strand them there while the audio walked away.
   */
  const handleTap = useCallback(
    (event: TapEvent) => {
      if (isSeekPendingRef.current) return;

      const resolved = resolveTapUnit({
        units: resourceUnitsRef.current,
        charOffset: event.charOffset,
        totalChars: event.totalChars,
      });
      if (!resolved) {
        // Front matter, a caption, a footnote, an unaligned tail — text the map
        // never covered. Saying so beats a silent no-op that reads as a dead
        // tap, and beats a wild seek even more.
        console.log(
          `[EpubReadAlong] tap unresolved offset=${Math.round(event.charOffset)}/${Math.round(
            event.totalChars,
          )} "${event.text.slice(0, 40)}"`,
        );
        return;
      }

      const state = playbackStore.getState();
      // Read-Along binds to the playing book; a tap while another book is loaded
      // has nowhere to seek to.
      if (state.libraryItemId !== boundLibraryItemId || state.queue.length === 0) return;

      console.log(
        `[EpubReadAlong] tap seek -> unit=${resolved.unitIndex} at ${resolved.seekMs}ms (d=${resolved.distance.toFixed(4)})`,
      );
      isSeekPendingRef.current = true;
      const wasPlaying = state.playbackState === "playing";
      void (async () => {
        try {
          await playerService.seekTo(resolved.seekMs);
          // Seeking must not start playback that was paused — the reader tapped
          // to move, not to play.
          if (!wasPlaying && playbackStore.getState().playbackState === "playing") {
            await playerService.pause();
          }
          setIsFollowing(true);
        } finally {
          isSeekPendingRef.current = false;
        }
      })();
    },
    [boundLibraryItemId],
  );

  const handleLocationChange = useCallback((locator: Locator) => {
    // Carries `href` and `progression` and an empty `text` (E2), so this says
    // which document is on screen and nothing about what text is.
    setRenderedHref(locator.href);

    const nowMs = Date.now();
    const verdict = classifyLocationChange({
      arm: armRef.current,
      reportedHref: locator.href,
      nowMs,
      hasAcknowledged: hasAcknowledgedRef.current,
    });

    if (verdict === "self") {
      hasAcknowledgedRef.current = true;
      armRef.current = collapseArm(armRef.current, nowMs);
      return;
    }
    if (verdict === "ignore") return;

    console.log(`[EpubReadAlong] follow off — reader scrolled to ${locator.href}`);
    setIsFollowing(false);
  }, []);

  /**
   * `ready` has been observed firing twice, and a remount drops every painted
   * decoration without saying so. Re-applying whatever we currently hold is
   * correct whether or not that happens, and costs one apply behind the book
   * opening.
   */
  const handlePublicationReady = useCallback(() => {
    // A remount drops everything painted without saying so, which makes the
    // record of what is applied a lie. Clearing it is what lets the re-send
    // past `queueGroups`' "Readium already has this" filter — without that, the
    // recovery would be filtered out as a no-op and the page would come back
    // bare.
    const known = [...appliedGroupsRef.current.values()];
    appliedGroupsRef.current.clear();
    setOutgoingGroups(
      known.length > 0 ? known : [{ name: ACTIVE_DECORATION_GROUP, decorations: [] }],
    );
  }, []);

  if (!epubUri) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: themeColors.textMuted, textAlign: "center" }}>
          This book&apos;s EPUB is not on this device yet.
        </Text>
      </View>
    );
  }

  if (isLoadingMap) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {!isFollowing ? (
        // Same contract as Transcript Read-Along: manual scrolling suspends
        // following, and only an explicit request resumes it. Auto-resuming
        // would yank the page away from a reader who deliberately looked back.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume following"
          onPress={() => setIsFollowing(true)}
          style={{
            position: "absolute",
            bottom: 16 + bottomInset + insets.bottom,
            alignSelf: "center",
            zIndex: 10,
            paddingHorizontal: 16,
            paddingVertical: 9,
            borderRadius: 999,
            backgroundColor: themeColors.accent,
          }}
        >
          <Text style={{ color: themeColors.accentForeground, fontWeight: "600" }}>
            Resume following
          </Text>
        </Pressable>
      ) : null}

      <ReadiumView
        ref={readerRef}
        file={{ url: epubUri }}
        preferences={readerPreferences}
        decorations={outgoingGroups}
        onLocationChange={handleLocationChange}
        onPublicationReady={handlePublicationReady}
        onTap={handleTap}
        style={{ flex: 1 }}
      />
    </View>
  );
};
