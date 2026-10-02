import {
  parsePdfParagraphArtifact,
  pdfParagraphsMatchDocument,
  type PdfParagraphArtifact,
} from "./pdf-paragraph-artifact";

let fixture: PdfParagraphArtifact | null | undefined;

/** Development-only, identity-gated geometry spike. A bad sidecar cannot break page follow. */
export const pdfParagraphSpike = (
  hash: string,
  pageCount: number | null,
): PdfParagraphArtifact | null => {
  if (!__DEV__ || pageCount === null) return null;
  if (fixture === undefined) {
    try {
      fixture = parsePdfParagraphArtifact(
        require("./__fixtures__/beyond-positive-thinking.pdf-paragraphs.json"),
      );
    } catch {
      fixture = null;
    }
  }
  return fixture && pdfParagraphsMatchDocument(fixture, hash, pageCount)
    ? fixture
    : null;
};
