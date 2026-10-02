import { downloadsApi } from "@/api/downloads-api";
import {
  getPdfPageMaps,
  storePdfPageMap,
} from "@/data/sqlite/shadow-db-pdf-pages";
import { libraryTracksFromAudioFiles } from "@/transcription/transcript-ingest";
import { ensurePdfAsset } from "@/pdf/pdf-asset";
import {
  parsePdfPageArtifact,
  type PdfPageArtifact,
} from "@/pdf/pdf-page-artifact";
import { rebasePdfPages } from "@/pdf/pdf-page-sync";
import { loadPdfParagraphArtifact } from "@/pdf/pdf-paragraph-loader";
import { pdfParagraphSpike } from "@/pdf/pdf-paragraph-spike";
import type { PdfParagraphArtifact } from "@/pdf/pdf-paragraph-artifact";
import { rebasePdfParagraphs } from "@/pdf/pdf-paragraph-sync";
import {
  type PdfPageSource,
  usePdfPageSources,
} from "@/pdf/use-pdf-page-sources";
import { useThemeColors } from "@/theme/use-app-theme";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { PdfReadAlongView } from "./pdf-read-along-view";

type ReadyPdf = { uri: string; sha256: string; artifact: PdfPageArtifact };
type PdfLoad =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; pdf: ReadyPdf };

/** Fetch only when selected. Cached contract JSON and the durable PDF permit an offline reopen. */
const loadPdf = async (
  bookId: string,
  source: PdfPageSource,
  signal: AbortSignal,
  refresh: boolean,
): Promise<ReadyPdf> => {
  const cached =
    source.cached ??
    (await getPdfPageMaps(bookId)).find((map) => map.pdfIno === source.pdfIno);
  let artifactJson: string;
  try {
    const spec = await downloadsApi.getDownloadSpec(bookId, source.mapIno);
    const response = await fetch(spec.urlWithToken, {
      headers: spec.authHeader,
      signal,
    });
    if (!response.ok)
      throw new Error(`PDF page map download failed (${response.status})`);
    artifactJson = await response.text();
  } catch (error) {
    if (signal.aborted || !cached || refresh) throw error;
    artifactJson = cached.artifactJson;
  }
  const artifact = parsePdfPageArtifact(artifactJson);
  if (artifact.libraryItemId && artifact.libraryItemId !== bookId)
    throw new Error("PDF page map belongs to a different library item");
  if (signal.aborted) throw new Error("PDF loading cancelled");
  const asset = await ensurePdfAsset(
    bookId,
    source.pdfIno,
    artifact.pdf.sha256,
    refresh,
  );
  await storePdfPageMap(bookId, {
    pdfIno: source.pdfIno,
    pdfFilename: source.pdfFilename,
    mapIno: source.mapIno,
    artifactJson,
  });
  return { ...asset, artifact };
};

