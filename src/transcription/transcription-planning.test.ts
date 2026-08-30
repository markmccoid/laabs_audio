import type { Chapter } from "@/types/absTypes";
import type { BookTranscriptionSegment } from "@/native/book-transcriber/BookTranscriber.types";
import {
  isResumableTranscriptValid,
  mapSegmentsToBookAbsolute,
  planTranscriptionSections,
  resolveBookLocale,
  resolveSectionIndexForStartMs,
  toTranscriptionPlanTracks,
  type TranscriptionSourceTrack,
} from "./transcription-planning";

// This suite is deliberately import-clean: `transcription-planning` pulls in
// nothing but types and `buildChapterIndex`, so no MMKV / SQLite / native mocks.

const sourceTrack = (
  ino: string,
  startOffset: number,
  duration: number,
): TranscriptionSourceTrack => ({ ino, startOffset, duration });

const chapter = (id: number, title: string, start: number, end: number): Chapter => ({
  id,
  title,
  start,
  end,
});

const nativeSegment = (
  text: string,
  startSeconds: number,
  endSeconds: number,
  words: BookTranscriptionSegment["words"] = [],
): BookTranscriptionSegment => ({ text, startSeconds, endSeconds, words });

/** Two 30-minute files; chapter 3 starts exactly on the file boundary. */
const twoFileTracks = [sourceTrack("ino-1", 0, 1800), sourceTrack("ino-2", 1800, 1800)];
const boundaryChapters = [
  chapter(0, "Chapter One", 0, 900),
  chapter(1, "Chapter Two", 900, 1800),
  chapter(2, "Chapter Three", 1800, 2700),
  chapter(3, "Chapter Four", 2700, 3600),
];

describe("planTranscriptionSections", () => {
  it("freezes chapter sections, including a chapter starting exactly at a file boundary", () => {
    const plan = planTranscriptionSections({
      chapters: boundaryChapters,
      tracks: twoFileTracks,
    });

    expect(plan.sourceStructure).toBe("chapters");
    expect(plan.sections).toEqual([
      { index: 0, title: "Chapter One", startMs: 0, endMs: 900_000 },
      { index: 1, title: "Chapter Two", startMs: 900_000, endMs: 1_800_000 },
      { index: 2, title: "Chapter Three", startMs: 1_800_000, endMs: 2_700_000 },
      { index: 3, title: "Chapter Four", startMs: 2_700_000, endMs: 3_600_000 },
    ]);
  });

  it("falls back to one 'Part N' section per audio file when the book has no chapters", () => {
    const plan = planTranscriptionSections({
      chapters: [],
      tracks: [
        sourceTrack("ino-1", 0, 600),
        sourceTrack("ino-2", 600, 600),
        sourceTrack("ino-3", 1200, 300),
      ],
    });

    expect(plan.sourceStructure).toBe("files");
    expect(plan.sections).toEqual([
      { index: 0, title: "Part 1", startMs: 0, endMs: 600_000 },
      { index: 1, title: "Part 2", startMs: 600_000, endMs: 1_200_000 },
      { index: 2, title: "Part 3", startMs: 1_200_000, endMs: 1_500_000 },
    ]);
  });

  it("gives a single-file chapterless book one section spanning the whole book", () => {
    const plan = planTranscriptionSections({
      chapters: undefined,
      tracks: [sourceTrack("ino-only", 0, 43_200)],
    });

    expect(plan.sourceStructure).toBe("files");
    expect(plan.sections).toEqual([
      { index: 0, title: "Part 1", startMs: 0, endMs: 43_200_000 },
    ]);
  });
});

describe("toTranscriptionPlanTracks", () => {
  it("converts ordered tracks to ms rows with sequential track indexes", () => {
    expect(toTranscriptionPlanTracks(twoFileTracks)).toEqual([
      { trackIno: "ino-1", trackIndex: 0, startOffsetMs: 0, durationMs: 1_800_000 },
      { trackIno: "ino-2", trackIndex: 1, startOffsetMs: 1_800_000, durationMs: 1_800_000 },
    ]);
  });
});

describe("resolveSectionIndexForStartMs", () => {
  const { sections } = planTranscriptionSections({
    chapters: boundaryChapters,
    tracks: twoFileTracks,
  });

  it("assigns a position inside a section to that section", () => {
    expect(resolveSectionIndexForStartMs(sections, 1_000_000)).toBe(1);
  });

  it("assigns a position exactly on a section boundary to the section it opens", () => {
    expect(resolveSectionIndexForStartMs(sections, 1_800_000)).toBe(2);
  });

  it("clamps positions before the first and after the last section", () => {
    expect(resolveSectionIndexForStartMs(sections, -5)).toBe(0);
    expect(resolveSectionIndexForStartMs(sections, 9_999_999)).toBe(3);
  });
});

