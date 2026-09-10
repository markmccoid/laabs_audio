/**
 * Persistence for the spike screen. Harvested anchors are expensive to produce
 * by hand — they come from selecting real text in a real book — so they survive
 * a reload, and so do the verdicts, otherwise a crash mid-run costs the whole
 * afternoon.
 */

import { mmkvStorage } from "@/store/mmkv-storage";
import type { FrameSample, HarvestedAnchor, VerdictMap } from "./types";

const STORAGE_KEY = "readium-anchor-spike:v1";

export type SpikeState = {
  /** Document-relative path of the imported EPUB — absolute paths change per install. */
  bookRelativePath: string | null;
  bookLabel: string | null;
  anchors: HarvestedAnchor[];
  activeAnchorId: string | null;
  verdicts: VerdictMap;
  frameSamples: FrameSample[];
  notes: string;
};

export const EMPTY_SPIKE_STATE: SpikeState = {
  bookRelativePath: null,
  bookLabel: null,
  anchors: [],
  activeAnchorId: null,
  verdicts: {},
  frameSamples: [],
  notes: "",
};

export const loadSpikeState = (): SpikeState => {
  const raw = mmkvStorage.getItem(STORAGE_KEY);
  if (typeof raw !== "string" || !raw) return EMPTY_SPIKE_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<SpikeState>;
    return {
      ...EMPTY_SPIKE_STATE,
      ...parsed,
      anchors: Array.isArray(parsed.anchors) ? parsed.anchors : [],
      verdicts: parsed.verdicts ?? {},
      frameSamples: Array.isArray(parsed.frameSamples) ? parsed.frameSamples : [],
    };
  } catch {
    return EMPTY_SPIKE_STATE;
  }
};

export const saveSpikeState = (state: SpikeState) => {
  mmkvStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const clearSpikeState = () => {
  mmkvStorage.removeItem(STORAGE_KEY);
};
