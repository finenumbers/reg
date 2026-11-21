import type { MaskProgress } from "@/modules/numbering-catalog/decorate";
import {
  CHAIN_SOURCES,
  CHAIN_STEPS,
  type ChainMode,
  type ChainSourceId,
  type ChainView,
} from "@/modules/numbering-chain/order";

export type { ChainView };

function remain(done: number, total: number): number {
  return Math.max(0, total - done);
}

function countLine(kind: MaskProgress["kind"], left: number, total: number): string {
  if (kind === "client") return `Клиенты, купленные: осталось ${left} из ${total}.`;
  if (kind === "resplit-free" || kind === "resplit-purchased") {
    const side = kind === "resplit-purchased" ? "купленные" : "свободные";
    return `Тариф, ${side}: осталось ${left} из ${total}.`;
  }
  const side = kind === "purchased" ? "купленные" : "свободные";
  return `Маски, ${side}: осталось ${left} из ${total}.`;
}

function sourceId(provider: string): ChainSourceId | null {
  return CHAIN_SOURCES.find((source) => source.provider === provider)?.id ?? null;
}

export function buildChainView(input: {
  running: boolean;
  index: number;
  mode: ChainMode;
  progress: MaskProgress | null;
}): ChainView {
  const cards: ChainView["cards"] = {};
  let banner: string | null = null;
  const progress = input.progress;
  if (progress && progress.total > 0) {
    const line = countLine(
      progress.kind,
      remain(progress.done, progress.total),
      progress.total,
    );
    const id = progress.provider ? sourceId(progress.provider) : null;
    if (progress.kind === "client" || !id) banner = line;
    else cards[id] = line;
  }
  return {
    running: input.running,
    queue: input.running ? queueLine(input.index, input.mode, progress) : null,
    banner,
    cards,
  };
}

function queueLine(
  index: number,
  mode: ChainMode,
  progress: MaskProgress | null,
): string {
  const masking = mode === "wait" || mode === "masks";
  const rest = CHAIN_STEPS.slice(masking ? index : index + 1)
    .map((step) => step.label)
    .join(", ");
  const tail = rest ? ` Дальше: ${rest}.` : "";
  if (masking && progress?.kind === "client") return `Клиенты, купленные.${tail}`;
  if (masking && (progress?.kind === "resplit-free" || progress?.kind === "resplit-purchased")) {
    return `Тариф.${tail}`;
  }
  if (masking && progress?.provider) return `Маски, ${progress.provider}.${tail}`;
  if (masking && (progress?.kind === "free" || progress?.kind === "purchased")) {
    const side = progress.kind === "purchased" ? "купленные" : "свободные";
    return `Маски, ${side}.${tail}`;
  }
  if (masking) return `Маски.${tail}`;
  const current = CHAIN_STEPS[index];
  if (!current) return "Цепочка загрузок.";
  return `Цепочка: ${current.label}.${tail}`;
}
