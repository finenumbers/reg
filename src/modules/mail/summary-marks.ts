/**
 * What each side of this group chain did. The final last_error is not used:
 * it is one field per source and the free step overwrites the purchased one.
 */

import {
  CHAIN_SOURCES,
  type ChainSide,
  type ChainSourceId,
} from "@/modules/numbering-chain/order";

export type SideMark = "ok" | "error" | "skipped";

export type ProviderMarks = {
  provider: string;
  free: SideMark | null;
  purchased: SideMark | null;
  freeAt: number | null;
  purchasedAt: number | null;
};

export function emptyChainMarks(): ProviderMarks[] {
  return CHAIN_SOURCES.map((source) => ({
    provider: source.provider,
    free: null,
    purchased: null,
    freeAt: null,
    purchasedAt: null,
  }));
}

function providerOf(id: ChainSourceId): string {
  return CHAIN_SOURCES.find((source) => source.id === id)?.provider ?? id;
}

export function applyChainStep(
  marks: ProviderMarks[],
  input: {
    id: ChainSourceId;
    side: ChainSide;
    started: boolean;
    skipped: boolean;
    ok: boolean;
    at: number | null;
  },
): void {
  const row = marks.find((item) => item.provider === providerOf(input.id));
  if (!row) return;
  const state: SideMark = !input.started
    ? input.skipped
      ? "skipped"
      : "error"
    : input.ok
      ? "ok"
      : "error";
  const stamp = input.started ? input.at : null;
  if (input.side === "purchased" || input.side === "both") {
    row.purchased = state;
    row.purchasedAt = stamp;
  }
  if (input.side === "free" || input.side === "both") {
    row.free = state;
    row.freeAt = stamp;
  }
  if (input.id === "aurora") {
    row.purchased = state;
    row.purchasedAt = stamp;
  }
  if (input.side === "purchased" && !input.ok) {
    row.free = state;
    row.freeAt = stamp;
  }
}
