import {
  alignmentStem,
  collectAlignableEbooks,
  ebookStem,
  findAlignmentLibraryFiles,
  hasAlignmentLibraryFile,
  isAlignmentFilename,
  normalizeStem,
  pairAlignmentWithEbook,
} from "./alignment-files";

const file = (filename: string, ino = filename) =>
  ({ ino, metadata: { filename }, fileType: filename.endsWith(".epub") ? "ebook" : "metadata" }) as never;

const book = (...filenames: string[]) => ({ libraryFiles: filenames.map((name) => file(name)) });

const REAL = book(
  "A Field Guide to Lies.epub",
  "Daniel J. Levitin - A Field Guide to Lies Critical T.m4b",
  "cover.jpg",
  "metadata.json",
  "laabs.A Field Guide to Lies.alignment.json",
  "laabs.transcript.json",
);

describe("isAlignmentFilename", () => {
  it("accepts a real map name", () => {
    expect(isAlignmentFilename("laabs.A Field Guide to Lies.alignment.json")).toBe(true);
  });

  it("does not mistake the transcript for a map", () => {
    expect(isAlignmentFilename("laabs.transcript.json")).toBe(false);
  });

  it("rejects the affixes with nothing between them", () => {
    // `laabs.` + `.alignment.json` with an empty stem names no ebook.
    expect(isAlignmentFilename("laabs..alignment.json")).toBe(false);
    expect(isAlignmentFilename("laabs.alignment.json")).toBe(false);
  });

  it("rejects unrelated files", () => {
    expect(isAlignmentFilename("metadata.json")).toBe(false);
    expect(isAlignmentFilename("alignment.json")).toBe(false);
  });
});

describe("stem extraction", () => {
  it("strips both affixes from a map name", () => {
    expect(alignmentStem("laabs.A Field Guide to Lies.alignment.json")).toBe(
      "A Field Guide to Lies",
    );
  });

  it("strips only the final extension from an ebook name", () => {
    expect(ebookStem("A Field Guide to Lies.epub")).toBe("A Field Guide to Lies");
    expect(ebookStem("Vol. 1 - The Book.epub")).toBe("Vol. 1 - The Book");
  });
});

describe("normalizeStem", () => {
  it("folds case, punctuation and spacing to one key", () => {
    expect(normalizeStem("A Field Guide to Lies")).toBe(normalizeStem("a_field-guide_to_lies"));
  });

  it("folds NFD and NFC to the same key — the SMB round-trip case", () => {
    const nfc = "Café Society".normalize("NFC");
    const nfd = "Café Society".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(normalizeStem(nfd)).toBe(normalizeStem(nfc));
  });

  it("survives the producer's sanitisation of characters SMB rejects", () => {
    // `Who Moved My Cheese? "Yes"` sanitises to `Who Moved My Cheese_ _Yes_`.
    expect(normalizeStem("Who Moved My Cheese_ _Yes_")).toBe(
      normalizeStem('Who Moved My Cheese? "Yes"'),
    );
  });

  it("keeps letters and digits from other scripts", () => {
    expect(normalizeStem("日本語 2")).toBe("日本語2");
  });
});

describe("findAlignmentLibraryFiles", () => {
  it("finds only the map among a real folder listing", () => {
    expect(findAlignmentLibraryFiles(REAL).map((f) => f.metadata?.filename)).toEqual([
      "laabs.A Field Guide to Lies.alignment.json",
    ]);
  });

  it("skips a file with no ino, which cannot be downloaded", () => {
    const noIno = { libraryFiles: [{ ino: "", metadata: { filename: "laabs.X.alignment.json" } }] };
    expect(findAlignmentLibraryFiles(noIno as never)).toEqual([]);
  });

  it("returns empty for a book with no library files at all", () => {
    expect(findAlignmentLibraryFiles(undefined)).toEqual([]);
    expect(findAlignmentLibraryFiles({ libraryFiles: null })).toEqual([]);
  });
});

describe("collectAlignableEbooks", () => {
  it("takes the EPUB and leaves the PDF — only an EPUB can be aligned", () => {
    const mixed = book("Any Way You Can.epub", "Any Way You Can.pdf", "laabs.X.alignment.json");
    expect(collectAlignableEbooks(mixed).map((e) => e.filenameWithExt)).toEqual([
      "Any Way You Can.epub",
    ]);
  });
});

