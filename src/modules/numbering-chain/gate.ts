import type { ChainMode } from "@/modules/numbering-chain/order";

const KEY = "__reg_numbering_chain__";

export const CHAIN_BUSY = "Идёт цепочка загрузок.";

export type ChainSlot = {
  running: boolean;
  stopTail: boolean;
  index: number;
  mode: ChainMode;
};

function emptySlot(): ChainSlot {
  return { running: false, stopTail: false, index: 0, mode: "idle" };
}

export function chainSlot(): ChainSlot {
  const g = globalThis as typeof globalThis & { [KEY]?: ChainSlot };
  if (!g[KEY]) g[KEY] = emptySlot();
  return g[KEY];
}

export function isChainRunning(): boolean {
  return chainSlot().running;
}

/** A card load is refused while the chain owns the queue. The chain's own start is allowed. */
export function chainStartBlock(fromChain?: boolean): string | null {
  if (fromChain || !isChainRunning()) return null;
  return CHAIN_BUSY;
}
