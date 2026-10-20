import { describe, expect, it } from "vitest";
import { mergeTraceCard, type SavedCard } from "@/modules/smg-trace/merge";

function card(text: string, startedKey: string, open = true): SavedCard {
  return { text, mismatch: false, startedKey, open };
}

describe("mergeTraceCard", () => {
  it("keeps the longer text when it contains the stored lines", () => {
    const merged = mergeTraceCard(card("a\nb", "slot/00"), card("a\nb\nc", "slot/00", false));
    expect(merged.text).toBe("a\nb\nc");
    expect(merged.open).toBe(false);
    expect(merged.diverged).toBe(false);
  });

  it("does not let a shorter sealed span close a longer card", () => {
    const merged = mergeTraceCard(card("a\nb\nc", "slot/00"), card("a\nb", "slot/00", false));
    expect(merged.text).toBe("a\nb\nc");
    expect(merged.open).toBe(true);
  });

  it("puts the earlier slot first and does not repeat the join", () => {
    const merged = mergeTraceCard(card("middle\nlate", "slot/10"), card("early\nmiddle", "slot/00"));
    expect(merged.text).toBe("early\nmiddle\nlate");
    expect(merged.startedKey).toBe("slot/00");
    expect(merged.diverged).toBe(false);
  });

  it("appends lines that share no join and reports the diverge", () => {
    const merged = mergeTraceCard(card("one", "slot/00"), card("two", "slot/10"));
    expect(merged.text).toBe("one\ntwo");
    expect(merged.diverged).toBe(true);
  });
});
