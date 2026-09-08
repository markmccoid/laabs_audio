/**
 * Spike harness — Readium quote-anchor validation.
 *
 * Runs the experiments from `docs/spikes/readium-anchor-spike.md`: can a Locator
 * carrying nothing but `{ href, type, text }` anchor a highlight, what does an
 * href actually look like, how faithful must the quote text be, and where does
 * decoration performance fall over. Everything anchors off a *harvested* anchor —
 * a locator Readium built for itself when you selected text — so a failure is a
 * failure of the format rather than of hand-typed quote text.
 *
 * Dev-only.
 *
 * **Why this still exists.** The original trigger for deleting it — "once the
 * Alignment Map format is frozen" — has passed: E1, E2, E5/E8 and E6 are
 * answered, and E3/E4 were settled offline against whole books by the Mac
 * repo's anchor lab. It is kept for two jobs the shipped reader cannot do:
 *
 * 1. **Verifying that decoration taps reach JS.** `onDecorationActivated` *is*
 *    implemented on iOS (unlike `onSelectionChange`), and it is the route to
 *    tap-to-seek in EPUB Read-Along. **E9** exercises it: the handler is wired
 *    for every group, so taps on E5's and E8's decorations are recorded too.
 * 2. **Re-measuring the decoration cost on other hardware.**
 *    `DEFAULT_ACTIVE_LEAD_MS` is an iPhone 16 number, and a lead tuned on fast
 *    hardware fires late on slow. Stopwatch only — the frame counter here is
 *    provably blind to this cost (D20).
 *
 * **Delete this screen, `src/spikes/readium-anchor`, and the Developer settings
 * group once tap-to-seek is verified.** See `docs/epub-read-along.md`.
 */

import {
  ActionButton,
  CaseRow,
  Mono,
  Section,
  Stat,
  VerdictButtons,
} from "@/components/settings/readium-spike/spike-ui";
import {
  readEpubManifest,
  type EpubManifestSummary,
} from "@/spikes/readium-anchor/epub-manifest";
import {
  groupHitsByHref,
  hitFromSearchResult,
  pickBulkResource,
} from "@/spikes/readium-anchor/bulk-quotes";
import { countFrames, framesPerSecond, nextFrame } from "@/spikes/readium-anchor/frame-counter";
import { buildHrefVariants, describeHrefForm } from "@/spikes/readium-anchor/href-variants";
import { isPerturbationInert, PERTURBATIONS } from "@/spikes/readium-anchor/perturbations";
import { buildResultsReport, summariseProgression } from "@/spikes/readium-anchor/results-report";
import {
  buildActiveGroup,
  buildClearedWindowGroups,
  buildWindowGroup,
  E8_REQUIRED_QUOTES,
  E8_WINDOW_SIZE,
  hasEnoughQuotesForWindow,
} from "@/spikes/readium-anchor/window-groups";
import {
  buildClearedTapTargetGroup,
  buildTapTargetGroup,
  describeTap,
  distinctTapTargets,
  E9_INVISIBLE_TINT,
  E9_TAP_COUNT,
  E9_TAP_TINT,
  hasEnoughQuotesForTapTargets,
  parseTapTargetIndex,
  type TapSample,
} from "@/spikes/readium-anchor/tap-targets";
import {
  deleteSpikeBook,
  importSpikeBook,
  listSpikeBooks,
  resolveSpikeBookUri,
  type SpikeBook,
} from "@/spikes/readium-anchor/spike-book";
import {
  buildBulkDecorations,
  buildContextDecoration,
  buildE1Decoration,
  buildHrefDecoration,
  buildPerturbedDecoration,
  E1_VARIANTS,
  TINTS,
  XHTML_TYPE,
} from "@/spikes/readium-anchor/spike-decorations";
import {
  clearSpikeState,
  EMPTY_SPIKE_STATE,
  loadSpikeState,
  saveSpikeState,
  type SpikeState,
} from "@/spikes/readium-anchor/spike-storage";
import type {
  CaseVerdict,
  HarvestedAnchor,
  LocationSample,
  LogEntry,
  SpikeQuote,
} from "@/spikes/readium-anchor/types";
import { useThemeColors } from "@/theme/use-app-theme";
import * as Device from "expo-device";
import { SymbolView } from "expo-symbols";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ReadiumView,
  type DecorationActivatedEvent,
  type DecorationGroup,
  type Locator,
  type PublicationReadyEvent,
  type ReadiumViewRef,
  type SearchResult,
  type SelectionActionEvent,
  type SelectionEvent,
} from "react-native-readium";

/** Kept in sync by hand with package.json — it only lands in the report header. */
const READIUM_VERSION = "5.1.1";

const FRAME_WINDOW_MS = 2000;
const BULK_COUNTS = [1, 3, 10, 50, 200];
/** Search is book-wide; keep paging until we can see which resource is actually large. */
const BULK_SEARCH_CAP = 5000;
const CONTEXT_CASES: { id: string; label: string; chars: number | null }[] = [
  { id: "4-none", label: "No before/after", chars: null },
  { id: "4-8", label: "~8 chars of context", chars: 8 },
  { id: "4-32", label: "~32 chars of context", chars: 32 },
];
const GOTO_PROGRESSIONS = [0, 0.25, 0.5, 0.9];
const MAX_LOG_ENTRIES = 200;

const SPIKE_GROUP = "spike";

/**
 * The only way a selection reaches JS on iOS. `onSelectionChange` is declared by
 * the binding but never invoked on that platform (only the Android
 * HybridReadiumView calls it), so harvesting goes through a custom editing
 * action instead. Supplying any custom action replaces the system edit menu
 * wholesale — Copy and friends disappear — which is a fair trade for a spike.
 *
 * Baked into the navigator at init, so this has to be a stable reference that is
 * present before the book loads.
 */
const SELECTION_ACTIONS = [{ id: "harvest", label: "Keep as spike anchor" }];

const truncate = (value: string, length = 90) =>
  value.length <= length ? value : `${value.slice(0, length)}…`;

const formatTime = (at: number) => new Date(at).toLocaleTimeString();

const progressionText = (value: number | undefined) =>
  typeof value === "number" ? value.toFixed(4) : "—";

