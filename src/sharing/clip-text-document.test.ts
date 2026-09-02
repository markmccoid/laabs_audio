import { buildClipTranscriptExportBody } from "./clip-transcript-export";

const generatedAt = new Date("2026-09-01T12:00:00.000Z");

describe("Clip Transcript Export document", () => {
  it("renders a transcript-derived clip with chapter and note", () => {
    const body = buildClipTranscriptExportBody({
      bookTitle: "A Wizard of Earthsea",
      bookmarkTitle: "The naming",
      range: { startTimeSeconds: 6914, endTimeSeconds: 7000 },
      text: "The first passage.",
      source: "transcript",
      sectionTitle: "Chapter 12",
      note: "Worth revisiting",
      generatedAt,
    });

    expect(body).toContain("# A Wizard of Earthsea");
    expect(body).toContain("*Text derived from the Book Transcript.*");
    expect(body).toContain("## The naming");
    expect(body).toContain("*Chapter 12 — 01:55:14 – 01:56:40*");
    expect(body).toContain("The first passage.");
    expect(body).toContain("> Worth revisiting");
  });

  it("states the recognized source for an episode clip", () => {
    // Episodes have no Book Transcript (ADR 0036 is books-only), so this path
    // is always speech recognized from the clip's audio.
    const body = buildClipTranscriptExportBody({
      bookTitle: "Show - Episode 1",
      sourceLabel: "Episode",
      sourceTitle: "Episode 1",
      secondaryTitle: "Show",
      bookmarkTitle: "The bit",
      range: { startTimeSeconds: 30, endTimeSeconds: 60 },
      text: "Recognized words.",
      source: "recognized",
      generatedAt,
    });

    expect(body).toContain("# Episode 1");
    expect(body).toContain("*Show*");
    expect(body).toContain("*Text transcribed from clip audio.*");
    expect(body).toContain("*00:00:30 – 00:01:00*");
  });

  it("says so when a covered clip holds no words", () => {
    const body = buildClipTranscriptExportBody({
      bookTitle: "A Wizard of Earthsea",
      bookmarkTitle: "Silence",
      range: { startTimeSeconds: 0, endTimeSeconds: 20 },
      text: "   ",
      source: "transcript",
      generatedAt,
    });
    expect(body).toContain("*No speech in this clip.*");
  });
});
