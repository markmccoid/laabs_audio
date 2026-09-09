/** Where Follow Mode keeps the active transcript sentence in the readable viewport. */
export const READ_ALONG_FOLLOW_ALIGNMENTS = ["top", "middle", "bottom"] as const;

export type ReadAlongFollowAlignment = (typeof READ_ALONG_FOLLOW_ALIGNMENTS)[number];

export const DEFAULT_READ_ALONG_FOLLOW_ALIGNMENT: ReadAlongFollowAlignment = "top";

export const normalizeReadAlongFollowAlignment = (
  value: unknown,
): ReadAlongFollowAlignment =>
  READ_ALONG_FOLLOW_ALIGNMENTS.includes(value as ReadAlongFollowAlignment)
    ? (value as ReadAlongFollowAlignment)
    : DEFAULT_READ_ALONG_FOLLOW_ALIGNMENT;

const VIEW_POSITION_BY_ALIGNMENT: Record<ReadAlongFollowAlignment, number> = {
  top: 0,
  middle: 0.5,
  bottom: 1,
};

export const getFollowViewPosition = (alignment: ReadAlongFollowAlignment): number =>
  VIEW_POSITION_BY_ALIGNMENT[alignment];
