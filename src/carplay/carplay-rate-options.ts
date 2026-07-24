export const CARPLAY_CYCLE_RATES = [1, 1.2, 1.5, 1.7, 2] as const;

export type CarPlayRateOption = {
	value: number;
	label: string;
	isCurrent: boolean;
	isCycleOption: boolean;
};

const ratesMatch = (left: number, right: number) => Math.abs(left - right) < 0.01;

export const formatCarPlayRateLabel = (rate: number) =>
	Number.isInteger(rate) ? `${rate}x` : `${rate.toFixed(1)}x`;

export const buildCarPlayRateOptions = ({
	currentRate,
	minimumRate,
	maximumRate,
}: {
	currentRate: number;
	minimumRate: number;
	maximumRate: number;
}): CarPlayRateOption[] => {
	const cycleRates = CARPLAY_CYCLE_RATES.filter(
		(rate) => rate >= minimumRate && rate <= maximumRate,
	);
	const currentIsCycleRate = cycleRates.some((rate) => ratesMatch(rate, currentRate));
	const values = currentIsCycleRate
		? [...cycleRates]
		: [...cycleRates, currentRate].sort((left, right) => left - right);

	return values.map((value) => ({
		value,
		label: formatCarPlayRateLabel(value),
		isCurrent: ratesMatch(value, currentRate),
		// A custom rate inherited from the phone remains accurately displayed,
		// but the next tap moves onto the fixed, driver-friendly cycle.
		isCycleOption: cycleRates.some((rate) => ratesMatch(rate, value)),
	}));
};
