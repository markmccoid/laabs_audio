import {
  createImportedAudiobookId,
  isImportedAudiobookId,
  referencesImportedAudiobookId,
} from "./imported-audiobook-identity";

describe("Imported Audiobook identity", () => {
  it("creates unique prefixed ids that are recognised as imported", () => {
    const first = createImportedAudiobookId();
    const second = createImportedAudiobookId();
    expect(first).toMatch(/^imp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
    expect(isImportedAudiobookId(first)).toBe(true);
  });

  it("does not treat Audiobookshelf ids as imported", () => {
    expect(isImportedAudiobookId("li_8f3a2c")).toBe(false);
    expect(isImportedAudiobookId("4f9b1d2e-1111-4222-8333-944455556666")).toBe(false);
    expect(isImportedAudiobookId(null)).toBe(false);
  });

  it("detects imported ids inside request paths and serialized bodies", () => {
    const id = createImportedAudiobookId();
    expect(referencesImportedAudiobookId(`/api/me/progress/${id}`)).toBe(true);
    expect(referencesImportedAudiobookId(`/api/items/${id}/play`)).toBe(true);
    expect(referencesImportedAudiobookId(JSON.stringify([{ libraryItemId: id }]))).toBe(true);
  });

  it("ignores paths and bodies that only mention the prefix in prose", () => {
    expect(referencesImportedAudiobookId("/api/me/progress/li_123")).toBe(false);
    expect(referencesImportedAudiobookId(JSON.stringify({ title: "simp_le tale" }))).toBe(false);
  });
});