export const SettingsReadiumSpikeScreen = () => {
  const themeColors = useThemeColors();
  // The tab bar floats over this screen, so the last control in the scroll view
  // is unreachable without paying for it here. On iOS 26 the bottom safe-area
  // inset already covers the tab bar.
  const insets = useSafeAreaInsets();
  const readerRef = useRef<ReadiumViewRef>(null);

  const [state, setState] = useState<SpikeState>(() => loadSpikeState());
  const [isFullReader, setIsFullReader] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const [publication, setPublication] = useState<PublicationReadyEvent | null>(null);
  const [currentLocator, setCurrentLocator] = useState<Locator | null>(null);
  const [lastSelection, setLastSelection] = useState<SelectionEvent | null>(null);
  const [decorationGroups, setDecorationGroups] = useState<DecorationGroup[]>([]);
  const [activeCase, setActiveCase] = useState<string>("none");
  const [log, setLog] = useState<LogEntry[]>([]);

  const [epubManifest, setEpubManifest] = useState<EpubManifestSummary | null>(null);
  const [availableBooks, setAvailableBooks] = useState<SpikeBook[]>([]);
  const [harvestQuery, setHarvestQuery] = useState("");
  const [harvestResults, setHarvestResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("the");
  const [bulkQuotes, setBulkQuotes] = useState<SpikeQuote[]>([]);
  const [bulkHref, setBulkHref] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState<"visible" | "largest" | null>(null);
  /**
   * Every decoration activation this session, newest first — E9. Not persisted:
   * a tap count is only meaningful against the decorations currently painted,
   * and a count restored from MMKV would read as a pass on a run that never
   * happened.
   */
  const [tapSamples, setTapSamples] = useState<TapSample[]>([]);

  const [isSamplingLocations, setIsSamplingLocations] = useState(false);
  const [locationSamples, setLocationSamples] = useState<LocationSample[]>([]);
  /** Set just before a `goTo`, so the next location change can be attributed to it. */
  const pendingGoToRef = useRef<{ label: string } | null>(null);
  /**
   * Every href variant navigates to the same place, so after the first one the
   * reader is already there and the rest report nothing. Alternating the target
   * guarantees each tap is a real move. The chosen g is named in the log line, so
   * nothing about this is hidden from the reading.
   */
  const hrefGoToTargetRef = useRef(0.25);
  /**
   * E8's active slot. Re-applying the same quote is a no-op the eye cannot
   * distinguish from a slow apply, so every press moves the highlight.
   */
  const windowActiveSlotRef = useRef(0);
  /**
   * A goTo that lands where the reader already is reports no location change, so
   * the attribution above would sit armed and pin itself to whatever the reader
   * did next — recording a landing that never happened. This retires it.
   */
  const goToTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSamplingRef = useRef(false);

  useEffect(
    () => () => {
      if (goToTimeoutRef.current) clearTimeout(goToTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    saveSpikeState(state);
  }, [state]);

  useEffect(() => {
    isSamplingRef.current = isSamplingLocations;
  }, [isSamplingLocations]);

  /**
   * Books already sitting in the spike directory. Listing them means a book only
   * has to go through the picker once — and that one can be dropped into the app
   * container directly, which is how this gets driven on a simulator.
   */
  const refreshBooks = useCallback(async () => {
    try {
      setAvailableBooks(await listSpikeBooks());
    } catch {
      setAvailableBooks([]);
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;
    listSpikeBooks()
      .then((books) => {
        if (isCurrent) setAvailableBooks(books);
      })
      .catch(() => {
        if (isCurrent) setAvailableBooks([]);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  const pushLog = useCallback((tag: string, message: string, detail?: string) => {
    setLog((entries) =>
      [
        {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          at: Date.now(),
          tag,
          message,
          detail,
        },
        ...entries,
      ].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  /**
   * Arms the next location change to be reported as the result of this goTo, and
   * retires the claim if none arrives — a goTo to where the reader already is, or
   * one Readium rejected outright, reports nothing at all.
   */
  const armGoTo = useCallback(
    (label: string) => {
      pendingGoToRef.current = { label };
      if (goToTimeoutRef.current) clearTimeout(goToTimeoutRef.current);
      goToTimeoutRef.current = setTimeout(() => {
        if (!pendingGoToRef.current) return;
        pendingGoToRef.current = null;
        pushLog(
          "goTo",
          `${label} → no location change reported`,
          "Either the reader was already there, or Readium rejected the locator.",
        );
      }, 2500);
    },
    [pushLog],
  );

  const bookUri = useMemo(
    () => resolveSpikeBookUri(state.bookRelativePath),
    [state.bookRelativePath],
  );

  const activeAnchor = useMemo<HarvestedAnchor | null>(() => {
    if (state.anchors.length === 0) return null;
    return state.anchors.find((anchor) => anchor.id === state.activeAnchorId) ?? state.anchors[0];
  }, [state.anchors, state.activeAnchorId]);

  const decorationHref = activeAnchor?.href ?? currentLocator?.href ?? null;

  const hrefVariants = useMemo(
    () => (decorationHref ? buildHrefVariants(decorationHref) : []),
    [decorationHref],
  );

  const setVerdict = useCallback((caseId: string, verdict: CaseVerdict | undefined) => {
    setState((current) => {
      const verdicts = { ...current.verdicts };
      if (verdict === undefined) {
        delete verdicts[caseId];
      } else {
        verdicts[caseId] = verdict;
      }
      return { ...current, verdicts };
    });
  }, []);

  const applyDecorations = useCallback(
    (label: string, decorations: DecorationGroup["decorations"], detail?: string) => {
      setDecorationGroups([{ name: SPIKE_GROUP, decorations }]);
      setActiveCase(label);
      pushLog("decorate", `${label} — ${decorations.length} decoration(s)`, detail);
    },
    [pushLog],
  );

  /**
   * Clearing sends the group with an empty decoration list rather than dropping
   * the group. `updateDecorations` on the native side only iterates the groups
   * present in the incoming array, so a group that simply disappears is never
   * un-applied and its highlight stays painted — which would silently turn the
   * next experiment into a false pass.
   */
  const clearDecorations = useCallback(() => {
    setDecorationGroups([{ name: SPIKE_GROUP, decorations: [] }]);
    setActiveCase("none");
    pushLog("decorate", "cleared");
  }, [pushLog]);

  // ── Reader events ─────────────────────────────────────────────────────────

  const handlePublicationReady = useCallback(
    (event: PublicationReadyEvent) => {
      setPublication(event);
      pushLog(
        "ready",
        `${event.metadata.title} — ${event.tableOfContents.length} TOC entries, ${event.positions.length} positions`,
        [
          `TOC[0..3]: ${event.tableOfContents
            .slice(0, 4)
            .map((link) => link.href)
            .join(" | ")}`,
          `POSITIONS[0..3]: ${event.positions
            .slice(0, 4)
            .map((locator) => `${locator.href}@${progressionText(locator.locations?.progression)}`)
            .join(" | ")}`,
        ].join("\n"),
      );
    },
    [pushLog],
  );

  const handleLocationChange = useCallback(
    (locator: Locator) => {
      setCurrentLocator(locator);

      const pendingGoTo = pendingGoToRef.current;
      if (pendingGoTo) {
        pendingGoToRef.current = null;
        if (goToTimeoutRef.current) {
          clearTimeout(goToTimeoutRef.current);
          goToTimeoutRef.current = null;
        }
        pushLog(
          "goTo",
          `${pendingGoTo.label} → landed g=${progressionText(locator.locations?.progression)}`,
          `href ${locator.href}\ntotalProgression ${progressionText(
            locator.locations?.totalProgression,
          )}\ntext "${truncate(locator.text?.highlight ?? "", 60)}"`,
        );
      }

      if (isSamplingRef.current) {
        setLocationSamples((samples) => [
          ...samples,
          {
            at: Date.now(),
            href: locator.href,
            progression: locator.locations?.progression,
            totalProgression: locator.locations?.totalProgression,
            position: locator.locations?.position,
          },
        ]);
      }
    },
    [pushLog],
  );

  const handleSelectionChange = useCallback(
    (event: SelectionEvent) => {
      setLastSelection(event);
      pushLog(
        "selection",
        truncate(event.selectedText ?? "(no text)", 70),
        JSON.stringify(event.locator ?? {}, null, 2),
      );
    },
    [pushLog],
  );

  // ── Book management ───────────────────────────────────────────────────────

  const selectBook = useCallback((book: SpikeBook) => {
    setState((current) => ({
      ...current,
      bookRelativePath: book.relativePath,
      bookLabel: book.fileName,
    }));
    setPublication(null);
    setCurrentLocator(null);
    setDecorationGroups([]);
    setBulkQuotes([]);
    setBulkHref(null);
    setBulkReason(null);
    setEpubManifest(null);
    setActiveCase("none");
  }, []);

  const handleImport = useCallback(async () => {
    try {
      setIsImporting(true);
      const book = await importSpikeBook();
      if (!book) return;
      selectBook(book);
      await refreshBooks();
      pushLog("book", `imported ${book.fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import the EPUB.";
      Alert.alert("Import failed", message);
      pushLog("book", `import failed — ${message}`);
    } finally {
      setIsImporting(false);
    }
  }, [pushLog, refreshBooks, selectBook]);

  const handleRemoveBook = useCallback(async () => {
    if (!state.bookRelativePath) return;
    await deleteSpikeBook(state.bookRelativePath);
    await refreshBooks();
    pushLog("book", `removed ${state.bookLabel ?? state.bookRelativePath}`);
    setState((current) => ({ ...current, bookRelativePath: null, bookLabel: null }));
    setPublication(null);
    setCurrentLocator(null);
    setDecorationGroups([]);
    setBulkQuotes([]);
    setBulkHref(null);
    setBulkReason(null);
  }, [pushLog, refreshBooks, state.bookLabel, state.bookRelativePath]);

  // ── Harvesting ────────────────────────────────────────────────────────────

  /**
   * Every anchor comes from a locator Readium built for itself — a selection, or
   * a search hit. Nothing here is hand-typed, which is what makes a failure a
   * failure of the format rather than of the harness.
   */
  const harvestLocator = useCallback(
    (locator: Locator, selectedText: string, source: string) => {
      const anchor: HarvestedAnchor = {
        id: `anchor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        capturedAt: Date.now(),
        selectedText: selectedText || locator.text?.highlight || "",
        href: locator.href,
        type: locator.type || XHTML_TYPE,
        progression: locator.locations?.progression,
        totalProgression: locator.locations?.totalProgression,
        position: locator.locations?.position,
        text: {
          b: locator.text?.before ?? "",
          h: locator.text?.highlight ?? selectedText ?? "",
          a: locator.text?.after ?? "",
        },
        rawLocator: locator,
      };

      setState((current) => ({
        ...current,
        anchors: [anchor, ...current.anchors].slice(0, 20),
        activeAnchorId: anchor.id,
      }));
      pushLog(
        "harvest",
        `${source} — kept "${truncate(anchor.text.h, 60)}"`,
        `href ${anchor.href}\n${JSON.stringify(locator, null, 2)}`,
      );
    },
    [pushLog],
  );

  /**
   * E9. Wired unconditionally rather than only while E9's own group is painted,
   * because a tap that fires for one group and not another is the most useful
   * failure available here — and it is invisible if the handler only listens to
   * the group under test.
   */
  const handleDecorationActivated = useCallback(
    (event: DecorationActivatedEvent) => {
      const sample: TapSample = {
        at: Date.now(),
        id: event.decoration.id,
        group: event.group,
        index: parseTapTargetIndex(event.decoration.id),
        point: event.point ? { x: event.point.x, y: event.point.y } : null,
      };
      setTapSamples((samples) => [sample, ...samples].slice(0, 50));
      pushLog(
        "tap",
        `decoration activated — ${describeTap(sample)}`,
        [
          `id ${sample.id}`,
          `href ${event.decoration.locator.href}`,
          `quote "${truncate(event.decoration.locator.text?.highlight ?? "", 60)}"`,
          sample.point ? `point ${sample.point.x.toFixed(0)},${sample.point.y.toFixed(0)}` : "no point",
        ].join("\n"),
      );
    },
    [pushLog],
  );

  /** iOS: the edit-menu item is the only selection signal the binding delivers. */
  const handleSelectionAction = useCallback(
    (event: SelectionActionEvent) => {
      setLastSelection({ locator: event.locator, selectedText: event.selectedText });
      harvestLocator(event.locator, event.selectedText, "edit menu");
    },
    [harvestLocator],
  );

  const harvestSelection = useCallback(() => {
    const locator = lastSelection?.locator;
    if (!locator) {
      Alert.alert("Nothing selected", "Select a sentence in the reader first.");
      return;
    }
    harvestLocator(locator, lastSelection?.selectedText ?? "", "selection");
  }, [harvestLocator, lastSelection]);

  const findHarvestCandidates = useCallback(async () => {
    const reader = readerRef.current;
    if (!reader || !harvestQuery.trim()) return;

    try {
      setIsBusy(true);
      const page = await reader.search(harvestQuery.trim());
      if (!page.isSupported) {
        Alert.alert("Search unsupported", "This publication exposes no search service.");
        return;
      }
      setHarvestResults(page.results.slice(0, 10));
      pushLog("harvest", `search "${harvestQuery.trim()}" → ${page.results.length} matches`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed.";
      pushLog("harvest", `search failed — ${message}`);
      Alert.alert("Search failed", message);
    } finally {
      setIsBusy(false);
    }
  }, [harvestQuery, pushLog]);

  /**
   * Jumps to an anchor using the locator Readium itself produced. Without this, a
   * decoration applied off-screen reads as "no highlight" and gets recorded as a
   * failure — the reader does not scroll to a decoration on its own.
   */
  const showAnchor = useCallback(
    (anchor: HarvestedAnchor) => {
      readerRef.current?.goTo(anchor.rawLocator as Locator);
      pushLog("goTo", `scrolled to "${truncate(anchor.text.h, 40)}"`);
    },
    [pushLog],
  );

  const deleteAnchor = useCallback((anchorId: string) => {
    setState((current) => {
      const anchors = current.anchors.filter((anchor) => anchor.id !== anchorId);
      return {
        ...current,
        anchors,
        activeAnchorId: current.activeAnchorId === anchorId ? (anchors[0]?.id ?? null) : current.activeAnchorId,
      };
    });
  }, []);

  // ── E1 ────────────────────────────────────────────────────────────────────

  const runE1 = useCallback(
    (variantId: (typeof E1_VARIANTS)[number]["id"], styleType: "highlight" | "underline") => {
      if (!activeAnchor) return;
      const decoration = buildE1Decoration(activeAnchor, variantId, {
        type: styleType,
        tint: styleType === "underline" ? TINTS.variant : TINTS.control,
      });
      applyDecorations(
        `E1 ${variantId}${styleType === "underline" ? " (underline)" : ""}`,
        [decoration],
        JSON.stringify(decoration.locator, null, 2),
      );
    },
    [activeAnchor, applyDecorations],
  );

  // ── E2 ────────────────────────────────────────────────────────────────────

  const runHrefDecoration = useCallback(
    (href: string) => {
      if (!activeAnchor) return;
      applyDecorations(`E2 href ${href}`, [buildHrefDecoration(activeAnchor, href)]);
    },
    [activeAnchor, applyDecorations],
  );

  const runHrefGoTo = useCallback(
    (href: string) => {
      const progression = hrefGoToTargetRef.current;
      hrefGoToTargetRef.current = progression === 0.25 ? 0.75 : 0.25;

      armGoTo(`href "${href}" @ g=${progression.toFixed(2)}`);
      readerRef.current?.goTo({
        href,
        type: activeAnchor?.type || XHTML_TYPE,
        locations: { progression },
      });
    },
    [activeAnchor?.type, armGoTo],
  );

  const inspectEpub = useCallback(async () => {
    if (!bookUri) return;

    try {
      setIsBusy(true);
      const summary = await readEpubManifest(bookUri);
      setEpubManifest(summary);
      pushLog(
        "epub",
        `OPF at ${summary.opfPath} — ${summary.spineHrefs.length} spine items`,
        [
          `manifest href[0..2]: ${summary.manifestHrefs.slice(0, 3).join(" | ")}`,
          `resolved[0..2]:      ${summary.resolvedHrefs.slice(0, 3).join(" | ")}`,
          `zip path[0..2]:      ${summary.zipEntryPaths.slice(0, 3).join(" | ")}`,
        ].join("\n"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the EPUB.";
      pushLog("epub", `failed — ${message}`);
      Alert.alert("EPUB read failed", message);
    } finally {
      setIsBusy(false);
    }
  }, [bookUri, pushLog]);

  // ── E3 ────────────────────────────────────────────────────────────────────

  const runPerturbation = useCallback(
    (caseId: string, perturbedHighlight: string) => {
      if (!activeAnchor) return;
      applyDecorations(
        `E3 ${caseId}`,
        [buildPerturbedDecoration(activeAnchor, caseId, perturbedHighlight)],
        `highlight: "${perturbedHighlight}"`,
      );
    },
    [activeAnchor, applyDecorations],
  );

  // ── E4 ────────────────────────────────────────────────────────────────────

  const runContextCase = useCallback(
    (caseId: string, chars: number | null) => {
      if (!activeAnchor) return;
      const decoration = buildContextDecoration(activeAnchor, caseId, chars);
      applyDecorations(
        `E4 ${caseId}`,
        [decoration],
        JSON.stringify(decoration.locator.text, null, 2),
      );
    },
    [activeAnchor, applyDecorations],
  );

  // ── E5 ────────────────────────────────────────────────────────────────────

  /**
   * Search is book-wide and capped at `BULK_SEARCH_CAP`, and the cap fills in
   * **document order** — so a common query exhausts it long before reaching the
   * chapter on screen, and `pickBulkResource` then silently falls back to
   * "largest resource".
   *
   * Seen on a real book: the default query `the` reported 3,278 quotes in
   * chapter002 while the reader was sitting in chapter007, and every experiment
   * downstream would have decorated a chapter nobody could see. The log line
   * names the resource and says which rule chose it — **read it**, and if it says
   * "largest resource" when you wanted the visible one, narrow the query until it
   * says "chapter on screen" instead.
   */
  const collectBulkQuotes = useCallback(async () => {
    const reader = readerRef.current;
    if (!reader) return;

    try {
      setIsBusy(true);
      const firstPage = await reader.search(searchQuery);

      if (!firstPage.isSupported) {
        pushLog("search", "publication has no search service — cannot build bulk anchors");
        Alert.alert("Search unsupported", "This publication exposes no search service.");
        return;
      }

      let results = firstPage.results;
      let hasMore = firstPage.hasMore;
      while (hasMore && results.length < BULK_SEARCH_CAP) {
        const nextPage = await reader.loadMoreSearchResults();
        results = [...results, ...nextPage.results];
        hasMore = nextPage.hasMore;
      }

      const hits = results
        .map((result) => hitFromSearchResult(result))
        .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
      const preferredHref = currentLocator?.href ?? null;
      const picked = pickBulkResource(groupHitsByHref(hits), preferredHref);

      if (!picked) {
        setBulkQuotes([]);
        setBulkHref(null);
        setBulkReason(null);
        pushLog("search", `"${searchQuery}" → ${results.length} matches, none usable`);
        Alert.alert("No usable quotes", "Search returned hits but none had highlight text.");
        return;
      }

      setBulkQuotes(picked.quotes);
      setBulkHref(picked.href);
      setBulkReason(picked.reason);
      pushLog(
        "search",
        `"${searchQuery}" → ${results.length} matches, ${picked.quotes.length} usable in ${picked.href}`,
        picked.reason === "visible"
          ? "scoped to the chapter on screen"
          : preferredHref
            ? `${preferredHref} had no hits — using the largest resource instead`
            : "reader had no location — using the largest resource",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed.";
      pushLog("search", `failed — ${message}`);
      Alert.alert("Search failed", message);
    } finally {
      setIsBusy(false);
    }
  }, [currentLocator?.href, pushLog, searchQuery]);

  const runFrameSample = useCallback(
    async (count: number, label: string) => {
      if (count > 0 && (!bulkHref || bulkQuotes.length === 0)) {
        Alert.alert(
          "Collect first",
          "N decorations need a chapter to apply to. Tap Collect, then the N buttons.",
        );
        return;
      }

      try {
        setIsBusy(true);
        const decorations =
          count === 0 || !bulkHref ? [] : buildBulkDecorations(bulkHref, bulkQuotes, count);
        // Always send the group — see clearDecorations. A baseline measured with
        // the previous run's highlights still on screen is not a baseline.
        setDecorationGroups([{ name: SPIKE_GROUP, decorations }]);
        setActiveCase(`E5 ${label}`);

        // Two frames: one to flush the prop to native, one to let the native
        // navigator start the work we are trying to measure.
        await nextFrame();
        await nextFrame();

        const frames = await countFrames(FRAME_WINDOW_MS);
        const sample = {
          n: decorations.length,
          frames,
          windowMs: FRAME_WINDOW_MS,
          label,
        };
        setState((current) => ({ ...current, frameSamples: [...current.frameSamples, sample] }));
        pushLog(
          "frames",
          `${label}: ${frames} frames / ${(FRAME_WINDOW_MS / 1000).toFixed(1)}s (${framesPerSecond(
            frames,
            FRAME_WINDOW_MS,
          ).toFixed(1)} fps) with ${decorations.length} decorations`,
        );
      } finally {
        setIsBusy(false);
      }
    },
    [bulkHref, bulkQuotes, pushLog],
  );

  // ── E8 — Decoration Window (D20's open question) ───────────────────────────

  /**
   * True only when E8 can actually run. The buttons below share this exact
   * predicate: an enabled button that refuses to do anything is how a spike
   * manufactures a false "not run".
   */
  const canRunWindowCase = Boolean(bulkHref) && hasEnoughQuotesForWindow(bulkQuotes);

  /**
   * Belt and braces behind `canRunWindowCase`. It logs rather than alerting,
   * because the UI already prevents this and the status line already says why —
   * an alert here would be dead code pretending to be a safeguard.
   */
  const requireWindowQuotes = useCallback(() => {
    if (!bulkHref || !hasEnoughQuotesForWindow(bulkQuotes)) {
      pushLog(
        "decorate",
        `E8 skipped — needs ${E8_REQUIRED_QUOTES} quotes in one chapter, have ${bulkQuotes.length}`,
      );
      return null;
    }
    return bulkHref;
  }, [bulkHref, bulkQuotes, pushLog]);

  /**
   * The wide group, sent once. Time this too: it is the cost a page turn would
   * pay in the two-group architecture.
   */
  const paintWindowGroup = useCallback(() => {
    const href = requireWindowQuotes();
    if (!href) return;
    setDecorationGroups([buildWindowGroup(href, bulkQuotes)]);
    setActiveCase(`E8 window (${E8_WINDOW_SIZE})`);
    pushLog(
      "decorate",
      `E8 window — ${E8_WINDOW_SIZE} decoration(s) in one group`,
      "Stopwatch: apply → all highlights visible.",
    );
  }, [bulkQuotes, pushLog, requireWindowQuotes]);

  /**
   * The measurement. Sends **only** the active group — the window group is
   * deliberately absent from the array, which native reads as "leave it alone".
   * Sending both would re-apply 21 decorations and measure nothing.
   */
  const moveActiveUnit = useCallback(() => {
    const href = requireWindowQuotes();
    if (!href) return;
    const slot = windowActiveSlotRef.current;
    windowActiveSlotRef.current = slot + 1;
    setDecorationGroups([buildActiveGroup(href, bulkQuotes, slot)]);
    setActiveCase("E8 active (1)");
    pushLog(
      "decorate",
      `E8 active — 1 decoration, slot ${slot % 2}, window group not re-sent`,
      "Stopwatch: apply → the amber highlight moves. Watch the purple window: it must stay put and must not repaint.",
    );
  }, [bulkQuotes, pushLog, requireWindowQuotes]);

  const clearWindowGroups = useCallback(() => {
    setDecorationGroups(buildClearedWindowGroups());
    setActiveCase("none");
    windowActiveSlotRef.current = 0;
    pushLog("decorate", "E8 cleared — both groups sent empty");
  }, [pushLog]);

  // ── E9 — do decoration taps reach JS? ─────────────────────────────────────

  const canRunTapCase = Boolean(bulkHref) && hasEnoughQuotesForTapTargets(bulkQuotes);

  const paintTapTargets = useCallback(
    (tint: string = E9_TAP_TINT) => {
      if (!bulkHref || !hasEnoughQuotesForTapTargets(bulkQuotes)) {
        pushLog(
          "decorate",
          `E9 skipped — needs ${E9_TAP_COUNT} quotes in one chapter, have ${bulkQuotes.length}`,
        );
        return;
      }
      const isInvisible = tint === E9_INVISIBLE_TINT;
      // Clearing the tap log with the paint is deliberate: counting taps against
      // decorations that are no longer the ones on screen is how this experiment
      // would lie about itself.
      setTapSamples([]);
      setDecorationGroups([buildTapTargetGroup(bulkHref, bulkQuotes, tint)]);
      setActiveCase(`E9 tap targets (${E9_TAP_COUNT})${isInvisible ? " — invisible" : ""}`);
      pushLog(
        "decorate",
        `E9 — ${E9_TAP_COUNT} ${isInvisible ? "invisible" : "tappable"} decoration(s) painted`,
        isInvisible
          ? // The targets are the same quotes in the same order, so the visible
            // run is the map: paint visible first, note where the highlights sit,
            // then paint invisible and tap the same places.
            "Paint the visible targets first to learn where they are, then tap those same places."
          : "Now tap two different teal highlights, then tap plain text between them.",
      );
    },
    [bulkHref, bulkQuotes, pushLog],
  );

  const clearTapTargets = useCallback(() => {
    setDecorationGroups([buildClearedTapTargetGroup()]);
    setActiveCase("none");
    pushLog("decorate", "E9 cleared — group sent empty");
  }, [pushLog]);

  // ── E6 / E7 ───────────────────────────────────────────────────────────────

  const runGoToProgression = useCallback(
    (progression: number) => {
      const href = decorationHref ?? publication?.positions[0]?.href;
      if (!href) return;
      armGoTo(`asked g=${progression.toFixed(2)}`);
      readerRef.current?.goTo({
        href,
        type: activeAnchor?.type || XHTML_TYPE,
        locations: { progression },
      });
    },
    [activeAnchor?.type, armGoTo, decorationHref, publication],
  );

  const progressionSummary = useMemo(
    () => summariseProgression(locationSamples),
    [locationSamples],
  );

  // ── Report ────────────────────────────────────────────────────────────────

  const anchoringHrefs = useMemo(
    () =>
      hrefVariants
        .filter((variant) => state.verdicts[`href:${variant.id}:decorate`] === "pass")
        .map((variant) => variant.href),
    [hrefVariants, state.verdicts],
  );

  const navigatingHrefs = useMemo(
    () =>
      hrefVariants
        .filter((variant) => state.verdicts[`href:${variant.id}:goto`] === "pass")
        .map((variant) => variant.href),
    [hrefVariants, state.verdicts],
  );

  const shareReport = useCallback(async () => {
    const report = buildResultsReport({
      readiumVersion: READIUM_VERSION,
      deviceLabel: `${Device.modelName ?? "unknown device"} — ${Platform.OS} ${
        Device.osVersion ?? ""
      }`.trim(),
      bookLabel: state.bookLabel,
      hrefObservations: {
        tocHrefs: (publication?.tableOfContents ?? []).slice(0, 3).map((link) => link.href),
        locationHref: currentLocator?.href ?? null,
        positionHref: publication?.positions[0]?.href ?? null,
        opfHrefs: epubManifest?.resolvedHrefs ?? [],
        zipPaths: epubManifest?.zipEntryPaths ?? [],
        anchoring: anchoringHrefs,
        navigating: navigatingHrefs,
      },
      verdicts: state.verdicts,
      frameSamples: state.frameSamples,
      locationSamples,
      anchors: state.anchors,
      notes: state.notes,
    });

    await Share.share({ message: report });
  }, [
    anchoringHrefs,
    currentLocator?.href,
    epubManifest,
    locationSamples,
    navigatingHrefs,
    publication,
    state.anchors,
    state.bookLabel,
    state.frameSamples,
    state.notes,
    state.verdicts,
  ]);

  const shareLog = useCallback(async () => {
    const text = log
      .slice()
      .reverse()
      .map((entry) =>
        [`[${formatTime(entry.at)}] ${entry.tag}: ${entry.message}`, entry.detail]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
    await Share.share({ message: text || "(empty log)" });
  }, [log]);

  const resetSpike = useCallback(() => {
    Alert.alert("Reset spike?", "Clears harvested anchors, verdicts, frame samples, and notes.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => {
          clearSpikeState();
          setState({ ...EMPTY_SPIKE_STATE, bookRelativePath: state.bookRelativePath, bookLabel: state.bookLabel });
          setLocationSamples([]);
          setLog([]);
          setDecorationGroups([]);
          setActiveCase("none");
        },
      },
    ]);
  }, [state.bookLabel, state.bookRelativePath]);

  // ── Render ────────────────────────────────────────────────────────────────

  const readerHeight = isFullReader ? undefined : 300;

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: themeColors.text, fontSize: 13, fontWeight: "700" }}>
            {activeCase === "none" ? "No decoration applied" : activeCase}
          </Text>
          <Text numberOfLines={1} style={{ color: themeColors.textMuted, fontSize: 11 }}>
            {state.bookLabel ?? "No book imported"}
            {currentLocator ? ` · g=${progressionText(currentLocator.locations?.progression)}` : ""}
          </Text>
        </View>
        {isBusy ? <ActivityIndicator /> : null}
        <ActionButton title="Clear" icon="xmark" onPress={clearDecorations} />
        <ActionButton
          title={isFullReader ? "Split" : "Full"}
          icon={isFullReader ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"}
          onPress={() => setIsFullReader((value) => !value)}
        />
      </View>

      <View
        style={{
          height: readerHeight,
          flex: isFullReader ? 1 : undefined,
          backgroundColor: themeColors.surface,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
        }}
      >
        {bookUri ? (
          <ReadiumView
            key={bookUri}
            ref={readerRef}
            file={{ url: bookUri }}
            preferences={{ scroll: true }}
            decorations={decorationGroups}
            selectionActions={SELECTION_ACTIONS}
            onPublicationReady={handlePublicationReady}
            onLocationChange={handleLocationChange}
            onDecorationActivated={handleDecorationActivated}
            onSelectionChange={handleSelectionChange}
            onSelectionAction={handleSelectionAction}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 20 }}>
            <SymbolView name="book.closed" tintColor={themeColors.textMuted} size={28} />
            <Text style={{ color: themeColors.textMuted, fontSize: 13, textAlign: "center" }}>
              Import an EPUB to start the spike. Everything below anchors into this book.
            </Text>
            <ActionButton
              title={isImporting ? "Importing…" : "Import EPUB"}
              icon="square.and.arrow.down"
              tone="accent"
              disabled={isImporting}
              onPress={handleImport}
            />
          </View>
        )}
      </View>

      <ScrollView
          style={{ display: isFullReader ? "none" : "flex" }}
          contentContainerStyle={{
            padding: 16,
            // The tab bar *and* the mini-player float over this screen; the
            // inset covers the first, not the second, and the verdict buttons
            // are what ends up underneath.
            paddingBottom: 140 + insets.bottom,
            gap: 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Section title="Book" subtitle="The spike reads one EPUB, copied into app storage.">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <Stat label="File" value={state.bookLabel} />
              <Stat label="Title" value={publication?.metadata.title} />
              <Stat label="TOC entries" value={publication?.tableOfContents.length} />
              <Stat label="Positions" value={publication?.positions.length} />
            </View>
            {availableBooks.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
                  In the spike directory:
                </Text>
                {availableBooks.map((book) => {
                  const isActive = book.relativePath === state.bookRelativePath;
                  return (
                    <Pressable
                      key={book.relativePath}
                      onPress={() => selectBook(book)}
                      style={{
                        borderWidth: 1,
                        borderColor: isActive ? themeColors.accent : themeColors.border,
                        borderRadius: 10,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ color: themeColors.text, fontSize: 13 }}>{book.fileName}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                title={isImporting ? "Importing…" : "Import EPUB"}
                icon="square.and.arrow.down"
                disabled={isImporting}
                onPress={handleImport}
              />
              <ActionButton title="Rescan" icon="arrow.clockwise" onPress={() => void refreshBooks()} />
              <ActionButton
                title="Remove"
                icon="trash"
                disabled={!state.bookRelativePath}
                onPress={handleRemoveBook}
              />
              <ActionButton title="Reset spike data" icon="arrow.counterclockwise" onPress={resetSpike} />
            </View>
          </Section>

          {activeAnchor ? null : (
            <View
              style={{
                borderWidth: 1,
                borderColor: themeColors.accent,
                borderRadius: 12,
                padding: 12,
                gap: 4,
              }}
            >
              <Text style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
                Harvest an anchor to unlock the experiments
              </Text>
              <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
                E1–E4 all decorate the active anchor, so their buttons stay disabled until one
                exists. Select a sentence and tap “Keep as spike anchor” in the edit menu, or find
                one by search below.
              </Text>
            </View>
          )}

          <Section
            title="Harvest ground truth"
            subtitle="A harvested anchor is a locator Readium built for itself — the control for every experiment below."
          >
            <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
              Select a sentence in the reader and tap “Keep as spike anchor”. That custom edit-menu
              item replaces the system menu, which is deliberate: on iOS the binding never fires
              onSelectionChange, so a selection action is the only way a selection reaches JS.
            </Text>

            {lastSelection?.locator ? (
              <View style={{ gap: 8 }}>
                <Mono>{truncate(lastSelection.selectedText ?? "", 200)}</Mono>
                <Mono>{JSON.stringify(lastSelection.locator, null, 2)}</Mono>
              </View>
            ) : (
              <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
                No selection captured yet.
              </Text>
            )}
            <ActionButton
              title="Keep as anchor"
              icon="pin"
              tone="accent"
              disabled={!lastSelection?.locator}
              onPress={harvestSelection}
            />

            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 12 }}>
              <Text style={{ color: themeColors.text, fontSize: 13, fontWeight: "600" }}>
                Or harvest by search
              </Text>
              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
                A search hit carries a Readium-built locator too, so it is just as good a control —
                and it works even if the edit menu does not.
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TextInput
                  value={harvestQuery}
                  onChangeText={setHarvestQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="a phrase from the book"
                  placeholderTextColor={themeColors.textMuted}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    color: themeColors.text,
                    fontSize: 15,
                  }}
                />
                <ActionButton
                  title="Find"
                  icon="magnifyingglass"
                  disabled={isBusy || !bookUri || !harvestQuery.trim()}
                  onPress={findHarvestCandidates}
                />
              </View>
              {harvestResults.map((result, index) => (
                <View
                  key={`${result.locator.href}-${index}`}
                  style={{
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    borderRadius: 10,
                    padding: 10,
                    gap: 6,
                  }}
                >
                  <Text style={{ color: themeColors.text, fontSize: 13 }}>
                    {truncate(
                      `${result.before ?? ""}[${result.highlight ?? ""}]${result.after ?? ""}`,
                      140,
                    )}
                  </Text>
                  <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                    {result.locator.href} · g=
                    {progressionText(result.locator.locations?.progression)}
                  </Text>
                  <ActionButton
                    title="Keep as anchor"
                    icon="pin"
                    onPress={() =>
                      harvestLocator(result.locator, result.highlight ?? "", "search hit")
                    }
                  />
                </View>
              ))}
            </View>
          </Section>

          <Section title={`Anchors (${state.anchors.length})`} subtitle="Tap one to make it active.">
            {state.anchors.length === 0 ? (
              <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
                Nothing harvested yet.
              </Text>
            ) : (
              state.anchors.map((anchor) => {
                const isActive = anchor.id === activeAnchor?.id;
                return (
                  <Pressable
                    key={anchor.id}
                    onPress={() => setState((current) => ({ ...current, activeAnchorId: anchor.id }))}
                    style={{
                      borderWidth: 1,
                      borderColor: isActive ? themeColors.accent : themeColors.border,
                      borderRadius: 10,
                      padding: 10,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: themeColors.text, fontSize: 13, fontWeight: "600" }}>
                      {truncate(anchor.text.h, 80)}
                    </Text>
                    <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                      {anchor.href} · g={progressionText(anchor.progression)} ·{" "}
                      {formatTime(anchor.capturedAt)}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <ActionButton
                        title="Scroll to it"
                        icon="scope"
                        onPress={() => showAnchor(anchor)}
                      />
                      <ActionButton
                        title="Delete"
                        icon="trash"
                        onPress={() => deleteAnchor(anchor.id)}
                      />
                    </View>
                  </Pressable>
                );
              })
            )}
          </Section>

          <Section
            title="E1 — text-only decoration"
            subtitle="The one that can end the project. 1b is the important case: it proves locations is optional."
          >
            {E1_VARIANTS.map((variant) => (
              <CaseRow
                key={variant.id}
                title={`${variant.id} — ${variant.label}`}
                detail={variant.expectation}
                disabled={!activeAnchor}
                verdict={state.verdicts[variant.id]}
                onRun={() => runE1(variant.id, "highlight")}
                onVerdict={(verdict) => setVerdict(variant.id, verdict)}
              />
            ))}
            <CaseRow
              title="style.type: 'underline'"
              detail="The binding types style.type as a bare string; the accepted values are unverified."
              runLabel="Apply 1a"
              disabled={!activeAnchor}
              verdict={state.verdicts.underline}
              onRun={() => runE1("1a", "underline")}
              onVerdict={(verdict) => setVerdict("underline", verdict)}
            />
          </Section>

          <Section
            title="E2 — what is an href?"
            subtitle={
              decorationHref
                ? `Reported: ${decorationHref} (${describeHrefForm(decorationHref)})`
                : "Harvest an anchor or page the book to learn an href."
            }
          >
            <View style={{ gap: 6 }}>
              <Mono>
                {`TOC: ${(publication?.tableOfContents ?? [])
                  .slice(0, 4)
                  .map((link) => link.href)
                  .join("\n     ") || "—"}`}
              </Mono>
              <Mono>
                {`positions[0..3]: ${(publication?.positions ?? [])
                  .slice(0, 4)
                  .map(
                    (locator) =>
                      `${locator.href}@${progressionText(locator.locations?.progression)}`,
                  )
                  .join("\n                 ") || "—"}`}
              </Mono>
              <Mono>{`onLocationChange: ${currentLocator?.href ?? "—"}`}</Mono>
            </View>

            <ActionButton
              title="Read the EPUB itself"
              icon="doc.zipper"
              disabled={isBusy || !bookUri}
              onPress={inspectEpub}
            />
            {epubManifest ? (
              <View style={{ gap: 6 }}>
                <Mono>{`OPF: ${epubManifest.opfPath}`}</Mono>
                <Mono>
                  {`manifest href: ${epubManifest.manifestHrefs.slice(0, 4).join("\n               ") || "—"}`}
                </Mono>
                <Mono>
                  {`resolved:      ${epubManifest.resolvedHrefs.slice(0, 4).join("\n               ") || "—"}`}
                </Mono>
                <Mono>
                  {`zip path:      ${epubManifest.zipEntryPaths.slice(0, 4).join("\n               ") || "—"}`}
                </Mono>
                <Mono>{`spine items: ${epubManifest.spineHrefs.length}`}</Mono>
              </View>
            ) : null}

            {hrefVariants.map((variant) => (
              <View key={variant.id} style={{ gap: 8, borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 10 }}>
                <Text style={{ color: themeColors.text, fontSize: 13, fontWeight: "600" }}>
                  {variant.label}
                </Text>
                <Mono>{variant.href}</Mono>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionButton
                    title="Decorate"
                    disabled={!activeAnchor}
                    onPress={() => runHrefDecoration(variant.href)}
                  />
                  <ActionButton title="goTo" onPress={() => runHrefGoTo(variant.href)} />
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Anchors?</Text>
                  <VerdictButtons
                    value={state.verdicts[`href:${variant.id}:decorate`]}
                    onChange={(verdict) => setVerdict(`href:${variant.id}:decorate`, verdict)}
                  />
                  <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Navigates?</Text>
                  <VerdictButtons
                    value={state.verdicts[`href:${variant.id}:goto`]}
                    onChange={(verdict) => setVerdict(`href:${variant.id}:goto`, verdict)}
                  />
                </View>
              </View>
            ))}
          </Section>

          <Section
            title="E3 — how faithful must Verbatim Text be?"
            subtitle="One change at a time to the active anchor's highlight. Every failure is a hard requirement on the extractor."
          >
            {activeAnchor ? <Mono>{`"${truncate(activeAnchor.text.h, 160)}"`}</Mono> : null}
            {PERTURBATIONS.map((perturbation) => {
              const perturbed = activeAnchor ? perturbation.apply(activeAnchor.text.h) : "";
              const inert = activeAnchor ? isPerturbationInert(perturbation, activeAnchor.text.h) : false;
              return (
                <CaseRow
                  key={perturbation.id}
                  title={`${perturbation.id} — ${perturbation.label}${inert ? " (no-op on this quote)" : ""}`}
                  detail={
                    inert
                      ? "This quote has nothing to perturb — pick a sentence that exercises the case."
                      : `${perturbation.why}\n"${truncate(perturbed, 110)}"`
                  }
                  disabled={!activeAnchor}
                  verdict={state.verdicts[perturbation.id]}
                  onRun={() => runPerturbation(perturbation.id, perturbed)}
                  onVerdict={(verdict) => setVerdict(perturbation.id, verdict)}
                />
              );
            })}
          </Section>

          <Section
            title="E4 — does context disambiguate?"
            subtitle="Harvest a sentence that repeats in this resource, then narrow the context until the wrong occurrence lights up."
          >
            {CONTEXT_CASES.map((contextCase) => (
              <CaseRow
                key={contextCase.id}
                title={contextCase.label}
                detail={
                  activeAnchor
                    ? `before "${truncate(activeAnchor.text.b, 40)}" · after "${truncate(
                        activeAnchor.text.a,
                        40,
                      )}"`
                    : undefined
                }
                disabled={!activeAnchor}
                verdict={state.verdicts[contextCase.id]}
                onRun={() => runContextCase(contextCase.id, contextCase.chars)}
                onVerdict={(verdict) => setVerdict(contextCase.id, verdict)}
              />
            ))}
          </Section>

          <Section
            title="E5 — where is the decoration knee?"
            subtitle="Bulk anchors come from the publication's own search, so every quote is real text in this resource. The cost is native, so it is measured in dropped frames, not milliseconds."
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="search term"
                placeholderTextColor={themeColors.textMuted}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  color: themeColors.text,
                  fontSize: 15,
                }}
              />
              <ActionButton
                title="Collect"
                icon="magnifyingglass"
                disabled={isBusy || !bookUri}
                onPress={collectBulkQuotes}
              />
            </View>
            <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {bulkHref
                ? `${bulkQuotes.length} usable quotes in ${bulkHref}${
                    bulkReason === "largest" ? " (largest resource)" : " (chapter on screen)"
                  }`
                : "Tap Collect. If the reader has not reported a location yet, Collect uses the largest chapter in the hit list."}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                title="Baseline (0)"
                disabled={isBusy || !bookUri}
                onPress={() => runFrameSample(0, "baseline")}
              />
              {BULK_COUNTS.map((count) => (
                <ActionButton
                  key={count}
                  title={`N=${count}`}
                  disabled={isBusy || !bulkHref || bulkQuotes.length === 0}
                  onPress={() => runFrameSample(count, `N=${count}`)}
                />
              ))}
              <ActionButton
                title={`All (${bulkQuotes.length})`}
                disabled={isBusy || !bulkHref || bulkQuotes.length === 0}
                onPress={() => runFrameSample(bulkQuotes.length, "all")}
              />
            </View>

            {state.frameSamples.length > 0 ? (
              <View style={{ gap: 4 }}>
                {state.frameSamples.map((sample, index) => (
                  <Mono key={`${sample.label}-${index}`}>
                    {`${sample.label.padEnd(10)} n=${String(sample.n).padEnd(5)} ${sample.frames} frames / ${(
                      sample.windowMs / 1000
                    ).toFixed(1)}s  (${framesPerSecond(sample.frames, sample.windowMs).toFixed(1)} fps)`}
                  </Mono>
                ))}
                <ActionButton
                  title="Clear samples"
                  onPress={() => setState((current) => ({ ...current, frameSamples: [] }))}
                />
              </View>
            ) : null}
          </Section>

          <Section
            title="E8 — is the fixed cost per apply, or per group?"
            subtitle={`The number D20 stopped at. Two groups: a ${E8_WINDOW_SIZE}-unit window (purple) painted once, and a 1-unit active highlight (amber) moved on every press. Moving the active group does not re-send the window.`}
          >
            <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {bulkHref && hasEnoughQuotesForWindow(bulkQuotes)
                ? `Ready — ${bulkQuotes.length} quotes in ${bulkHref}. Scroll to the top of that chapter first: the amber pair sits ahead of the purple window so both are on screen together.`
                : `Needs ${E8_REQUIRED_QUOTES} quotes in one chapter. Tap Collect in E5 first.`}
            </Text>
            <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
              Stopwatch only — the frame counter is blind to this (D20). Record three
              things: how long the active apply takes, whether the 20 purple highlights
              stay put, and whether they visibly repaint.
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                title={`Paint window (${E8_WINDOW_SIZE})`}
                disabled={isBusy || !canRunWindowCase}
                onPress={paintWindowGroup}
              />
              <ActionButton
                title="Move active (1)"
                icon="arrow.right"
                disabled={isBusy || !canRunWindowCase}
                onPress={moveActiveUnit}
              />
              <ActionButton title="Clear both" icon="xmark" onPress={clearWindowGroups} />
            </View>

            <CaseRow
              title="8a — a 1-unit group applies at fixed cost"
              detail="Pass if moving the active highlight costs about the same as any other single apply (~0.6-0.7 s), whatever else is painted."
              runLabel="Move"
              disabled={isBusy || !canRunWindowCase}
              verdict={state.verdicts["8a"]}
              onRun={moveActiveUnit}
              onVerdict={(verdict) => setVerdict("8a", verdict)}
            />
            <CaseRow
              title="8b — the window survives an active move untouched"
              detail="Pass if all 20 purple highlights are still there and did not repaint. Fail means the groups are not independent and a moving highlight is not viable through this binding."
              runLabel="Move"
              disabled={isBusy || !canRunWindowCase}
              verdict={state.verdicts["8b"]}
              onRun={moveActiveUnit}
              onVerdict={(verdict) => setVerdict("8b", verdict)}
            />
          </Section>

          <Section
            title="E9 — do decoration taps reach JS?"
            subtitle={`The one unproven link in tap-to-seek. ${E9_TAP_COUNT} teal highlights are painted; tapping one should fire onDecorationActivated with that decoration's own id. The handler listens to every group, so a tap landing on an E5 or E8 highlight is recorded too.`}
          >
            <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {canRunTapCase
                ? `Ready — ${bulkQuotes.length} quotes in ${bulkHref}. Paint, then tap two different teal highlights and one piece of plain text between them.`
                : `Needs ${E9_TAP_COUNT} quotes in one chapter. Tap Collect in E5 first.`}
            </Text>
            <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
              Also worth judging while the targets are up: whether a tint this faint
              reads as &ldquo;this text is tappable&rdquo; or just as damage to the page.
              Tap-to-seek would paint one over every aligned sentence.
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                title={`Paint tap targets (${E9_TAP_COUNT})`}
                disabled={isBusy || !canRunTapCase}
                onPress={() => paintTapTargets()}
              />
              <ActionButton
                title="Paint invisible"
                disabled={isBusy || !canRunTapCase}
                onPress={() => paintTapTargets(E9_INVISIBLE_TINT)}
              />
              <ActionButton title="Clear" icon="xmark" onPress={clearTapTargets} />
              <ActionButton
                title="Reset tap log"
                icon="arrow.counterclockwise"
                onPress={() => setTapSamples([])}
              />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <Stat label="Activations" value={tapSamples.length} />
              <Stat label="Distinct targets" value={distinctTapTargets(tapSamples)} />
              <Stat
                label="Last tap"
                value={tapSamples[0] ? describeTap(tapSamples[0]) : null}
              />
            </View>

            <CaseRow
              title="9a — a tap on a highlight reaches JS"
              detail="Pass if Activations moves at all when you tap a teal highlight. Fail means tap-to-seek is impossible through this binding and the fallback is prev/next-sentence buttons."
              runLabel="Paint"
              disabled={isBusy || !canRunTapCase}
              verdict={state.verdicts["9a"]}
              onRun={() => paintTapTargets()}
              onVerdict={(verdict) => setVerdict("9a", verdict)}
            />
            <CaseRow
              title="9b — the event names the decoration that was tapped"
              detail="Tap two different highlights. Pass only if Distinct targets reaches 2 and each Last tap named the one under your finger — a callback that always reports the same target would pass 9a and still be useless."
              runLabel="Paint"
              disabled={isBusy || !canRunTapCase}
              verdict={state.verdicts["9b"]}
              onRun={() => paintTapTargets()}
              onVerdict={(verdict) => setVerdict("9b", verdict)}
            />
            <CaseRow
              title="9c — plain text does not fire"
              detail="The control. Tap undecorated text between two targets; Activations must not move. If it fires anyway, 9a proved nothing about decorations."
              runLabel="Paint"
              disabled={isBusy || !canRunTapCase}
              verdict={state.verdicts["9c"]}
              onRun={() => paintTapTargets()}
              onVerdict={(verdict) => setVerdict("9c", verdict)}
            />
            <CaseRow
              title="9e — a fully transparent decoration is still tappable"
              detail="The one that decides whether tap-to-seek has to tint the page at all. Paint the visible targets, note where two of them are, then Paint invisible and tap those same places. Pass if Activations still moves."
              runLabel="Invisible"
              disabled={isBusy || !canRunTapCase}
              verdict={state.verdicts["9e"]}
              onRun={() => paintTapTargets(E9_INVISIBLE_TINT)}
              onVerdict={(verdict) => setVerdict("9e", verdict)}
            />
            <CaseRow
              title="9d — activation survives a resource turn"
              detail="Turn to another chapter and back, then tap a target again. The pod re-arms activation in spreadViewDidLoad, so this should hold — but it is the difference between tap-to-seek working for one chapter and working for a book."
              runLabel="Paint"
              disabled={isBusy || !canRunTapCase}
              verdict={state.verdicts["9d"]}
              onRun={() => paintTapTargets()}
              onVerdict={(verdict) => setVerdict("9d", verdict)}
            />
          </Section>

          <Section
            title="E6 — goTo with progression only"
            subtitle="Confirms an approximate g is good enough for coarse navigation. Watch where it lands; the log records the locator that came back."
          >
            {GOTO_PROGRESSIONS.map((progression) => (
              <CaseRow
                key={progression}
                title={`g = ${progression.toFixed(2)}`}
                runLabel="goTo"
                disabled={!decorationHref}
                verdict={state.verdicts[`6-${progression}`]}
                onRun={() => runGoToProgression(progression)}
                onVerdict={(verdict) => setVerdict(`6-${progression}`, verdict)}
              />
            ))}
          </Section>

          <Section
            title="E7 — reverse lookup"
            subtitle="Page through the chapter with sampling on. Tap-to-seek needs progression to be monotone and roughly linear in text position."
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                title={isSamplingLocations ? "Stop sampling" : "Start sampling"}
                icon={isSamplingLocations ? "stop.circle" : "record.circle"}
                tone={isSamplingLocations ? "accent" : "neutral"}
                onPress={() => setIsSamplingLocations((value) => !value)}
              />
              <ActionButton title="Clear samples" onPress={() => setLocationSamples([])} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <Stat label="Samples" value={progressionSummary.count} />
              <Stat
                label="Monotone"
                value={
                  progressionSummary.monotone === null
                    ? "—"
                    : progressionSummary.monotone
                      ? "yes"
                      : "no"
                }
              />
              <Stat
                label="Mean step"
                value={
                  progressionSummary.meanStep === null
                    ? "—"
                    : progressionSummary.meanStep.toFixed(4)
                }
              />
              <Stat
                label="Min / max step"
                value={
                  progressionSummary.minStep === null || progressionSummary.maxStep === null
                    ? "—"
                    : `${progressionSummary.minStep.toFixed(4)} / ${progressionSummary.maxStep.toFixed(4)}`
                }
              />
            </View>
          </Section>

          <Section title="Notes" subtitle="Free text — lands at the bottom of the report.">
            <TextInput
              value={state.notes}
              onChangeText={(notes) => setState((current) => ({ ...current, notes }))}
              multiline
              placeholder="Subjective freeze at N=50, 3g highlighted the wrong clause, …"
              placeholderTextColor={themeColors.textMuted}
              style={{
                minHeight: 90,
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 8,
                padding: 10,
                color: themeColors.text,
                fontSize: 15,
                textAlignVertical: "top",
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                title="Share results"
                icon="square.and.arrow.up"
                tone="accent"
                onPress={shareReport}
              />
              <ActionButton title="Share log" icon="doc.plaintext" onPress={shareLog} />
            </View>
          </Section>

          <Section title={`Log (${log.length})`} subtitle="Newest first.">
            {log.length === 0 ? (
              <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>Nothing yet.</Text>
            ) : (
              log.slice(0, 40).map((entry) => (
                <View
                  key={entry.id}
                  style={{ gap: 2, borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 8 }}
                >
                  <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                    {formatTime(entry.at)} · {entry.tag}
                  </Text>
                  <Text selectable style={{ color: themeColors.text, fontSize: 13 }}>
                    {entry.message}
                  </Text>
                  {entry.detail ? <Mono>{entry.detail}</Mono> : null}
                </View>
              ))
            )}
            <ActionButton title="Clear log" onPress={() => setLog([])} />
          </Section>
        </ScrollView>
    </View>
  );
};
