import { resolveAgainstOpf } from "./epub-manifest";

describe("resolveAgainstOpf", () => {
  it("resolves against the OPF's own directory", () => {
    expect(resolveAgainstOpf("OEBPS/content.opf", "ch01.xhtml")).toBe("OEBPS/ch01.xhtml");
    expect(resolveAgainstOpf("OEBPS/content.opf", "text/ch01.xhtml")).toBe("OEBPS/text/ch01.xhtml");
  });

  it("walks back out of the OPF directory", () => {
    expect(resolveAgainstOpf("OEBPS/pkg/content.opf", "../text/ch01.xhtml")).toBe(
      "OEBPS/text/ch01.xhtml",
    );
  });

  it("handles an OPF at the root of the zip", () => {
    expect(resolveAgainstOpf("content.opf", "ch01.xhtml")).toBe("ch01.xhtml");
  });

  it("ignores redundant segments", () => {
    expect(resolveAgainstOpf("OEBPS/content.opf", "./text//ch01.xhtml")).toBe(
      "OEBPS/text/ch01.xhtml",
    );
  });
});
