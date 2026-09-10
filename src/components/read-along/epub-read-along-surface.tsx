/**
 * The EPUB Read-Along surface: everything that has to happen before
 * `EpubReadAlongView` can paint, and the honest states when it cannot.
 *
 * Three things are fetched on first open and never again (ADR-0039):
 * the Alignment Map into SQLite, and the EPUB onto disk for Readium. Neither is
 * pulled from book detail — nothing outside this surface consumes them.
 */

import { pairAlignmentWithEbook } from "@/components/bookComponents/alignment-files";
import { ensureEpubAsset } from "@/alignment/epub-asset";
import { useAlignmentIngest } from "@/alignment/use-alignment-ingest";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { useThemeColors } from "@/theme/use-app-theme";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { EpubReadAlongView } from "./epub-read-along-view";

export type EpubReadAlongSurfaceProps = {
  boundLibraryItemId: string | null;
  /** Passed through to the reader — see `EpubReadAlongViewProps.bottomInset`. */
  bottomInset?: number;
};

type EpubFetchState =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "ready"; uri: string }
  | { status: "failed"; message: string };

const Centered = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
    {children}
  </View>
);

export const EpubReadAlongSurface = ({
  boundLibraryItemId,
  bottomInset,
}: EpubReadAlongSurfaceProps) => {
  const themeColors = useThemeColors();
  const { data: details } = useGetItemDetails(boundLibraryItemId ?? undefined);
  const ingest = useAlignmentIngest(boundLibraryItemId, { enabled: true });

  const ebookIno = useMemo(() => pairAlignmentWithEbook(details)?.ebook.ino ?? null, [details]);

  const [epub, setEpub] = useState<EpubFetchState>({ status: "idle" });
  const [pairingDismissed, setPairingDismissed] = useState(false);

  // The EPUB download waits for ingest: a map that will not parse is a reason
  // not to spend the reader's bandwidth on a book they cannot follow anyway.
  useEffect(() => {
    if (!boundLibraryItemId || !ebookIno) return;
    if (ingest.outcome !== "ingested" && ingest.outcome !== "skipped") return;

    let cancelled = false;
    setEpub({ status: "fetching" });
    void ensureEpubAsset(boundLibraryItemId, ebookIno)
      .then((asset) => {
        if (!cancelled) setEpub({ status: "ready", uri: asset.uri });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[EpubReadAlong] epub fetch failed book=${boundLibraryItemId} ${message}`);
        setEpub({ status: "failed", message });
      });

    return () => {
      cancelled = true;
    };
  }, [boundLibraryItemId, ebookIno, ingest.outcome]);

  if (!boundLibraryItemId) {
    return (
      <Centered>
        <Text style={{ color: themeColors.textMuted }}>No book selected.</Text>
      </Centered>
    );
  }

  if (ingest.outcome === "absent") {
    return (
      <Centered>
        <Text style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
          No aligned ebook
        </Text>
        <Text style={{ color: themeColors.textMuted, textAlign: "center" }}>
          This book has no EPUB with a matching alignment file on the server.
        </Text>
      </Centered>
    );
  }

  if (ingest.outcome === "failed") {
    return (
      <Centered>
        <Text style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
          Couldn&apos;t load the alignment
        </Text>
        <Text style={{ color: themeColors.textMuted, textAlign: "center" }}>
          {/* Includes the stale-listing case: the server can name a file that a
              rescan has since renamed, and the download 404s. */}
          {ingest.errorMessage ??
            "LAABS found an alignment file for this book but couldn't read it."}
        </Text>
      </Centered>
    );
  }

  if (epub.status === "failed") {
    return (
      <Centered>
        <Text style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
          Couldn&apos;t download the ebook
        </Text>
        <Text style={{ color: themeColors.textMuted, textAlign: "center" }}>{epub.message}</Text>
      </Centered>
    );
  }

  if (epub.status !== "ready") {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  const showPairingNotice = ingest.pairing?.status === "mismatch" && !pairingDismissed;

  return (
    <View style={{ flex: 1 }}>
      {showPairingNotice ? (
        // Q14: an ino changes when a file is re-imported (D36), so a mismatch
        // cannot tell "re-imported" from "mispaired". There is no honest
        // automatic test — Readium's matcher returns its best candidate however
        // poor — so say it once and let the reader judge.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss alignment warning"
          onPress={() => setPairingDismissed(true)}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: themeColors.surface,
            borderBottomWidth: 1,
            borderBottomColor: themeColors.border,
          }}
        >
          <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>
            This ebook has changed since its alignment was made — highlighting may be off. Tap to
            dismiss.
          </Text>
        </Pressable>
      ) : null}

      <EpubReadAlongView
        boundLibraryItemId={boundLibraryItemId}
        epubUri={epub.uri}
        bottomInset={bottomInset}
      />
    </View>
  );
};
