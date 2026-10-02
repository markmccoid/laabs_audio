import sample from "./__fixtures__/beyond-positive-thinking.pdf-paragraphs.json";
import pageSample from "./__fixtures__/beyond-positive-thinking.pdf-pages.json";
import { parsePdfPageArtifact } from "./pdf-page-artifact";
import { loadPdfParagraphArtifact } from "./pdf-paragraph-loader";
import { downloadsApi } from "@/api/downloads-api";
import {
  deletePdfParagraphMap,
  getPdfParagraphMap,
  storePdfParagraphMap,
} from "@/data/sqlite/shadow-db-pdf-paragraphs";
import type { PdfPageSource } from "./use-pdf-page-sources";

jest.mock("@/api/downloads-api", () => ({
  downloadsApi: { getDownloadSpec: jest.fn() },
}));
jest.mock("@/data/sqlite/shadow-db-pdf-paragraphs", () => ({
  deletePdfParagraphMap: jest.fn(),
  getPdfParagraphMap: jest.fn(),
  storePdfParagraphMap: jest.fn(),
}));
const source: PdfPageSource = {
  pdfIno: "pdf",
  pdfFilename: "book.pdf",
  mapIno: "pages",
  paragraphMapIno: "paragraphs",
};
const pages = parsePdfPageArtifact(pageSample);
const json = JSON.stringify(sample);
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const load = (
  selected = source,
  refresh = false,
  signal = new AbortController().signal,
) =>
  loadPdfParagraphArtifact(
    "book",
    selected,
    pages,
    pages.pdf.sha256,
    signal,
    refresh,
  );

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  jest.mocked(getPdfParagraphMap).mockResolvedValue(null);
  jest.mocked(deletePdfParagraphMap).mockResolvedValue(undefined);
  jest.mocked(storePdfParagraphMap).mockResolvedValue(undefined);
  jest.mocked(downloadsApi.getDownloadSpec).mockResolvedValue({
    urlWithToken: "https://example.test/paragraphs",
    authHeader: {},
  } as never);
  fetchMock.mockResolvedValue({ ok: true, text: async () => json });
});
afterAll(() => {
  global.fetch = originalFetch;
});

it("loads and stores original sidecar JSON separately from the page map", async () => {
  expect(await load()).toMatchObject({ pageMapAlignmentId: pages.alignmentId });
  expect(storePdfParagraphMap).toHaveBeenCalledWith(
    "book",
    "pdf",
    pages.alignmentId,
    "paragraphs",
    json,
  );
});
it("uses validated cached paragraphs for offline reopens, without a network request", async () => {
  jest
    .mocked(getPdfParagraphMap)
    .mockResolvedValue({ mapIno: "paragraphs", artifactJson: json });
  expect(await load({ ...source, paragraphMapIno: undefined })).not.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await load()).not.toBeNull();
  expect(await load(source, true)).toBeNull();
});
it.each([404, 410])(
  "does not revive a removed sidecar (%s) from cache",
  async (status) => {
    jest
      .mocked(getPdfParagraphMap)
      .mockResolvedValue({ mapIno: "paragraphs", artifactJson: json });
    fetchMock.mockResolvedValue({ ok: false, status });
    expect(await load()).toBeNull();
    expect(deletePdfParagraphMap).toHaveBeenCalledWith(
      "book",
      "pdf",
      pages.alignmentId,
    );
  },
);
it.each([
  "{broken",
  JSON.stringify({
    ...sample,
    derivedFrom: { ...sample.derivedFrom, pageMapAlignmentId: "wrong" },
  }),
  JSON.stringify({
    ...sample,
    derivedFrom: {
      ...sample.derivedFrom,
      pdf: { ...sample.derivedFrom.pdf, sha256: "a".repeat(64) },
    },
  }),
  JSON.stringify({ ...sample, quality: { ...sample.quality, degraded: true } }),
])(
  "leaves PDF/page following available when the fetched sidecar is bad",
  async (bad) => {
    jest
      .mocked(getPdfParagraphMap)
      .mockResolvedValue({ mapIno: "paragraphs", artifactJson: json });
    fetchMock.mockResolvedValue({ ok: true, text: async () => bad });
    expect(await load()).toBeNull();
    expect(storePdfParagraphMap).not.toHaveBeenCalled();
    expect(deletePdfParagraphMap).toHaveBeenCalledWith(
      "book",
      "pdf",
      pages.alignmentId,
    );
  },
);
it("does not attach a cancelled request or a missing sidecar", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await load(source, false, controller.signal)).toBeNull();
  expect(await load({ ...source, paragraphMapIno: undefined })).toBeNull();
});
