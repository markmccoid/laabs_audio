import { buildBookClipTextExport } from "./book-clip-text-export";

const generatedAt = new Date("2026-09-01T12:00:00.000Z");

const sections = [
  { index: 0, title: "Chapter 1", startMs: 0, endMs: 600_000 },
  { index: 1, title: "Chapter 2", startMs: 600_000, endMs: 1_200_000 },
];

const segments = [
  { id: 1, sectionIndex: 0, startMs: 10_000, endMs: 14_000, text: "The first passage." },
  { id: 2, sectionIndex: 0, startMs: 14_000, endMs: 18_000, text: "It continues here." },
  { id: 3, sectionIndex: 1, startMs: 700_000, endMs: 704_000, text: "A later passage." },
];

const build = (input: Partial<Parameters<typeof buildBookClipTextExport>[0]> = {}) =>
  buildBookClipTextExport({
    bookTitle: "A Wizard of Earthsea",
    bookAuthor: "Ursula K. Le Guin",
    clips: [],
    sections,
    segments,
    frontierMs: 1_200_000,
    generatedAt,
    ...input,
  });

describe("buildBookClipTextExport", () => {
  it("renders a covered clip with its chapter, range, text and note", () => {
    const { body, coveredCount, uncoveredCount } = build({
      clips: [
        {
          bookmarkTitle: "The naming",
          startTimeSeconds: 10,
          endTimeSeconds: 18,
          note: "Worth revisiting",
        },
      ],
    });

    expect(coveredCount).toBe(1);
    expect(uncoveredCount).toBe(0);
    expect(body).toContain("# A Wizard of Earthsea");
    expect(body).toContain("*Ursula K. Le Guin*");
    expect(body).toContain("*Text derived from the Book Transcript.*");
    expect(body).toContain("## The naming");
    expect(body).toContain("*Chapter 1 — 00:00:10 – 00:00:18*");
    expect(body).toContain("The first passage. It continues here.");
    expect(body).toContain("> Worth revisiting");
  });

  it("orders clips by Clip Range start, not creation order", () => {
    const { body } = build({
      clips: [
        { bookmarkTitle: "Later", startTimeSeconds: 700, endTimeSeconds: 704 },
        { bookmarkTitle: "Earlier", startTimeSeconds: 10, endTimeSeconds: 18 },
      ],
    });
    expect(body.indexOf("## Earlier")).toBeLessThan(body.indexOf("## Later"));
  });

  it("marks clips beyond the frontier instead of omitting them", () => {
    const { body, coveredCount, uncoveredCount } = build({
      frontierMs: 60_000,
      clips: [
        { bookmarkTitle: "Covered", startTimeSeconds: 10, endTimeSeconds: 18 },
        { bookmarkTitle: "Beyond", startTimeSeconds: 700, endTimeSeconds: 704, note: "Mine" },
      ],
    });

    expect(coveredCount).toBe(1);
    expect(uncoveredCount).toBe(1);
    expect(body).toContain("## Beyond");
    expect(body).toContain("*Not yet transcribed.*");
    // ADR 0036: the user's own words survive whether or not transcription got there.
    expect(body).toContain("> Mine");
    expect(body).toContain(
      "*Transcribed through 00:01:00 — 1 of 2 clips is not yet transcribed.*",
    );
  });

  it("carries no coverage line when every clip is covered", () => {
    const { body } = build({
      clips: [{ bookmarkTitle: "Covered", startTimeSeconds: 10, endTimeSeconds: 18 }],
    });
    expect(body).not.toContain("Transcribed through");
  });

  it("says so when a covered clip holds no words", () => {
    const { body } = build({
      clips: [{ bookmarkTitle: "Silence", startTimeSeconds: 300, endTimeSeconds: 320 }],
    });
    expect(body).toContain("*No speech in this clip.*");
  });
});
