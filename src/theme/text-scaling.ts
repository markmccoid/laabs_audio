// Compact surfaces such as grid tiles, player chrome, and dense navigation rows
// cannot grow indefinitely with Dynamic Type. Keep scaling enabled while giving
// those layouts a predictable upper bound.
export const COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER = 1.25;
