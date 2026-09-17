import fixtures from "./__fixtures__/normalize-fixtures.json";
import { normalizeAssistantText } from "./assistant-text";

describe("normalizeAssistantText", () => {
  it.each(fixtures)("normalizes $input", ({ input, expected }) => {
    expect(normalizeAssistantText(input)).toBe(expected);
  });
});