describe("mapSegmentsToBookAbsolute", () => {
  const { sections } = planTranscriptionSections({
    chapters: boundaryChapters,
    tracks: twoFileTracks,
  });

  it("shifts file-relative seconds to book-absolute ms using the track offset", () => {
    const mapped = mapSegmentsToBookAbsolute({
      segments: [nativeSegment("Hello there.", 12.25, 15.5)],
      trackStartOffsetMs: 1_800_000,
      sections,
    });

    expect(mapped).toEqual([
      {
        sectionIndex: 2,
        startMs: 1_812_250,
        endMs: 1_815_500,
        text: "Hello there.",
        words: null,
      },
    ]);
  });

  it("keeps a segment straddling a section boundary in the section containing its start", () => {
    const mapped = mapSegmentsToBookAbsolute({
      // 890.5s–905.25s into file 2 => 2,690,500ms–2,705,250ms, crossing 2,700,000ms.
      segments: [nativeSegment("Across the boundary.", 890.5, 905.25)],
      trackStartOffsetMs: 1_800_000,
      sections,
    });

    expect(mapped[0]).toMatchObject({
      sectionIndex: 2,
      startMs: 2_690_500,
      endMs: 2_705_250,
    });
  });

  it("shifts word timings to book-absolute ms and drops blank segments", () => {
    const mapped = mapSegmentsToBookAbsolute({
      segments: [
        nativeSegment("   ", 1, 2),
        nativeSegment("Two words", 3, 4, [
          { text: "Two", startSeconds: 3, endSeconds: 3.4 },
          { text: "words", startSeconds: 3.4, endSeconds: 4 },
        ]),
      ],
      trackStartOffsetMs: 1_800_000,
      sections,
    });

    expect(mapped).toHaveLength(1);
    expect(mapped[0].words).toEqual([
      [1_803_000, 1_803_400, "Two"],
      [1_803_400, 1_804_000, "words"],
    ]);
  });
});

describe("isResumableTranscriptValid", () => {
  const { sections, sourceStructure } = planTranscriptionSections({
    chapters: boundaryChapters,
    tracks: twoFileTracks,
  });
  const plannedTracks = toTranscriptionPlanTracks(twoFileTracks);

  it("accepts a stored transcript whose pending tracks still match the download", () => {
    expect(
      isResumableTranscriptValid({
        storedSections: sections,
        storedSourceStructure: sourceStructure,
        pendingTracks: [plannedTracks[1]],
        plannedSections: sections,
        plannedSourceStructure: sourceStructure,
        plannedTracks,
      }),
    ).toBe(true);
  });

  it("rejects a stored transcript whose pending track duration changed", () => {
    expect(
      isResumableTranscriptValid({
        storedSections: sections,
        storedSourceStructure: sourceStructure,
        pendingTracks: [{ ...plannedTracks[1], durationMs: 1_234_000 }],
        plannedSections: sections,
        plannedSourceStructure: sourceStructure,
        plannedTracks,
      }),
    ).toBe(false);
  });

  it("rejects a stored transcript whose track ino is gone from the download", () => {
    expect(
      isResumableTranscriptValid({
        storedSections: sections,
        storedSourceStructure: sourceStructure,
        pendingTracks: [{ ...plannedTracks[1], trackIno: "ino-replaced" }],
        plannedSections: sections,
        plannedSourceStructure: sourceStructure,
        plannedTracks,
      }),
    ).toBe(false);
  });
});

describe("resolveBookLocale", () => {
  const withLanguage = (language: string | null | undefined) => ({
    media: { metadata: { language } },
  });

  it.each(["English", "english", "eng", "en", "  EN  "])(
    "maps the English variant %p to en-US without guessing",
    (language) => {
      expect(resolveBookLocale(withLanguage(language))).toEqual({
        localeIdentifier: "en-US",
        isNonEnglish: false,
        isGuess: false,
      });
    },
  );

  it.each(["German", "deu", "de", "Deutsch"])(
    "maps the German variant %p to de-DE and flags it non-English",
    (language) => {
      expect(resolveBookLocale(withLanguage(language))).toEqual({
        localeIdentifier: "de-DE",
        isNonEnglish: true,
        isGuess: false,
      });
    },
  );

  it("keeps a region-qualified tag's region", () => {
    expect(resolveBookLocale(withLanguage("en_GB"))).toEqual({
      localeIdentifier: "en-GB",
      isNonEnglish: false,
      isGuess: false,
    });
    expect(resolveBookLocale(withLanguage("pt-BR"))).toEqual({
      localeIdentifier: "pt-BR",
      isNonEnglish: true,
      isGuess: false,
    });
  });

  it.each(["", "   ", "Klingon", "unknown-language-42"])(
    "falls back to guessed en-US for the unusable value %p",
    (language) => {
      expect(resolveBookLocale(withLanguage(language))).toEqual({
        localeIdentifier: "en-US",
        isNonEnglish: false,
        isGuess: true,
      });
    },
  );

  it("falls back to guessed en-US when metadata is missing entirely", () => {
    expect(resolveBookLocale(null)).toEqual({
      localeIdentifier: "en-US",
      isNonEnglish: false,
      isGuess: true,
    });
    expect(resolveBookLocale(withLanguage(null))).toEqual({
      localeIdentifier: "en-US",
      isNonEnglish: false,
      isGuess: true,
    });
  });

  it("maps the other common languages the plan calls out", () => {
    const map: Record<string, string> = {
      French: "fr-FR",
      fra: "fr-FR",
      Spanish: "es-ES",
      Italian: "it-IT",
      Portuguese: "pt-PT",
      Dutch: "nl-NL",
      Swedish: "sv-SE",
      Norwegian: "nb-NO",
      Danish: "da-DK",
      Japanese: "ja-JP",
      Chinese: "zh-CN",
      Korean: "ko-KR",
    };
    Object.entries(map).forEach(([language, expected]) => {
      expect(resolveBookLocale(withLanguage(language)).localeIdentifier).toBe(expected);
    });
  });
});
