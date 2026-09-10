import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseTranscriptArtifact,
  TranscriptArtifactError,
} from "./transcript-artifact";

const miniArtifact = require("./__fixtures__/laabs.transcript.mini.json") as unknown;

const REAL_ARTIFACT_PATH = path.resolve(
  __dirname,
  "../../../../MacOS/LAABS Audio Align/artifacts/laabs.transcript.json",
);

describe("parseTranscriptArtifact", () => {
  it("parses a format-v2 artifact, treating omitted keys as null and normalizing locale", () => {
    const artifact = parseTranscriptArtifact(miniArtifact);

    expect(artifact.formatVersion).toBe(2);
    expect(artifact.kind).toBe("transcript");
    expect(artifact.localeIdentifier).toBe("en-US");
    expect(artifact.bookTitle).toBe("Any Way You Can");
    expect(artifact.bookAuthor).toBe("Dr. Annette Bosworth");
    expect(artifact.libraryItemId).toBeNull();
    expect(artifact.asr).toEqual({ engine: "speechanalyzer", model: null, chunking: null });
    expect(artifact.tracks).toEqual([
      {
        filename: "book.m4b",
        index: 0,
        startOffsetMs: 0,
        durationMs: 28941800,
        ino: null,
      },
    ]);
    expect(artifact.segments).toHaveLength(2);
    expect(artifact.segments[0]?.words).toEqual([
      [0, 840, "This"],
      [840, 1140, "is"],
      [1140, 1920, "Audible."],
    ]);
    expect(artifact.segments[1]?.s).toBe("repetition");
    expect(artifact.segments[1]?.words).toBeNull();
  });

  it("parses JSON text the same as an already-parsed object", () => {
    const fromText = parseTranscriptArtifact(JSON.stringify(miniArtifact));
    const fromObject = parseTranscriptArtifact(miniArtifact);
    expect(fromText).toEqual(fromObject);
  });

  it("rejects a version 1 artifact", () => {
    expect(() => parseTranscriptArtifact({ ...miniArtifact, formatVersion: 1 })).toThrow(
      TranscriptArtifactError,
    );
  });

  it("rejects non-JSON text", () => {
    try {
      parseTranscriptArtifact("{not json");
      throw new Error("expected parse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TranscriptArtifactError);
      expect((error as TranscriptArtifactError).code).toBe("not_json");
    }
  });
});

const describeRealArtifact = fs.existsSync(REAL_ARTIFACT_PATH) ? describe : describe.skip;

describeRealArtifact("parseTranscriptArtifact against the 8-hour sample", () => {
  it("parses 5,298 segments and 34 sections without dropping word timings", () => {
    const started = Date.now();
    const artifact = parseTranscriptArtifact(fs.readFileSync(REAL_ARTIFACT_PATH, "utf8"));
    const elapsedMs = Date.now() - started;

    expect(artifact.transcriptId).toBe(
      "sha256:8c10273e94e18370a12d51df136c0fc5c11e15638739df5be2219184c4210cae",
    );
    expect(artifact.localeIdentifier).toBe("en-US");
    expect(artifact.sections).toHaveLength(34);
    expect(artifact.segments).toHaveLength(5298);
    expect(artifact.tracks[0]?.filename).toBe("book.m4b");
    expect(artifact.segments[0]?.text).toBe("This is Audible.");
    expect(artifact.segments[0]?.words).toHaveLength(3);
    expect(artifact.segments.every((segment) => segment.words !== null)).toBe(true);
    // Parse cost is the thing to watch on a phone; this bound is a canary, not a budget.
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
