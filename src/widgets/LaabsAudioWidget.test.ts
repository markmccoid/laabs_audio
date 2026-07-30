const mockUpdateSnapshot = jest.fn();

jest.mock("@expo/ui/swift-ui", () => ({
  Button: "Button",
  HStack: "HStack",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
}));

jest.mock("@expo/ui/swift-ui/modifiers", () => ({
  containerBackground: jest.fn(),
}));

jest.mock("expo-widgets", () => ({
  createWidget: jest.fn(() => ({
    updateSnapshot: mockUpdateSnapshot,
  })),
}));

// Requiring after the mock declarations keeps the native widget object deterministic in Jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./LaabsAudioWidget");

describe("LAABS audio widget registration", () => {
  it("publishes an initial empty timeline when the app opens", () => {
    expect(mockUpdateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        status: "empty",
        media: null,
      }),
    );
  });
});
