import { usePlaybackStore } from "@/player/playback-store";
import { useReadAlongSeek } from "@/read-along/use-read-along-seek";
import type { PdfPage, PdfPageArtifact } from "@/pdf/pdf-page-artifact";
import {
  acceptPdfLocation,
  armPdfNavigation,
  newPdfNavigation,
} from "@/pdf/pdf-page-navigation";
import {
  pdfLocatorPage,
  pdfPageLocator,
  pdfSyncProblem,
  timedPdfPages,
} from "@/pdf/pdf-page-sync";
import { usePdfPlaybackPage } from "@/pdf/use-pdf-playback-page";
import { pdfParagraphSpike } from "@/pdf/pdf-paragraph-spike";
import {
  pdfParagraphDecorations,
  pdfParagraphsMatchDocument,
  type PdfParagraphArtifact,
} from "@/pdf/pdf-paragraph-artifact";
import type { TimedPdfParagraph } from "@/pdf/pdf-paragraph-sync";
import { usePdfPlaybackParagraph } from "@/pdf/use-pdf-playback-paragraph";
import { useThemeColors } from "@/theme/use-app-theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ReadiumView,
  type ReadiumViewRef,
  type Locator,
  type PublicationReadyEvent,
} from "react-native-readium";

const NO_PARAGRAPHS: readonly TimedPdfParagraph[] = [];

