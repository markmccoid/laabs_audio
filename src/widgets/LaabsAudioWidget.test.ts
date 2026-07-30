const mockUpdateSnapshot = jest.fn();
let widgetLayout = "";

jest.mock("@expo/ui/swift-ui", () => ({
  Button: "Button",
  HStack: "HStack",
  Image: "Image",
  Spacer: "Spacer",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
}));

jest.mock("@expo/ui/swift-ui/modifiers", () => ({
  accessibilityLabel: (label: string) => ({ $type: "accessibilityLabel", label }),
  aspectRatio: (params: object) => ({ $type: "aspectRatio", ...params }),
  backgroundOverlay: (params: object) => ({ $type: "backgroundOverlay", ...params }),
  buttonBorderShape: (shape: string) => ({ $type: "buttonBorderShape", shape }),
  buttonStyle: (style: string) => ({ $type: "buttonStyle", style }),
  clipShape: (shape: string, cornerRadius?: number) => ({
    $type: "clipShape",
    shape,
    cornerRadius,
  }),
  clipped: () => ({ $type: "clipped" }),
  containerBackground: (color: string, container: string) => ({
    $type: "containerBackground",
    color,
    container,
  }),
  containerRelativeFrame: (params: object) => ({
    $type: "containerRelativeFrame",
    ...params,
  }),
  font: (params: object) => ({ $type: "font", ...params }),
  foregroundStyle: (color: string) => ({ $type: "foregroundStyle", color }),
  frame: (params: object) => ({ $type: "frame", ...params }),
  lineLimit: (limit: number) => ({ $type: "lineLimit", limit }),
  padding: (params: object) => ({ $type: "padding", ...params }),
  resizable: () => ({ $type: "resizable" }),
  tint: (color: string) => ({ $type: "tint", color }),
  widgetURL: (url: string) => ({ $type: "widgetURL", url }),
}));

jest.mock("expo-widgets", () => ({
  createWidget: jest.fn((_name: string, layout: string) => {
    widgetLayout = layout;
    return {
      updateSnapshot: mockUpdateSnapshot,
    };
  }),
}));

// Requiring after the mock declarations keeps the native widget object deterministic in Jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./LaabsAudioWidget");

type WidgetNode = {
  type: string;
  props: {
    children?: WidgetNode | WidgetNode[] | string;
    modifiers?: { $type: string; [key: string]: unknown }[];
    [key: string]: unknown;
  };
};

const modifierMocks = jest.requireMock("@expo/ui/swift-ui/modifiers") as Record<
  string,
  (...args: never[]) => object
>;

const evaluateWidget = (
  props: object,
  widgetFamily: "systemSmall" | "systemMedium",
): WidgetNode => {
  const componentNames = [
    "Button",
    "HStack",
    "Image",
    "Spacer",
    "Text",
    "VStack",
    "ZStack",
  ];
  const modifierNames = Object.keys(modifierMocks);
  // The production widget runtime exposes SwiftUI components and modifiers as globals.
  // Reproduce that contract here when evaluating the serialized widget function.
  const layout = Function(
    ...componentNames,
    ...modifierNames,
    "_jsx",
    "_jsxs",
    `return (${widgetLayout});`,
  )(
    ...componentNames,
    ...modifierNames.map((name) => modifierMocks[name]),
    (type: string, elementProps: object) => ({ type, props: elementProps }),
    (type: string, elementProps: object) => ({ type, props: elementProps }),
  ) as (snapshot: object, environment: object) => WidgetNode;

  return layout(props, { widgetFamily });
};

const findAll = (node: WidgetNode, type: string): WidgetNode[] => {
  const matches = node.type === type ? [node] : [];
  const children = node.props.children;
  if (!children || typeof children === "string") return matches;
  const childNodes = Array.isArray(children) ? children : [children];
  return matches.concat(
    childNodes.flatMap((child) => findAll(child, type)),
  );
};

const activeSnapshot = (state: "playing" | "paused" = "playing") => ({
  version: 1,
  publishedAtMs: 100,
  scope: { userKey: "user", libraryId: "library" },
  status: "active",
  media: {
    kind: "audiobook",
    libraryItemId: "book-1",
    episodeId: null,
    title: "A Very Good Book",
    creator: "Ada Author",
    artworkUri: "file:///widget/book-1.jpg",
    detailUrl: "laabsaudio://book/book-1",
    playback: {
      state,
      positionMs: 5_520_000,
      durationMs: 36_000_000,
      rate: 1,
      anchorTimestampMs: 100,
    },
  },
  candidates: [],
  warning: null,
});

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

  it("renders active small widgets as linked cover art with a pause control", () => {
    const widget = evaluateWidget(activeSnapshot(), "systemSmall");

    expect(widget.type).toBe("ZStack");
    expect(widget.props.modifiers).toContainEqual({
      $type: "widgetURL",
      url: "laabsaudio://book/book-1",
    });
    expect(findAll(widget, "Image")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          props: expect.objectContaining({
            uiImage: "file:///widget/book-1.jpg",
          }),
        }),
        expect.objectContaining({
          props: expect.objectContaining({
            systemName: "pause.fill",
          }),
        }),
      ]),
    );
    expect(findAll(widget, "Button")[0].props).toEqual(
      expect.objectContaining({
        target: "laabs.audio.toggle",
        onPress: expect.any(Function),
      }),
    );
  });

  it("renders medium widgets with metadata, minute progress, and play control", () => {
    const widget = evaluateWidget(activeSnapshot("paused"), "systemMedium");
    const textValues = findAll(widget, "Text").map((text) => text.props.children);

    expect(widget.type).toBe("HStack");
    expect(widget.props.modifiers).toContainEqual({
      $type: "widgetURL",
      url: "laabsaudio://book/book-1",
    });
    expect(
      findAll(widget, "ZStack").some((stack) =>
        stack.props.modifiers?.some(
          (modifier) =>
            modifier.$type === "frame" &&
            modifier.width === 82 &&
            modifier.height === 82,
        ),
      ),
    ).toBe(true);
    expect(textValues).toEqual(
      expect.arrayContaining(["A Very Good Book", "Ada Author", "1 hr 32 min"]),
    );
    expect(findAll(widget, "Button")[0].props.target).toBe(
      "laabs.audio.toggle",
    );
    expect(
      findAll(widget, "Image").some(
        (image) => image.props.systemName === "play.fill",
      ),
    ).toBe(true);
  });

  it("renders a useful empty state without a stale detail link or control", () => {
    const widget = evaluateWidget(
      {
        version: 1,
        publishedAtMs: 100,
        scope: null,
        status: "empty",
        media: null,
        candidates: [],
        warning: null,
      },
      "systemMedium",
    );

    expect(findAll(widget, "Button")).toHaveLength(0);
    expect(
      widget.props.modifiers?.some((modifier) => modifier.$type === "widgetURL"),
    ).toBe(false);
    expect(findAll(widget, "Text").map((text) => text.props.children)).toContain(
      "Play an audiobook to get started.",
    );
  });
});