/** Verbatim from the server after the rescan — a 129-character map filename. */
const NICKERSON = book(
  "Cash Nickerson - The Seven Tensions of Negotiation - Breathe and Let the Opposition Make the Tough Decisions.epub",
  "Cash Nickerson - The Seven Tensions of Negotiation - Breathe and Let the Opposition Make the Tough Decisions.m4b",
  "metadata.json",
  "cover.jpg",
  "laabs.Cash Nickerson - The Seven Tensions of Negotiation - Breathe and Let the Opposition Make the Tough Decisions.alignment.json",
  "laabs.transcript.json",
);

describe("pairAlignmentWithEbook", () => {
  it("pairs the long real filename by stem — the case the naming change exists for", () => {
    const pairing = pairAlignmentWithEbook(NICKERSON);
    expect(pairing?.matchedBy).toBe("stem");
    expect(pairing?.ebook.filenameWithExt).toBe(
      "Cash Nickerson - The Seven Tensions of Negotiation - Breathe and Let the Opposition Make the Tough Decisions.epub",
    );
  });

  it("pairs the real book by stem", () => {
    const pairing = pairAlignmentWithEbook(REAL);
    expect(pairing?.matchedBy).toBe("stem");
    expect(pairing?.ebook.filenameWithExt).toBe("A Field Guide to Lies.epub");
    expect(pairing?.file.metadata?.filename).toBe("laabs.A Field Guide to Lies.alignment.json");
  });

  it("pairs across the producer's sanitisation", () => {
    const sanitised = book('Who Moved My Cheese? "Yes".epub', "laabs.Who Moved My Cheese_ _Yes_.alignment.json");
    expect(pairAlignmentWithEbook(sanitised)?.matchedBy).toBe("stem");
  });

  it("falls back to the sole candidate when the names disagree entirely", () => {
    const renamed = book("The Book.epub", "laabs.Something Else Entirely.alignment.json");
    const pairing = pairAlignmentWithEbook(renamed);
    expect(pairing?.matchedBy).toBe("soleCandidate");
    expect(pairing?.ebook.filenameWithExt).toBe("The Book.epub");
  });

  it("refuses to guess when two EPUBs and two maps do not match by name", () => {
    const ambiguous = book(
      "One.epub",
      "Two.epub",
      "laabs.Three.alignment.json",
      "laabs.Four.alignment.json",
    );
    expect(pairAlignmentWithEbook(ambiguous)).toBeNull();
  });

  it("pairs each of two EPUBs with its own map, not the other's", () => {
    const twins = book("One.epub", "Two.epub", "laabs.Two.alignment.json", "laabs.One.alignment.json");
    const pairing = pairAlignmentWithEbook(twins);
    expect(pairing?.ebook.filenameWithExt).toBe("One.epub");
    expect(pairing?.file.metadata?.filename).toBe("laabs.One.alignment.json");
  });

  it("prefers the edition Audiobookshelf calls primary", () => {
    // Two aligned editions is two valid pairings; `media.ebookFile` breaks the
    // tie, rather than whichever file the server listed first.
    const twins = {
      media: {
        ebookFile: { ino: "two", metadata: { filename: "Two", ext: ".epub" }, ebookFormat: "epub" },
      },
      libraryFiles: [
        file("One.epub"),
        file("Two.epub", "two"),
        file("laabs.One.alignment.json"),
        file("laabs.Two.alignment.json"),
      ],
    };
    const pairing = pairAlignmentWithEbook(twins as never);
    expect(pairing?.ebook.filenameWithExt).toBe("Two.epub");
    expect(pairing?.file.metadata?.filename).toBe("laabs.Two.alignment.json");
  });

  it("returns null for a map with no EPUB beside it", () => {
    expect(pairAlignmentWithEbook(book("laabs.Ghost.alignment.json"))).toBeNull();
  });

  it("returns null for an EPUB with no map — the common case", () => {
    expect(pairAlignmentWithEbook(book("A Field Guide to Lies.epub"))).toBeNull();
  });

  it("does not pair an EPUB with the Book Transcript", () => {
    expect(pairAlignmentWithEbook(book("A Field Guide to Lies.epub", "laabs.transcript.json"))).toBeNull();
  });
});

describe("hasAlignmentLibraryFile", () => {
  it("is true only when a pairing exists", () => {
    expect(hasAlignmentLibraryFile(REAL)).toBe(true);
    expect(hasAlignmentLibraryFile(book("A Field Guide to Lies.epub"))).toBe(false);
    expect(hasAlignmentLibraryFile(undefined)).toBe(false);
  });
});
