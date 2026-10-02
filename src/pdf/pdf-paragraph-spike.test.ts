const fixturePath =
  "./__fixtures__/beyond-positive-thinking.pdf-paragraphs.json";

describe("optional PDF paragraph spike", () => {
  afterEach(() => jest.dontMock(fixturePath));

  it.each([
    () => ({ kind: "broken" }),
    () => {
      throw new Error("Sidecar unavailable");
    },
  ])(
    "leaves page following available when the sidecar is bad or missing",
    (factory) => {
      jest.doMock(fixturePath, factory);
      jest.isolateModules(() => {
        // The isolated module must load after its optional sidecar mock is installed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { pdfParagraphSpike } = require("./pdf-paragraph-spike");
        expect(pdfParagraphSpike("a".repeat(64), 210)).toBeNull();
      });
    },
  );
});
