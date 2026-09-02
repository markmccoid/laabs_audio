/**
 * Shared paragraph rule for Book Transcript text.
 *
 * SpeechAnalyzer emits sentence-ish Transcript Segments with no paragraph
 * structure, so every surface that renders transcript prose has to invent the
 * same one: a gap of more than {@link PARAGRAPH_GAP_MS} between segments reads
 * as a paragraph break. Transcript EPUB Export and Clip Transcription's
 * transcript-derived path (ADR 0036) both need it, and two copies of the rule
 * would let the same book render differently in two exports.
 */

/** A gap wider than this between consecutive segments starts a new paragraph. */
export const PARAGRAPH_GAP_MS = 2000;

/** The timing/text shape the paragraph rule needs — book-absolute ms. */
export type ParagraphSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

/** Group segments into paragraphs, starting a new paragraph on a >2s gap. */
export const groupSegmentsIntoParagraphs = (segments: ParagraphSegment[]): string[] => {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let previousEndMs: number | null = null;

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;

    if (previousEndMs !== null && segment.startMs - previousEndMs > PARAGRAPH_GAP_MS) {
      if (current.length) paragraphs.push(current.join(" "));
      current = [];
    }

    current.push(text);
    previousEndMs = segment.endMs;
  }

  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs;
};
