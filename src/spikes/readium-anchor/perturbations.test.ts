import {
  isPerturbationInert,
  misspellLongestWord,
  PERTURBATIONS,
  stripNoteRefs,
  toNFD,
} from "./perturbations";

const perturbation = (id: string) => {
  const found = PERTURBATIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No perturbation ${id}`);
  return found;
};

describe("E3 perturbations", () => {
  it("leaves the control untouched", () => {
    expect(perturbation("3a").apply("He nodded gravely.")).toBe("He nodded gravely.");
  });

  it("straightens curly punctuation", () => {
    expect(perturbation("3b").apply("“It’s ‘fine’,” he said.")).toBe(`"It's 'fine'," he said.`);
  });

  it("replaces em- and en-dashes with hyphens", () => {
    expect(perturbation("3c").apply("wait — no, 1914–1918")).toBe("wait - no, 1914-1918");
  });

  it("adds an internal space rather than collapsing one", () => {
    // Collapsing cannot fail: a harvested highlight is DOM text, already collapsed.
    expect(perturbation("3d").apply("one two three")).toBe("one  two three");
  });

  it("reports 3d as inert on a single word, which has nowhere to put the space", () => {
    expect(isPerturbationInert(perturbation("3d"), "gravely")).toBe(true);
  });

  it("pads the ends", () => {
    expect(perturbation("3e").apply("quote")).toBe(" quote ");
  });

  it("decomposes accents only when the string has any", () => {
    expect(toNFD("plain ascii")).toBeNull();
    const decomposed = toNFD("café");
    expect(decomposed).not.toBeNull();
    expect(decomposed).toHaveLength("café".length + 1);
  });

  describe("noteref stripping", () => {
    it("removes a marker hanging off a word", () => {
      expect(stripNoteRefs("he said gravely.12 Then he left")).toBe("he said gravely. Then he left");
    });

    it("removes a marker attached directly to a word", () => {
      expect(stripNoteRefs("the Rubicon3 was crossed")).toBe("the Rubicon was crossed");
    });

    it("leaves standalone numbers in the prose alone", () => {
      expect(stripNoteRefs("in 1892 he returned")).toBe("in 1892 he returned");
    });
  });

  it("drops the last four words", () => {
    expect(perturbation("3h").apply("one two three four five six")).toBe("one two");
  });

  it("transposes two interior characters of the longest word", () => {
    const misspelled = misspellLongestWord("the gravedigger paused");
    expect(misspelled).not.toBe("the gravedigger paused");
    expect(misspelled.split(" ")).toHaveLength(3);
    expect(misspelled).toContain("the ");
    expect(misspelled).toContain(" paused");
  });

  it("reports a perturbation that cannot bite on this quote", () => {
    // No curly punctuation to straighten, so 3b would silently re-run the control.
    expect(isPerturbationInert(perturbation("3b"), "plain text")).toBe(true);
    expect(isPerturbationInert(perturbation("3b"), "it’s here")).toBe(false);
    expect(isPerturbationInert(perturbation("3a"), "plain text")).toBe(false);
  });
});
