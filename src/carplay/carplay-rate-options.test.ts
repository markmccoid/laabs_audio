import {
	buildCarPlayRateOptions,
	formatCarPlayRateLabel,
} from "./carplay-rate-options";

describe("CarPlay rate options", () => {
	it("builds the exact compact cycle requested for CarPlay", () => {
		expect(
			buildCarPlayRateOptions({
				currentRate: 1.2,
				minimumRate: 0.5,
				maximumRate: 4,
			}),
		).toEqual([
			{ value: 1, label: "1x", isCurrent: false, isCycleOption: true },
			{ value: 1.2, label: "1.2x", isCurrent: true, isCycleOption: true },
			{ value: 1.5, label: "1.5x", isCurrent: false, isCycleOption: true },
			{ value: 1.7, label: "1.7x", isCurrent: false, isCycleOption: true },
			{ value: 2, label: "2x", isCurrent: false, isCycleOption: true },
		]);
	});

	it("displays a legacy custom rate but excludes it from the cycle", () => {
		const options = buildCarPlayRateOptions({
			currentRate: 1.25,
			minimumRate: 0.5,
			maximumRate: 4,
		});

		expect(options.find((option) => option.isCurrent)).toEqual({
			value: 1.25,
			label: "1.3x",
			isCurrent: true,
			isCycleOption: false,
		});
	});

	it("honors the configured playback-rate range", () => {
		const options = buildCarPlayRateOptions({
			currentRate: 1.5,
			minimumRate: 1.3,
			maximumRate: 1.8,
		});

		expect(options.map((option) => option.value)).toEqual([1.5, 1.7]);
	});

	it.each([
		[1, "1x"],
		[1.2, "1.2x"],
		[1.5, "1.5x"],
		[1.7, "1.7x"],
		[2, "2x"],
	])("formats %s as %s", (rate, label) => {
		expect(formatCarPlayRateLabel(rate)).toBe(label);
	});
});
