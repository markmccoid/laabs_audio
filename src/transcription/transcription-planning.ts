import { buildChapterIndex } from "@/player/chapters";
import type { AudioTrack, Chapter } from "@/types/absTypes";
import type { BookTranscriptionSegment } from "@/native/book-transcriber/BookTranscriber.types";
import type {
  BookTranscriptSection,
  BookTranscriptSourceStructure,
  BookTranscriptTrackRow,
  TranscriptSegmentInput,
  TranscriptSegmentWordTiming,
} from "@/data/sqlite/shadow-db-transcripts";

/**
 * Pure Book Transcript planning logic (docs/book-transcript-implementation-plan.md
 * Phase 3). Deliberately import-clean — only types and `buildChapterIndex` —
 * so it is unit-testable without mocking MMKV, SQLite, or the native module.
 * The side-effecting orchestrator lives in `./book-transcription.ts`.
 */

export const DEFAULT_TRANSCRIPTION_LOCALE = "en-US";

/**
 * One audio file as the planner sees it: seconds, with `startOffset` ALREADY
 * recomputed as a rolling offset (`resolveExportTracks` in
 * `src/sharing/clip-export.ts`). Raw `DownloadTrack.startOffset` is all-zero on
 * older MP3 downloads and must never reach the planner untouched.
 */
export type TranscriptionSourceTrack = {
  ino: string;
  startOffset: number;
  duration: number;
};

/** A planned track row, in the ms shape `book_transcript_tracks` persists. */
export type TranscriptionPlanTrack = {
  trackIno: string;
  trackIndex: number;
  startOffsetMs: number;
  durationMs: number;
};

export type TranscriptionSectionPlan = {
  sections: BookTranscriptSection[];
  sourceStructure: BookTranscriptSourceStructure;
};

export type ResolvedBookLocale = {
  localeIdentifier: string;
  isNonEnglish: boolean;
  /** True when metadata gave us nothing usable and we fell back to English. */
  isGuess: boolean;
};

/** The subset of an `ItemDetails` the locale resolver reads. */
export type BookLocaleDetails = {
  media?: { metadata?: { language?: string | null } | null } | null;
} | null;

const secondsToMs = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value * 1000)) : 0;

//~~ ========================================================
//~~ Track planning
//~~ ========================================================

/**
 * Convert ordered, offset-recomputed tracks into the ms rows persisted in
 * `book_transcript_tracks`. Order is the caller's order (book order).
 */
export const toTranscriptionPlanTracks = (
  tracks: TranscriptionSourceTrack[],
): TranscriptionPlanTrack[] =>
  tracks.map((track, trackIndex) => ({
    trackIno: track.ino,
    trackIndex,
    startOffsetMs: secondsToMs(track.startOffset),
    durationMs: secondsToMs(track.duration),
  }));

//~~ ========================================================
//~~ Section planning
//~~ ========================================================

/**
 * Freeze the Book Transcript's sections at start time: real chapters when the
 * book has them, otherwise one "Part N" section per audio file (plan: chapterless
 * books). A single-file chapterless book therefore gets one giant section.
 */
export const planTranscriptionSections = ({
  chapters,
  tracks,
}: {
  chapters?: Chapter[] | null;
  tracks: TranscriptionSourceTrack[];
}): TranscriptionSectionPlan => {
  if (chapters?.length) {
    // buildChapterIndex only reads `startOffset`/`duration` off each track.
    const chapterIndex = buildChapterIndex(chapters, tracks as unknown as AudioTrack[]);
    if (chapterIndex.length) {
      return {
        sourceStructure: "chapters",
        sections: chapterIndex.map((chapter, index) => ({
          index,
          title: chapter.title?.trim() || `Chapter ${index + 1}`,
          startMs: chapter.startMs,
          endMs: Math.max(chapter.startMs, chapter.endMs),
        })),
      };
    }
  }

  return {
    sourceStructure: "files",
    sections: toTranscriptionPlanTracks(tracks).map((track, index) => ({
      index,
      title: `Part ${index + 1}`,
      startMs: track.startOffsetMs,
      endMs: track.startOffsetMs + track.durationMs,
    })),
  };
};

