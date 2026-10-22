import { describe, expect, it } from "vitest";
import { AF_CATEGORY } from "@/modules/smg-trace/classify";
import { formatServerLine, summarizeExchange } from "@/modules/smg-trace/summary";
import {
  AF_SUMMARY_BLOCK_CLASS,
  AF_SUMMARY_PASS_CLASS,
  AF_SUMMARY_SERVER_CLASS,
  categoryTone,
  splitServerSummaryLine,
  summaryToneClass,
} from "@/modules/smg/ui/call-trace-sheet";

const DEV = "91.195.253.131";

function joined(line: string): string {
  const parts = splitServerSummaryLine(line);
  return parts.server + parts.lead + parts.outcome + parts.tail;
}

describe("antifraud summary paint", () => {
  it("paints only Пропущен and Заблокирован", () => {
    expect(categoryTone(AF_CATEGORY.passed)).toBe("pass");
    expect(categoryTone(AF_CATEGORY.blocked)).toBe("block");
    expect(categoryTone(AF_CATEGORY.rejectIgnored)).toBeNull();
    expect(categoryTone(AF_CATEGORY.waiting)).toBeNull();
    expect(summaryToneClass("pass")).toBe(AF_SUMMARY_PASS_CLASS);
    expect(summaryToneClass("block")).toBe(AF_SUMMARY_BLOCK_CLASS);
    expect(AF_SUMMARY_PASS_CLASS).toBe("font-bold text-green-600");
    expect(AF_SUMMARY_BLOCK_CLASS).toBe("font-bold text-red-600");
    expect(AF_SUMMARY_SERVER_CLASS).toBe("font-bold text-blue-600");
  });

  it("keeps the formatted server line and isolates the verdict token", () => {
    const text = [
      "RADIUS: Accs-Request [antifraud]",
      `Access request ID[073]. Group[0] Server[0]: ${DEV}:1812:super-secret`,
      "Request ID [073] is sent",
      "Request ID [073] got valid reply for accs (in 335 ms)",
      "Request ID [073] Accs-Reply [accept]. Time [336:335]",
    ].join("\n");
    const line = formatServerLine(
      summarizeExchange({ closed: true, blocks: { text, mismatch: false } }).servers[0]!,
    );
    const parts = splitServerSummaryLine(line);
    expect(joined(line)).toBe(line);
    expect(parts.server).toBe(`Dev Callhose ${DEV}`);
    expect(parts.outcome).toBe("Access-Accept");
    expect(parts.outcomeTone).toBe("pass");
    expect(parts.tail).toBe(", 335 мс, запрос 073");
    expect(line).not.toContain("super-secret");
  });

  it("leaves milliseconds and a release mark outside Access-Reject", () => {
    const line = `Parking 5.227.161.183 — Access-Reject, 55 мс, вызов снят, запрос 083`;
    const parts = splitServerSummaryLine(line);
    expect(joined(line)).toBe(line);
    expect(parts.server).toBe("Parking 5.227.161.183");
    expect(parts.outcome).toBe("Access-Reject");
    expect(parts.outcomeTone).toBe("block");
    expect(parts.tail).toBe(", 55 мс, вызов снят, запрос 083");
  });

  it("paints a bare address and a reply with no milliseconds", () => {
    const line = "10.9.8.7 — Access-Reject, запрос 016";
    const parts = splitServerSummaryLine(line);
    expect(joined(line)).toBe(line);
    expect(parts.server).toBe("10.9.8.7");
    expect(parts.outcome).toBe("Access-Reject");
    expect(parts.tail).toBe(", запрос 016");
  });

  it("leaves a timeout line uncolored past the server", () => {
    const line = `Dev Callhose ${DEV} — нет ответа, повторы исчерпаны, запрос 077, попытка 1`;
    const parts = splitServerSummaryLine(line);
    expect(joined(line)).toBe(line);
    expect(parts.server).toBe(`Dev Callhose ${DEV}`);
    expect(parts.outcome).toBe("");
    expect(parts.outcomeTone).toBeNull();
    expect(parts.tail).toBe("нет ответа, повторы исчерпаны, запрос 077, попытка 1");
  });

  it("does not paint a longer word that starts with Access-Reject", () => {
    const line = "10.0.0.1 — Access-Rejecting, запрос 001";
    const parts = splitServerSummaryLine(line);
    expect(parts.outcome).toBe("");
    expect(parts.outcomeTone).toBeNull();
    expect(parts.tail).toBe("Access-Rejecting, запрос 001");
  });
});
