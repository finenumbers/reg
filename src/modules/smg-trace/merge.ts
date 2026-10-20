import { logger } from "@/lib/logger";
import type { TraceBlocks } from "@/modules/smg-trace/types";

export type SavedCard = {
  text: string;
  mismatch: boolean;
  startedKey: string;
  open: boolean;
};

export type MergeResult = SavedCard & { diverged: boolean };

/**
 * Keep every stored line, and keep earlier slots before later ones.
 * A text that wholly contains the other wins. Otherwise the earlier text
 * stays in front and only the new tail is appended.
 */
export function mergeTraceCard(stored: SavedCard | null, incoming: SavedCard): MergeResult {
  if (!stored) return { ...incoming, diverged: false };
  if (whollyContains(incoming.text, stored.text) && incoming.text.length >= stored.text.length) {
    return {
      text: incoming.text,
      mismatch: stored.mismatch || incoming.mismatch,
      startedKey: earlierKey(stored.startedKey, incoming.startedKey),
      open: openAfter(stored, incoming),
      diverged: false,
    };
  }
  if (whollyContains(stored.text, incoming.text)) {
    return { ...stored, mismatch: stored.mismatch || incoming.mismatch, diverged: false };
  }

  const storedFirst = stored.startedKey <= incoming.startedKey;
  const early = storedFirst ? stored : incoming;
  const late = storedFirst ? incoming : stored;
  const joined = spliceOrdered(early.text, late.text);
  return {
    text: joined.text,
    mismatch: stored.mismatch || incoming.mismatch,
    startedKey: early.startedKey,
    open: openAfter(stored, incoming),
    diverged: joined.overlap === 0,
  };
}

export function cardFromBlocks(blocks: TraceBlocks, open: boolean): SavedCard {
  return {
    text: blocks.text,
    mismatch: blocks.mismatch === true,
    startedKey: typeof blocks.startedKey === "string" ? blocks.startedKey : "",
    open,
  };
}

export function logCardDiverge(tag: string, storedLength: number, incomingLength: number): void {
  logger.warn("smg.trace.card_diverge", { tag, storedLength, incomingLength });
}

function openAfter(stored: SavedCard, incoming: SavedCard): boolean {
  if (incoming.open === false && incoming.startedKey >= stored.startedKey) return false;
  return stored.open;
}

function earlierKey(left: string, right: string): string {
  return left <= right ? left : right;
}

function whollyContains(outer: string, inner: string): boolean {
  if (inner.length === 0) return true;
  return outer.includes(inner);
}

function spliceOrdered(early: string, late: string): { text: string; overlap: number } {
  const earlyLines = splitLines(early);
  const lateLines = splitLines(late);
  const max = Math.min(earlyLines.length, lateLines.length);
  let overlap = 0;
  for (let count = max; count > 0; count -= 1) {
    let same = true;
    for (let index = 0; index < count; index += 1) {
      if (earlyLines[earlyLines.length - count + index] !== lateLines[index]) {
        same = false;
        break;
      }
    }
    if (same) {
      overlap = count;
      break;
    }
  }
  if (overlap === 0) {
    const seen = new Set(earlyLines);
    const extra = lateLines.filter((line) => !seen.has(line));
    return { text: [...earlyLines, ...extra].join("\n"), overlap: 0 };
  }
  return { text: [...earlyLines, ...lateLines.slice(overlap)].join("\n"), overlap };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}
