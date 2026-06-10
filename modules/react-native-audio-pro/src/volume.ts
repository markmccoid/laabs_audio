/**
 * Normalizes a volume value to ensure it's between 0 and 1,
 * with at most 2 decimal places of precision.
 * Handles special cases for values near 0 and 1 to avoid floating-point artifacts.
 *
 * @param volume The volume value to normalize
 * @returns A normalized volume value between 0 and 1 with 2 decimal precision
 */
export function normalizeVolume(volume: number): number {
	// Special case for 0 or very small values to avoid floating-point artifacts
	if (volume === 0 || Math.abs(volume) < 0.001) {
		return 0;
	}

	// Special case for values very close to 1 to avoid floating-point artifacts
	if (volume > 0.995 && volume <= 1) {
		return 1;
	}

	// Clamp between 0 and 1
	const clampedVolume = Math.max(0, Math.min(1, volume));

	// Format to 2 decimal places and convert back to number
	return parseFloat(clampedVolume.toFixed(2));
}
