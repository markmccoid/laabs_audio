// Proves Book Transcript planning inherits the zero-`startOffset` MP3 fix from
// `resolveExportTracks`. That helper lives in `clip-export`, which reaches the
// download store, so this file needs the repo's standard MMKV mock — the pure
// planning suite (`transcription-planning.test.ts`) stays mock-free.
jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { resolveExportTracks } from "@/sharing/clip-export";
import {
  planTranscriptionSections,
  toTranscriptionPlanTracks,
} from "./transcription-planning";

const mp3Track = (ino: string, cleanFileName: string, duration: number) => ({
  ino,
  filename: cleanFileName,
  cleanFileName,
  // The wart this test guards: older MP3 downloads persist startOffset 0 on
  // every track, so raw offsets would stack every file at book position 0.
  startOffset: 0,
  duration,
  relativePath: `book_downloads/book-1/${cleanFileName}`,
});

describe("Book Transcript track offsets for zero-startOffset MP3 downloads", () => {
  const downloadInfo = {
    audioTracks: [
      mp3Track("ino-1", "01.mp3", 600),
      mp3Track("ino-2", "02.mp3", 600),
      mp3Track("ino-3", "03.mp3", 300),
    ],
  };

  it("recomputes rolling offsets instead of trusting the stored zeroes", () => {
    const ordered = resolveExportTracks({ downloadInfo, itemDetails: null });

    expect(ordered.map((track) => track.startOffset)).toEqual([0, 600, 1200]);
    expect(
      toTranscriptionPlanTracks(
        ordered.map((track) => ({
          ino: track.ino,
          startOffset: track.startOffset,
          duration: track.duration,
        })),
      ),
    ).toEqual([
      { trackIno: "ino-1", trackIndex: 0, startOffsetMs: 0, durationMs: 600_000 },
      { trackIno: "ino-2", trackIndex: 1, startOffsetMs: 600_000, durationMs: 600_000 },
      { trackIno: "ino-3", trackIndex: 2, startOffsetMs: 1_200_000, durationMs: 300_000 },
    ]);
  });

  it("plans non-overlapping 'Part N' sections from the recomputed offsets", () => {
    const ordered = resolveExportTracks({ downloadInfo, itemDetails: null });
    const plan = planTranscriptionSections({
      chapters: [],
      tracks: ordered.map((track) => ({
        ino: track.ino,
        startOffset: track.startOffset,
        duration: track.duration,
      })),
    });

    expect(plan.sections).toEqual([
      { index: 0, title: "Part 1", startMs: 0, endMs: 600_000 },
      { index: 1, title: "Part 2", startMs: 600_000, endMs: 1_200_000 },
      { index: 2, title: "Part 3", startMs: 1_200_000, endMs: 1_500_000 },
    ]);
  });
});
