import { strFromU8, unzipSync } from "fflate";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { buildTranscriptEpub, type TranscriptEpubSegment } from "./transcript-epub-export";
import type { BookTranscriptSection } from "@/data/sqlite/shadow-db-transcripts";

const section = (index: number, title: string): BookTranscriptSection => ({
  index,
  title,
  startMs: 0,
  endMs: 1000,
});

const segment = (
  sectionIndex: number,
  startMs: number,
  endMs: number,
  text: string,
): TranscriptEpubSegment => ({ sectionIndex, startMs, endMs, text });

/** Reads the first 30 bytes of a zip's local file header for its compression method (offset 8-9). */
const readFirstEntryCompressionMethod = (zipBytes: Uint8Array) => zipBytes[8] | (zipBytes[9] << 8);

describe("buildTranscriptEpub", () => {
  it("puts mimetype first, uncompressed, with the correct content", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      bookAuthor: "An Author",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [segment(0, 0, 1000, "Hello world.")],
      generatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(readFirstEntryCompressionMethod(bytes)).toBe(0);

    const unzipped = unzipSync(bytes);
    const keys = Object.keys(unzipped);
    expect(keys[0]).toBe("mimetype");
    expect(strFromU8(unzipped.mimetype)).toBe("application/epub+zip");
  });

  it("points container.xml at the content.opf rootfile", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [],
    });

    const unzipped = unzipSync(bytes);
    const containerXml = strFromU8(unzipped["META-INF/container.xml"]);
    expect(containerXml).toContain('full-path="OEBPS/content.opf"');
  });

  it("emits one chapter file per section", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1"), section(1, "Part 2"), section(2, "Part 3")],
      segments: [],
    });

    const unzipped = unzipSync(bytes);
    const chapterFiles = Object.keys(unzipped).filter((key) =>
      /^OEBPS\/chapter-\d+\.xhtml$/.test(key),
    );
    expect(chapterFiles.sort()).toEqual([
      "OEBPS/chapter-1.xhtml",
      "OEBPS/chapter-2.xhtml",
      "OEBPS/chapter-3.xhtml",
    ]);
  });

  it("XML-escapes titles, author, and segment text", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: `A & B <Book> "Title"`,
      bookAuthor: `Author & Co`,
      localeIdentifier: "en-US",
      sections: [section(0, `Chapter & <One>`)],
      segments: [segment(0, 0, 1000, `He said "hi" & left <fast>`)],
    });

    const unzipped = unzipSync(bytes);
    const opf = strFromU8(unzipped["OEBPS/content.opf"]);
    const nav = strFromU8(unzipped["OEBPS/nav.xhtml"]);
    const chapter1 = strFromU8(unzipped["OEBPS/chapter-1.xhtml"]);

    expect(opf).toContain("A &amp; B &lt;Book&gt; &quot;Title&quot;");
    expect(opf).toContain("Author &amp; Co");
    expect(opf).not.toContain(`"Title"`);
    expect(nav).toContain("Chapter &amp; &lt;One&gt;");
    expect(chapter1).toContain("Chapter &amp; &lt;One&gt;");
    expect(chapter1).toContain("He said &quot;hi&quot; &amp; left &lt;fast&gt;");
    expect(chapter1).not.toContain(`He said "hi" & left <fast>`);
  });

  it("keeps segments in one paragraph when the gap is under 2s", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [
        segment(0, 0, 1000, "Hello."),
        segment(0, 1500, 2000, "World."), // 500ms gap
      ],
    });

    const chapter1 = strFromU8(unzipSync(bytes)["OEBPS/chapter-1.xhtml"]);
    expect(chapter1).toContain("<p>Hello. World.</p>");
    expect((chapter1.match(/<p>/g) ?? []).length).toBe(1);
  });

  it("starts a new paragraph when the gap exceeds 2s", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [
        segment(0, 0, 1000, "Hello."),
        segment(0, 3500, 4000, "World."), // 2500ms gap
      ],
    });

    const chapter1 = strFromU8(unzipSync(bytes)["OEBPS/chapter-1.xhtml"]);
    expect(chapter1).toContain("<p>Hello.</p>");
    expect(chapter1).toContain("<p>World.</p>");
    expect((chapter1.match(/<p>/g) ?? []).length).toBe(2);
  });

  it("includes a disclaimer front page", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [],
      generatedAt: new Date("2026-03-02T00:00:00.000Z"),
    });

    const front = strFromU8(unzipSync(bytes)["OEBPS/front.xhtml"]);
    expect(front).toContain("generated by LAABS Audio");
    expect(front).toContain("2026-03-02");
    expect(front).toContain("en-US");
    expect(front).toContain("will contain errors");
  });

  it("includes a cover entry when cover bytes are provided", () => {
    const coverBytes = new Uint8Array([1, 2, 3, 4]);
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [],
      coverImageBytes: coverBytes,
    });

    const unzipped = unzipSync(bytes);
    expect(unzipped["OEBPS/cover.webp"]).toEqual(coverBytes);
    expect(strFromU8(unzipped["OEBPS/content.opf"])).toContain(
      'media-type="image/webp"',
    );
  });

  it("omits the cover entry when no cover is provided", () => {
    const bytes = buildTranscriptEpub({
      libraryItemId: "book-1",
      bookTitle: "A Book",
      localeIdentifier: "en-US",
      sections: [section(0, "Part 1")],
      segments: [],
    });

    const unzipped = unzipSync(bytes);
    expect(unzipped["OEBPS/cover.webp"]).toBeUndefined();
    expect(strFromU8(unzipped["OEBPS/content.opf"])).not.toContain("cover-image");
  });
});
