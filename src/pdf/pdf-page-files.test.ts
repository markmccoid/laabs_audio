import { findPdfPagePairings } from "./pdf-page-files";
import type { LibraryFile } from "@/types/absTypes";

const file = (ino: string, filename: string): LibraryFile => ({
  ino,
  fileType: "ebook",
  metadata: { filename, ext: filename.slice(filename.lastIndexOf(".")) },
});

describe("PDF page map discovery", () => {
  it("pairs the real sample name without confusing EPUB maps on the same item", () => {
    const result = findPdfPagePairings({
      libraryFiles: [
        file("pdf", "Robert Anthony Beyond_Positive_Thinking.pdf"),
        file("epub", "Robert Anthony Beyond_Positive_Thinking.epub"),
        file(
          "page-map",
          "laabs.Robert Anthony Beyond_Positive_Thinking.pdf-pages.json",
        ),
        file(
          "epub-map",
          "laabs.Robert Anthony Beyond_Positive_Thinking.alignment.json",
        ),
      ],
    });
    expect(result.map((pair) => [pair.pdf.ino, pair.map.ino])).toEqual([
      ["pdf", "page-map"],
    ]);
  });
  it("discovers an optional paragraph sidecar and refuses ambiguous ones without losing pages", () => {
    const files = [
      file("pdf", "Book.pdf"),
      file("page", "laabs.Book.pdf-pages.json"),
    ];
    const paragraph = file("paragraph", "laabs.Book.pdf-paragraphs.json");
    expect(
      findPdfPagePairings({ libraryFiles: [...files, paragraph] })[0]
        .paragraphMap?.ino,
    ).toBe("paragraph");
    expect(
      findPdfPagePairings({
        libraryFiles: [
          ...files,
          paragraph,
          file("duplicate", "laabs.B-O-O-K.pdf-paragraphs.json"),
        ],
      })[0].paragraphMap,
    ).toBeUndefined();
    expect(
      findPdfPagePairings({
        libraryFiles: [
          ...files,
          file("hash", "laabs.abcdef.pdf-paragraphs.json"),
        ],
      })[0].paragraphMap?.ino,
    ).toBe("hash");
  });
  it("matches sanitized names and Unicode normalization", () => {
    expect(
      findPdfPagePairings({
        libraryFiles: [
          file("p", "Café: Guide.PDF"),
          file("m", "laabs.CAFÉ_guide.pdf-pages.json"),
        ],
      }),
    ).toHaveLength(1);
  });
  it("allows a single hash-named fallback but refuses ambiguous candidates", () => {
    expect(
      findPdfPagePairings({
        libraryFiles: [
          file("p", "Book.pdf"),
          file("m", "laabs.abcdef12.pdf-pages.json"),
        ],
      }),
    ).toHaveLength(1);
    expect(
      findPdfPagePairings({
        libraryFiles: [
          file("p", "Book.pdf"),
          file("p2", "Other.pdf"),
          file("m", "laabs.abcdef12.pdf-pages.json"),
        ],
      }),
    ).toHaveLength(0);
    expect(
      findPdfPagePairings({
        libraryFiles: [
          file("p", "Book.pdf"),
          file("m", "laabs.Book.pdf-pages.json"),
          file("m2", "laabs.B-O-O-K.pdf-pages.json"),
        ],
      }),
    ).toHaveLength(0);
  });
});
