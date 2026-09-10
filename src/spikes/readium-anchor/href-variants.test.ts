import { buildHrefVariants, describeHrefForm } from "./href-variants";

describe("buildHrefVariants", () => {
  it("covers both slash forms and the bare filename", () => {
    const hrefs = buildHrefVariants("OEBPS/ch01.xhtml").map((variant) => variant.href);

    expect(hrefs).toContain("OEBPS/ch01.xhtml");
    expect(hrefs).toContain("/OEBPS/ch01.xhtml");
    expect(hrefs).toContain("ch01.xhtml");
  });

  it("splits the fragment off so the resource form can be tried on its own", () => {
    const hrefs = buildHrefVariants("/OEBPS/ch01.xhtml#pgepubid00005").map(
      (variant) => variant.href,
    );

    expect(hrefs[0]).toBe("/OEBPS/ch01.xhtml#pgepubid00005");
    expect(hrefs).toContain("/OEBPS/ch01.xhtml");
    expect(hrefs).toContain("OEBPS/ch01.xhtml");
  });

  it("offers both encodings when the href is escaped", () => {
    const hrefs = buildHrefVariants("OEBPS/chapter%20one.xhtml").map((variant) => variant.href);

    expect(hrefs).toContain("OEBPS/chapter%20one.xhtml");
    expect(hrefs).toContain("OEBPS/chapter one.xhtml");
  });

  it("drops duplicates so a plain href produces a short list", () => {
    const hrefs = buildHrefVariants("ch01.xhtml").map((variant) => variant.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(["ch01.xhtml", "/ch01.xhtml"]);
  });

  it("returns nothing for an empty href", () => {
    expect(buildHrefVariants("  ")).toEqual([]);
  });
});

describe("describeHrefForm", () => {
  it("names the parts that the aligner has to reproduce", () => {
    expect(describeHrefForm("/OEBPS/chapter%20one.xhtml#frag")).toBe(
      "leading slash, path-qualified, percent-encoded, carries a fragment",
    );
    expect(describeHrefForm("ch01.xhtml")).toBe("no leading slash, bare filename");
  });
});
