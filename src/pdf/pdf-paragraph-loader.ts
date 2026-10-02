import { downloadsApi } from "@/api/downloads-api";
import {
  deletePdfParagraphMap,
  getPdfParagraphMap,
  storePdfParagraphMap,
} from "@/data/sqlite/shadow-db-pdf-paragraphs";
import type { PdfPageArtifact } from "./pdf-page-artifact";
import {
  parsePdfParagraphArtifact,
  pdfParagraphsMatchDocument,
  type PdfParagraphArtifact,
} from "./pdf-paragraph-artifact";
import type { PdfPageSource } from "./use-pdf-page-sources";

/** Optional sidecar: errors cannot become PDF/page-follow errors. Never store tokens or rebased timing. */
export const loadPdfParagraphArtifact = async (
  bookId: string,
  source: PdfPageSource,
  pageMap: PdfPageArtifact,
  hash: string,
  signal: AbortSignal,
  refresh: boolean,
): Promise<PdfParagraphArtifact | null> => {
  let fetched = false;
  const discard = () =>
    deletePdfParagraphMap(bookId, source.pdfIno, pageMap.alignmentId).catch(
      () => undefined,
    );
  try {
    const cached = await getPdfParagraphMap(
      bookId,
      source.pdfIno,
      pageMap.alignmentId,
    ).catch(() => null);
    let json: string;
    const mapIno = source.paragraphMapIno ?? cached?.mapIno;
    if (!mapIno) return null;
    if (!source.paragraphMapIno && cached && !refresh)
      json = cached.artifactJson;
    else {
      try {
        const spec = await downloadsApi.getDownloadSpec(bookId, mapIno);
        if (signal.aborted) return null;
        const response = await fetch(spec.urlWithToken, {
          headers: spec.authHeader,
          signal,
        });
        if (!response.ok) {
          // A stale listing or explicitly missing sidecar must not revive an old highlight.
          if (response.status === 404 || response.status === 410) {
            await discard();
            return null;
          }
          throw new Error(
            `PDF paragraph map download failed (${response.status})`,
          );
        }
        json = await response.text();
        fetched = true;
      } catch {
        if (signal.aborted || refresh || !cached || cached.mapIno !== mapIno)
          return null;
        json = cached.artifactJson;
      }
    }
    if (signal.aborted) return null;
    const artifact = parsePdfParagraphArtifact(json);
    if (
      artifact.degraded ||
      artifact.pageMapAlignmentId !== pageMap.alignmentId ||
      !pdfParagraphsMatchDocument(artifact, hash, pageMap.pdf.pageCount)
    ) {
      await discard();
      return null;
    }
    await storePdfParagraphMap(
      bookId,
      source.pdfIno,
      pageMap.alignmentId,
      mapIno,
      json,
    ).catch(() => undefined);
    return signal.aborted ? null : artifact;
  } catch {
    if (fetched && !signal.aborted) await discard();
    return null;
  }
};
