jest.mock("expo-linking", () => ({
  createURL: (path: string) => `laabsaudio://${path}`,
  parse: (url: string) => {
    const parsed = new URL(url);
    return { hostname: parsed.hostname, path: parsed.pathname.replace(/^\//, "") };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { redirectSystemPath } = require("../app/+native-intent") as typeof import("../app/+native-intent");

describe("redirectSystemPath", () => {
  it("leaves warm book links to the app's link handler", () => {
    expect(
      redirectSystemPath({ path: "laabsaudio:///book-1", initial: false }),
    ).toBeNull();
  });

  it("keeps cold-start book links for Expo Router", () => {
    expect(
      redirectSystemPath({ path: "laabsaudio:///book-1", initial: true }),
    ).toBe("laabsaudio:///book-1");
  });

  it("passes through non-book links", () => {
    expect(
      redirectSystemPath({ path: "laabsaudio:///main-player", initial: false }),
    ).toBe("laabsaudio:///main-player");
  });
});
