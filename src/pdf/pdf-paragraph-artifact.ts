import type { DecorationGroup } from "react-native-readium";
import type { PdfPageTiming } from "./pdf-page-artifact";
import { pdfPageLocator } from "./pdf-page-sync";

export type PdfLineRect = readonly [number, number, number, number];
export type PdfParagraph = {
  p: number;
  i: number;
  prov: "m" | "i" | "u";
  c: number | null;
  timing: PdfPageTiming | null;
  rects: PdfLineRect[];
};
export type PdfParagraphArtifact = {
  pageMapAlignmentId: string;
  degraded: boolean;
  pdf: { sha256: string; pageCount: number };
  paragraphs: PdfParagraph[];
};

const invalid = (message: string): never => {
  throw new Error(`Invalid PDF paragraph map: ${message}`);
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid("expected an object");
const integer = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid("expected a nonnegative integer");

/** Provisional sidecar, parsed independently of the physical page map. */
export const parsePdfParagraphArtifact = (
  input: unknown,
): PdfParagraphArtifact => {
  const raw = object(typeof input === "string" ? JSON.parse(input) : input);
  if (raw.kind !== "pdf-paragraph-alignment" || raw.formatVersion !== 1)
    invalid("unsupported kind or formatVersion");
  const space = object(raw.rectSpace);
  if (
    space.origin !== "bottom-left" ||
    space.box !== "cropBox" ||
    space.unit !== "millipoint"
  )
    invalid("unsupported rectangle space");
  const derived = object(raw.derivedFrom);
  const pdf = object(derived.pdf);
  if (
    typeof derived.pageMapAlignmentId !== "string" ||
    !derived.pageMapAlignmentId
  )
    invalid("missing source page-map alignment ID");
  const quality = object(raw.quality);
  if (typeof quality.degraded !== "boolean") invalid("missing quality flag");
  if (typeof pdf.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(pdf.sha256))
    invalid("expected lowercase PDF SHA-256");
  const pageCount = integer(pdf.pageCount);
  if (!pageCount || !Array.isArray(raw.paragraphs))
    invalid("missing pages or paragraphs");
  let previousPage = -1;
  let previousIndex = -1;
  const paragraphs = (raw.paragraphs as unknown[]).map(
    (value): PdfParagraph => {
      const record = object(value);
      const p = integer(record.p);
      const i = integer(record.i);
      if (
        p >= pageCount ||
        p < previousPage ||
        i !== (p === previousPage ? previousIndex + 1 : 0)
      )
        invalid(
          "paragraphs must be in physical page order with consecutive indices",
        );
      previousPage = p;
      previousIndex = i;
      const prov = record.prov;
      if (prov !== "m" && prov !== "i" && prov !== "u")
        invalid("unknown provenance");
      const c = record.c;
      if (
        prov !== "u" &&
        (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1)
      )
        invalid("missing match fraction");
      if (prov === "i" && c !== 0)
        invalid("interpolated match fraction must be zero");
      const keys = [
        "startMs",
        "endMs",
        "trackIndex",
        "trackStartMs",
        "trackEndMs",
      ] as const;
      const present = keys.filter((key) => record[key] !== undefined).length;
      if (present !== (prov === "u" ? 0 : keys.length))
        invalid("timing does not agree with provenance");
      const timing =
        prov === "u"
          ? null
          : {
              startMs: integer(record.startMs),
              endMs: integer(record.endMs),
              trackIndex: integer(record.trackIndex),
              trackStartMs: integer(record.trackStartMs),
              trackEndMs: integer(record.trackEndMs),
            };
      if (
        timing &&
        (timing.endMs < timing.startMs ||
          timing.trackEndMs < timing.trackStartMs)
      )
        invalid("reversed timing");
      if (!Array.isArray(record.rects) || !record.rects.length)
        invalid("missing line rectangles");
      const rects = (record.rects as unknown[]).map((rect): PdfLineRect => {
        if (
          !Array.isArray(rect) ||
          rect.length !== 4 ||
          !rect.every(
            (n) => typeof n === "number" && Number.isSafeInteger(n),
          ) ||
          rect[2] <= 0 ||
          rect[3] <= 0
        )
          invalid("invalid millipoint line rectangle");
        // Signed origins are legal; clip rectangles to the page at rendering time.
        return rect as unknown as PdfLineRect;
      });
      return {
        p,
        i,
        prov: prov as PdfParagraph["prov"],
        c: typeof c === "number" ? c : null,
        timing,
        rects,
      };
    },
  );
  return {
    pageMapAlignmentId: derived.pageMapAlignmentId as string,
    degraded: quality.degraded as boolean,
    pdf: { sha256: pdf.sha256 as string, pageCount },
    paragraphs,
  };
};

export const pdfParagraphsMatchDocument = (
  artifact: PdfParagraphArtifact,
  hash: string,
  pageCount: number,
): boolean =>
  artifact.pdf.sha256 === hash && artifact.pdf.pageCount === pageCount;

/** Private transport to our iOS PDF overlay; never enters EPUB's DecorableNavigator. */
export const pdfParagraphDecorations = (
  artifact: PdfParagraphArtifact,
  paragraph: PdfParagraph | null,
  href: string,
): DecorationGroup[] => [
  {
    name: "laabs-pdf-paragraph",
    decorations: paragraph
      ? [
          {
            id: `${paragraph.p}:${paragraph.i}`,
            locator: pdfPageLocator(href, paragraph.p),
            style: { type: "highlight" },
            extras: {
              pageIndex: String(paragraph.p),
              pageCount: String(artifact.pdf.pageCount),
              rects: JSON.stringify(paragraph.rects),
            },
          },
        ]
      : [],
  },
];