/**
 * The section a Transcript Segment belongs to, decided by its START only — a
 * segment straddling a section boundary belongs to the section it starts in.
 */
export const resolveSectionIndexForStartMs = (
  sections: BookTranscriptSection[],
  startMs: number,
): number => {
  if (!sections.length) return 0;

  let resolved = 0;
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].startMs <= startMs) {
      resolved = i;
    } else {
      break;
    }
  }
  return sections[resolved]?.index ?? resolved;
};

//~~ ========================================================
//~~ Segment mapping
//~~ ========================================================

const toWordTimings = (
  segment: BookTranscriptionSegment,
  trackStartOffsetMs: number,
): TranscriptSegmentWordTiming[] | null => {
  if (!segment.words?.length) return null;
  return segment.words.map((word) => [
    trackStartOffsetMs + secondsToMs(word.startSeconds),
    Math.max(
      trackStartOffsetMs + secondsToMs(word.startSeconds),
      trackStartOffsetMs + secondsToMs(word.endSeconds),
    ),
    word.text,
  ]);
};

/**
 * Map one file's native segments (file-relative seconds) into book-absolute
 * Transcript Segments, assigning each a frozen section by its start.
 */
export const mapSegmentsToBookAbsolute = ({
  segments,
  trackStartOffsetMs,
  sections,
}: {
  segments: BookTranscriptionSegment[];
  trackStartOffsetMs: number;
  sections: BookTranscriptSection[];
}): TranscriptSegmentInput[] =>
  segments.flatMap((segment) => {
    const text = segment.text?.trim() ?? "";
    if (!text) return [];

    const startMs = trackStartOffsetMs + secondsToMs(segment.startSeconds);
    const endMs = Math.max(startMs, trackStartOffsetMs + secondsToMs(segment.endSeconds));

    return [
      {
        sectionIndex: resolveSectionIndexForStartMs(sections, startMs),
        startMs,
        endMs,
        text,
        words: toWordTimings(segment, trackStartOffsetMs),
      },
    ];
  });

//~~ ========================================================
//~~ Resume validation
//~~ ========================================================

const sectionsMatch = (a: BookTranscriptSection[], b: BookTranscriptSection[]) =>
  a.length === b.length &&
  a.every((section, index) => {
    const other = b[index];
    return (
      Boolean(other) &&
      section.index === other.index &&
      section.startMs === other.startMs &&
      section.endMs === other.endMs
    );
  });

/**
 * Whether an existing `in_progress` Book Transcript still describes the download
 * on disk. The resume unit is a file, so every still-pending track must match a
 * current track by ino, index, offset and duration, and the frozen section plan
 * must still be the plan we would build today. A mismatch means the download was
 * replaced — the caller deletes the transcript and starts fresh.
 */
export const isResumableTranscriptValid = ({
  storedSections,
  storedSourceStructure,
  pendingTracks,
  plannedSections,
  plannedSourceStructure,
  plannedTracks,
}: {
  storedSections: BookTranscriptSection[];
  storedSourceStructure: BookTranscriptSourceStructure;
  pendingTracks: Pick<
    BookTranscriptTrackRow,
    "trackIno" | "trackIndex" | "startOffsetMs" | "durationMs"
  >[];
  plannedSections: BookTranscriptSection[];
  plannedSourceStructure: BookTranscriptSourceStructure;
  plannedTracks: TranscriptionPlanTrack[];
}): boolean => {
  if (storedSourceStructure !== plannedSourceStructure) return false;
  if (!sectionsMatch(storedSections, plannedSections)) return false;
  if (pendingTracks.length > plannedTracks.length) return false;

  const plannedByIno = new Map(plannedTracks.map((track) => [track.trackIno, track] as const));
  return pendingTracks.every((pending) => {
    const planned = plannedByIno.get(pending.trackIno);
    if (!planned) return false;
    return (
      planned.trackIndex === pending.trackIndex &&
      planned.startOffsetMs === pending.startOffsetMs &&
      planned.durationMs === pending.durationMs
    );
  });
};