export const PdfReadAlongSurface = ({
  boundLibraryItemId,
  bottomInset = 0,
}: {
  boundLibraryItemId: string;
  bottomInset?: number;
}) => {
  const colors = useThemeColors();
  const { sources, details } = usePdfPageSources(boundLibraryItemId);
  const [selectedIno, setSelectedIno] = useState<string | null>(null);
  const source =
    sources.find((candidate) => candidate.pdfIno === selectedIno) ?? sources[0];
  return (
    <View style={{ flex: 1 }}>
      {sources.length > 1 ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            paddingHorizontal: 12,
            gap: 8,
          }}
        >
          {sources.map((candidate) => (
            <Pressable
              key={candidate.pdfIno}
              accessibilityRole="button"
              accessibilityState={{
                selected: candidate.pdfIno === source?.pdfIno,
              }}
              onPress={() => setSelectedIno(candidate.pdfIno)}
              style={{ padding: 8 }}
            >
              <Text
                style={{
                  color:
                    candidate.pdfIno === source?.pdfIno
                      ? colors.accent
                      : colors.textMuted,
                }}
              >
                {candidate.pdfFilename}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {source ? (
        <PdfSourceReader
          key={`${boundLibraryItemId}:${source.pdfIno}:${source.mapIno}`}
          bookId={boundLibraryItemId}
          source={source}
          details={details}
          bottomInset={bottomInset}
        />
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
    </View>
  );
};

const PdfSourceReader = ({
  bookId,
  source,
  details,
  bottomInset,
}: {
  bookId: string;
  source: PdfPageSource;
  details: ReturnType<typeof usePdfPageSources>["details"];
  bottomInset: number;
}) => {
  const colors = useThemeColors();
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<PdfLoad>({ status: "loading" });
  const [paragraphLoad, setParagraphLoad] = useState<{
    pdf: ReadyPdf;
    mapIno: string | undefined;
    artifact: PdfParagraphArtifact | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let cancelled = false;
    void loadPdf(bookId, source, controller.signal, attempt > 0)
      .then((pdf) => {
        if (!cancelled) setLoad({ status: "ready", pdf });
      })
      .catch((error) => {
        if (!cancelled)
          setLoad({
            status: "failed",
            message: controller.signal.aborted
              ? "PDF loading timed out. Please retry."
              : error instanceof Error
                ? error.message
                : "Could not load this PDF",
          });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
    // Cached source hydration must not restart an in-flight download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, source.pdfIno, source.mapIno, attempt]);

  useEffect(() => {
    if (load.status !== "ready") return;
    const pdf = load.pdf;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let cancelled = false;
    void loadPdfParagraphArtifact(
      bookId,
      source,
      pdf.artifact,
      pdf.sha256,
      controller.signal,
      attempt > 0,
    )
      .then((artifact) => {
        if (!cancelled)
          setParagraphLoad({ pdf, mapIno: source.paragraphMapIno, artifact });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
    // Hydrated source objects should not restart the optional download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, bookId, source.pdfIno, source.paragraphMapIno, attempt]);

  const paragraphAlignment = useMemo(() => {
    if (load.status !== "ready") return null;
    const artifact =
      paragraphLoad?.pdf === load.pdf &&
      paragraphLoad.mapIno === source.paragraphMapIno
        ? paragraphLoad.artifact
        : null;
    // The bundled experiment remains development-only. Declared sidecars always take precedence.
    const selected =
      artifact ??
      (!source.paragraphMapIno
        ? pdfParagraphSpike(load.pdf.sha256, load.pdf.artifact.pdf.pageCount)
        : null);
    if (!selected) return null;
    try {
      return {
        artifact: selected,
        paragraphs: rebasePdfParagraphs(
          selected,
          load.pdf.artifact,
          libraryTracksFromAudioFiles(
            details?.audioFiles ?? details?.media?.audioFiles,
          ),
        ),
      };
    } catch {
      return null;
    }
  }, [load, paragraphLoad, source.paragraphMapIno, details]);

  const alignment = useMemo(() => {
    if (load.status !== "ready") return null;
    try {
      const tracks = libraryTracksFromAudioFiles(
        details?.audioFiles ?? details?.media?.audioFiles,
      );
      return {
        pages: rebasePdfPages(load.pdf.artifact, tracks),
        problem: null,
      };
    } catch (error) {
      return {
        pages: load.pdf.artifact.pages,
        problem:
          error instanceof Error
            ? error.message
            : "Audio tracks cannot be paired",
      };
    }
  }, [load, details]);

  return (
    <View style={{ flex: 1 }}>
      {load.status === "ready" && alignment ? (
        <PdfReadAlongView
          key={`${bookId}:${source.pdfIno}:${load.pdf.artifact.alignmentId}:${attempt}`}
          bookId={bookId}
          uri={load.pdf.uri}
          hash={load.pdf.sha256}
          artifact={load.pdf.artifact}
          pages={alignment.pages}
          paragraphArtifact={paragraphAlignment?.artifact ?? null}
          paragraphs={paragraphAlignment?.paragraphs}
          trackProblem={alignment.problem}
          bottomInset={bottomInset}
          onRetry={() => {
            setLoad({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 12,
          }}
        >
          {load.status === "failed" ? (
            <>
              <Text style={{ color: colors.text, textAlign: "center" }}>
                {load.message}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLoad({ status: "loading" });
                  setAttempt((value) => value + 1);
                }}
                style={{ padding: 12 }}
              >
                <Text style={{ color: colors.accent }}>Retry PDF download</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ color: colors.textMuted }}>Loading PDF…</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
};