export const PdfReadAlongView = ({
  bookId,
  uri,
  hash,
  artifact,
  pages,
  paragraphArtifact = null,
  paragraphs = NO_PARAGRAPHS,
  trackProblem,
  bottomInset,
  onRetry,
}: {
  bookId: string;
  uri: string;
  hash: string;
  artifact: PdfPageArtifact;
  pages: readonly PdfPage[];
  paragraphArtifact?: PdfParagraphArtifact | null;
  paragraphs?: readonly TimedPdfParagraph[];
  trackProblem: string | null;
  bottomInset: number;
  onRetry: () => void;
}) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reader = useRef<ReadiumViewRef>(null);
  const file = useMemo(() => ({ url: uri }), [uri]);
  const preferences = useMemo(() => ({}), []);
  const navigation = useRef(newPdfNavigation());
  const href = useRef("publication.pdf");
  const [resourceHref, setResourceHref] = useState("publication.pdf");
  const readyRef = useRef(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [following, setFollowing] = useState(true);
  const [spikingParagraphs, setSpikingParagraphs] = useState(false);
  const [spikeIndex, setSpikeIndex] = useState(2);
  const spike = useMemo(
    () => pdfParagraphSpike(hash, pageCount),
    [hash, pageCount],
  );
  const playingBook = usePlaybackStore((state) => state.libraryItemId);
  const problem =
    pageCount === null
      ? null
      : (pdfSyncProblem(artifact, hash, pageCount) ?? trackProblem);
  const canSync =
    pageCount !== null && problem === null && playingBook === bookId;
  const timed = useMemo(() => timedPdfPages(pages), [pages]);
  // Keep resolving the narrated page while browsing so Resume follows the live audio.
  const activePage = usePdfPlaybackPage(bookId, timed, canSync);
  const resumeFollowing = useCallback(() => setFollowing(true), []);
  const { seek, isSeeking } = useReadAlongSeek(bookId, resumeFollowing);
  const canHighlight =
    canSync &&
    pageCount !== null &&
    following &&
    !spikingParagraphs &&
    !isSeeking &&
    paragraphArtifact !== null &&
    !paragraphArtifact.degraded &&
    paragraphArtifact.pageMapAlignmentId === artifact.alignmentId &&
    pdfParagraphsMatchDocument(paragraphArtifact, hash, pageCount);
  const activeParagraph = usePdfPlaybackParagraph(
    bookId,
    paragraphs,
    canHighlight,
  );
  const paragraphDecorations = useMemo(() => {
    if (spikingParagraphs) {
      if (!spike || currentPage !== 8) return [];
      const paragraph = spike.paragraphs.find(
        (item) => item.p === 8 && item.i === spikeIndex,
      );
      return pdfParagraphDecorations(spike, paragraph ?? null, resourceHref);
    }
    if (
      !canHighlight ||
      !paragraphArtifact ||
      !activeParagraph ||
      activeParagraph.p !== currentPage ||
      currentPage !== activePage
    )
      return [];
    return pdfParagraphDecorations(
      paragraphArtifact,
      activeParagraph,
      resourceHref,
    );
  }, [
    spike,
    spikingParagraphs,
    currentPage,
    spikeIndex,
    resourceHref,
    canHighlight,
    paragraphArtifact,
    activeParagraph,
    activePage,
  ]);

  const goToPage = useCallback((p: number) => {
    navigation.current = armPdfNavigation(navigation.current, p, Date.now());
    reader.current?.goTo(pdfPageLocator(href.current, p));
  }, []);

  useEffect(() => {
    if (
      spikingParagraphs ||
      activePage === null ||
      !following ||
      !canSync ||
      isSeeking
    )
      return;
    if (
      navigation.current.displayed === activePage ||
      navigation.current.pending?.page === activePage
    )
      return;
    goToPage(activePage);
  }, [activePage, following, canSync, isSeeking, goToPage, spikingParagraphs]);

  const handleReady = useCallback((event: PublicationReadyEvent) => {
    const count = event.metadata.numberOfPages;
    // Readium's PDF parser obtains this from the opened PDFDocument, not from our page map.
    setPageCount(Number.isSafeInteger(count) && (count ?? 0) > 0 ? count! : 0);
    if (event.positions[0]?.href) {
      href.current = event.positions[0].href.split("#")[0];
      setResourceHref(href.current);
    }
    readyRef.current = true;
  }, []);

  const handleLocation = useCallback(
    (locator: Locator) => {
      const p = pdfLocatorPage(locator, pageCount ?? artifact.pdf.pageCount);
      if (p === null) return;
      href.current = locator.href.split("#")[0];
      setResourceHref(href.current);
      const accepted = acceptPdfLocation(navigation.current, p, Date.now());
      navigation.current = accepted.state;
      setCurrentPage(p);
      if (readyRef.current && accepted.readerTurn) setFollowing(false);
    },
    [pageCount, artifact.pdf.pageCount],
  );

  const manualTurn = (delta: number) => {
    const p = Math.min(
      (pageCount ?? artifact.pdf.pageCount) - 1,
      Math.max(0, currentPage + delta),
    );
    if (p === currentPage) return;
    setFollowing(false);
    goToPage(p);
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          minHeight: 44,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous PDF page"
          disabled={currentPage === 0}
          onPress={() => manualTurn(-1)}
          style={{ padding: 10, opacity: currentPage === 0 ? 0.35 : 1 }}
        >
          <Text style={{ color: colors.accent }}>‹</Text>
        </Pressable>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          Page {currentPage + 1} / {pageCount || artifact.pdf.pageCount}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next PDF page"
          disabled={currentPage >= (pageCount || artifact.pdf.pageCount) - 1}
          onPress={() => manualTurn(1)}
          style={{ padding: 10 }}
        >
          <Text style={{ color: colors.accent }}>›</Text>
        </Pressable>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Follow PDF pages with audio"
          accessibilityState={{
            checked: following && canSync,
            disabled: !canSync,
          }}
          disabled={!canSync}
          onPress={() => {
            setFollowing((value) => !value);
          }}
          style={{ padding: 10 }}
        >
          <Text
            style={{
              color: canSync && following ? colors.accent : colors.textMuted,
            }}
          >
            {canSync && following ? "Following" : "Follow off"}
          </Text>
        </Pressable>
      </View>
      {spike ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              spikingParagraphs
                ? "Exit paragraph overlay spike"
                : "Test paragraph highlights"
            }
            onPress={() => {
              if (spikingParagraphs) {
                setSpikingParagraphs(false);
              } else {
                setSpikeIndex(2);
                setSpikingParagraphs(true);
                goToPage(8);
              }
            }}
            style={{ padding: 8 }}
          >
            <Text style={{ color: colors.accent, fontSize: 12 }}>
              {spikingParagraphs
                ? "Exit paragraph overlay spike"
                : "Test paragraph highlights"}
            </Text>
          </Pressable>
          {spikingParagraphs ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                Page 9 · paragraph
              </Text>
              {[0, 1, 2].map((i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`Highlight PDF paragraph ${i}`}
                  accessibilityState={{ selected: spikeIndex === i }}
                  onPress={() => setSpikeIndex(i)}
                  style={{ padding: 8 }}
                >
                  <Text
                    style={{
                      color:
                        spikeIndex === i ? colors.accent : colors.textMuted,
                    }}
                  >
                    {i}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {problem ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 4 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {problem}
          </Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={{ color: colors.accent, fontSize: 12 }}>
              Reload PDF and page map
            </Text>
          </Pressable>
        </View>
      ) : null}
      {!following && canSync ? (
        <View
          style={{
            position: "absolute",
            bottom: 16 + bottomInset + insets.bottom,
            alignSelf: "center",
            zIndex: 10,
            alignItems: "center",
            gap: 8,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Resume following"
            onPress={resumeFollowing}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: colors.accent,
            }}
          >
            <Text style={{ color: colors.accentForeground, fontWeight: "600" }}>
              Resume following
            </Text>
          </Pressable>
          {pages[currentPage]?.timing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Listen from PDF page ${currentPage + 1}`}
              disabled={isSeeking}
              onPress={() => {
                const timing = pages[currentPage]?.timing;
                if (timing && canSync) void seek(timing.startMs);
              }}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: isSeeking ? 0.4 : 1,
              }}
            >
              <Text style={{ color: colors.accent, fontWeight: "600" }}>
                Listen from page {currentPage + 1}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View
        style={{ flex: 1, marginBottom: bottomInset }}
        onTouchStart={() => {
          // A reader gesture takes priority over an unacknowledged audio-driven jump.
          navigation.current = { ...navigation.current, pending: null };
        }}
      >
        <ReadiumView
          ref={reader}
          file={file}
          preferences={preferences}
          decorations={paragraphDecorations}
          onPublicationReady={handleReady}
          onLocationChange={handleLocation}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
};
