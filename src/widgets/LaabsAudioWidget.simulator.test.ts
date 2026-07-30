const mockUpdateSnapshot = jest.fn(() => {
  throw new Error("Exception in HostFunction: simulator timeline unavailable");
});

jest.mock("@expo/ui/swift-ui", () => ({}));
jest.mock("@expo/ui/swift-ui/modifiers", () => ({}));
jest.mock("expo-widgets", () => ({
  createWidget: jest.fn(() => ({
    updateSnapshot: mockUpdateSnapshot,
  })),
}));

describe("LAABS audio widget simulator startup", () => {
  it("does not abort route evaluation when initial timeline publication fails", () => {
    expect(() => {
      jest.isolateModules(() => {
        // This import runs the same module-level publication used by _layout.tsx.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./LaabsAudioWidget");
      });
    }).not.toThrow();

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
  });
});
