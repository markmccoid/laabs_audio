import { initHeadlessCarPlayRuntime } from "./headless-runtime";

describe("headless CarPlay runtime bootstrap", () => {
	it("initializes player event handling before the CarPlay service can accept selections", () => {
		const calls: string[] = [];

		initHeadlessCarPlayRuntime({
			initPlayerRuntime: () => calls.push("player"),
			initCarPlayRuntime: () => calls.push("carplay"),
		});

		expect(calls).toEqual(["player", "carplay"]);
	});
});