//~~ ========================================================
//~~ Locale resolution
//~~ ========================================================

/**
 * Free-form ABS `media.metadata.language` values mapped to a locale we can ask
 * SpeechTranscriber for. Keys are normalized (lowercased, trimmed) names, ISO
 * 639-1 and 639-2 codes, and common endonyms.
 */
const LOCALE_BY_LANGUAGE_TOKEN: Record<string, string> = {
  en: "en-US",
  eng: "en-US",
  english: "en-US",
  de: "de-DE",
  deu: "de-DE",
  ger: "de-DE",
  german: "de-DE",
  deutsch: "de-DE",
  fr: "fr-FR",
  fra: "fr-FR",
  fre: "fr-FR",
  french: "fr-FR",
  francais: "fr-FR",
  "français": "fr-FR",
  es: "es-ES",
  spa: "es-ES",
  spanish: "es-ES",
  espanol: "es-ES",
  "español": "es-ES",
  it: "it-IT",
  ita: "it-IT",
  italian: "it-IT",
  italiano: "it-IT",
  pt: "pt-PT",
  por: "pt-PT",
  portuguese: "pt-PT",
  portugues: "pt-PT",
  "português": "pt-PT",
  nl: "nl-NL",
  nld: "nl-NL",
  dut: "nl-NL",
  dutch: "nl-NL",
  nederlands: "nl-NL",
  sv: "sv-SE",
  swe: "sv-SE",
  swedish: "sv-SE",
  svenska: "sv-SE",
  no: "nb-NO",
  nb: "nb-NO",
  nob: "nb-NO",
  nor: "nb-NO",
  norwegian: "nb-NO",
  norsk: "nb-NO",
  da: "da-DK",
  dan: "da-DK",
  danish: "da-DK",
  dansk: "da-DK",
  fi: "fi-FI",
  fin: "fi-FI",
  finnish: "fi-FI",
  suomi: "fi-FI",
  pl: "pl-PL",
  pol: "pl-PL",
  polish: "pl-PL",
  polski: "pl-PL",
  ru: "ru-RU",
  rus: "ru-RU",
  russian: "ru-RU",
  tr: "tr-TR",
  tur: "tr-TR",
  turkish: "tr-TR",
  ja: "ja-JP",
  jpn: "ja-JP",
  japanese: "ja-JP",
  zh: "zh-CN",
  zho: "zh-CN",
  chi: "zh-CN",
  chinese: "zh-CN",
  mandarin: "zh-CN",
  ko: "ko-KR",
  kor: "ko-KR",
  korean: "ko-KR",
  ar: "ar-SA",
  ara: "ar-SA",
  arabic: "ar-SA",
  hi: "hi-IN",
  hin: "hi-IN",
  hindi: "hi-IN",
  uk: "uk-UA",
  ukr: "uk-UA",
  ukrainian: "uk-UA",
  cs: "cs-CZ",
  ces: "cs-CZ",
  cze: "cs-CZ",
  czech: "cs-CZ",
};

/** One entry in the language picker offered by the start sheet / download sheet. */
export type TranscriptionLanguageOption = {
  localeIdentifier: string;
  label: string;
};

/**
 * The common languages the UI offers when the user overrides the resolved
 * locale. Deliberately a short, curated list rather than every locale
 * `SpeechTranscriber` might support — an unsupported pick still fails cleanly
 * with `locale_unsupported` at start time.
 */
