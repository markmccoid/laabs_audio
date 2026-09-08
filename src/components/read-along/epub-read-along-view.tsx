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
  getTimedAlignmentUnits,
  type AlignmentResourceRow,
  type AlignmentTimedUnitRow,
  type AlignmentUnitRow,
} from "@/data/sqlite/shadow-db-alignment";
import { useReadAlongPosition } from "@/read-along/use-read-along-position";
import { useThemeColors } from "@/theme/use-app-theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ReadiumView,
  type DecorationGroup,
  type Locator,
  type ReadiumViewRef,
} from "react-native-readium";

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
  const insets = useSafeAreaInsets();
  const readerRef = useRef<ReadiumViewRef>(null);

  const [timedUnits, setTimedUnits] = useState<AlignmentTimedUnitRow[]>([]);
  const [resources, setResources] = useState<AlignmentResourceRow[]>([]);
  const [isLoadingMap, setIsLoadingMap] = useState(true);

  const [activeUnit, setActiveUnit] = useState<AlignmentUnitRow | null>(null);
  const [renderedHref, setRenderedHref] = useState<string | null>(null);

  const [decorationGroups, setDecorationGroups] = useState<DecorationGroup[]>([]);

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
    return buildActiveDecorationGroups(matched ? activeUnit : null, target, themeColors.accent);
  }, [activeUnit, target, themeColors.accent]);

  useEffect(() => {
    setDecorationGroups(groups);
  }, [groups]);

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
    setDecorationGroups((current) =>
      current.length > 0 ? [...current] : [{ name: ACTIVE_DECORATION_GROUP, decorations: [] }],
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
        preferences={{ scroll: true }}
        decorations={decorationGroups}
        onLocationChange={handleLocationChange}
        onPublicationReady={handlePublicationReady}
        style={{ flex: 1 }}
      />
    </View>
  );
};