export const TRANSCRIPTION_LANGUAGE_OPTIONS: TranscriptionLanguageOption[] = [
  { localeIdentifier: "en-US", label: "English (US)" },
  { localeIdentifier: "en-GB", label: "English (UK)" },
  { localeIdentifier: "de-DE", label: "German" },
  { localeIdentifier: "fr-FR", label: "French" },
  { localeIdentifier: "es-ES", label: "Spanish" },
  { localeIdentifier: "it-IT", label: "Italian" },
  { localeIdentifier: "pt-PT", label: "Portuguese" },
  { localeIdentifier: "nl-NL", label: "Dutch" },
  { localeIdentifier: "sv-SE", label: "Swedish" },
  { localeIdentifier: "nb-NO", label: "Norwegian" },
  { localeIdentifier: "da-DK", label: "Danish" },
  { localeIdentifier: "fi-FI", label: "Finnish" },
  { localeIdentifier: "pl-PL", label: "Polish" },
  { localeIdentifier: "ru-RU", label: "Russian" },
  { localeIdentifier: "tr-TR", label: "Turkish" },
  { localeIdentifier: "ja-JP", label: "Japanese" },
  { localeIdentifier: "zh-CN", label: "Chinese (Mandarin)" },
  { localeIdentifier: "ko-KR", label: "Korean" },
  { localeIdentifier: "ar-SA", label: "Arabic" },
  { localeIdentifier: "hi-IN", label: "Hindi" },
  { localeIdentifier: "uk-UA", label: "Ukrainian" },
  { localeIdentifier: "cs-CZ", label: "Czech" },
];

/** Human label for a locale, falling back to the raw identifier for overrides. */
export const describeTranscriptionLocale = (localeIdentifier: string) =>
  TRANSCRIPTION_LANGUAGE_OPTIONS.find(
    (option) => option.localeIdentifier.toLowerCase() === localeIdentifier.toLowerCase(),
  )?.label ?? localeIdentifier;

const normalizeLanguageValue = (value: string) =>
  value
    .trim()
    .toLowerCase()
    // ABS sometimes stores "eng; deu" or "English (US)" — keep the first token.
    .split(/[;,/(]/, 1)[0]
    .trim()
    .replace(/_/g, "-");

const buildResolved = (localeIdentifier: string, isGuess: boolean): ResolvedBookLocale => ({
  localeIdentifier,
  isNonEnglish: !localeIdentifier.toLowerCase().startsWith("en"),
  isGuess,
});

/**
 * Resolve the locale to transcribe a book in from its ABS metadata language.
 * Unknown, junk and empty values silently fall back to English (`isGuess: true`)
 * — the start sheet only demands attention when `isNonEnglish` is true.
 */
export const resolveBookLocale = (details: BookLocaleDetails): ResolvedBookLocale => {
  const raw = details?.media?.metadata?.language;
  if (typeof raw !== "string") return buildResolved(DEFAULT_TRANSCRIPTION_LOCALE, true);

  const normalized = normalizeLanguageValue(raw);
  if (!normalized) return buildResolved(DEFAULT_TRANSCRIPTION_LOCALE, true);

  const direct = LOCALE_BY_LANGUAGE_TOKEN[normalized];
  if (direct) return buildResolved(direct, false);

  // Region-qualified tags such as "en-GB", "pt_BR", "zh-Hant".
  const tagged = /^([a-z]{2,3})-([a-z]{2}|[a-z]{4})$/.exec(normalized);
  if (tagged) {
    const base = LOCALE_BY_LANGUAGE_TOKEN[tagged[1]];
    if (base) {
      const region = tagged[2];
      const suffix = region.length === 2 ? region.toUpperCase() : `${region[0].toUpperCase()}${region.slice(1)}`;
      return buildResolved(`${base.split("-")[0]}-${suffix}`, false);
    }
  }

  return buildResolved(DEFAULT_TRANSCRIPTION_LOCALE, true);
};
