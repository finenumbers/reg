import { describe, expect, it } from "vitest";
import { applyChainStep, emptyChainMarks } from "@/modules/mail/summary-marks";
import {
  formatDelta,
  renderSummary,
  scheduledAsOf,
  weekdayAccusative,
  type SummaryLetterInput,
} from "@/modules/mail/summary-letter";

describe("numbering summary chain marks", () => {
  it("keeps a purchased success when the free step fails", () => {
    const marks = emptyChainMarks();
    applyChainStep(marks, {
      id: "uis",
      side: "purchased",
      started: true,
      skipped: false,
      ok: true,
      at: 1,
    });
    applyChainStep(marks, {
      id: "uis",
      side: "free",
      started: true,
      skipped: false,
      ok: false,
      at: 2,
    });
    const uis = marks.find((row) => row.provider === "UIS");
    expect(uis?.purchased).toBe("ok");
    expect(uis?.free).toBe("error");
  });

  it("marks both Aurora sides from the free step and skips a source with no secret", () => {
    const marks = emptyChainMarks();
    applyChainStep(marks, {
      id: "aurora",
      side: "free",
      started: true,
      skipped: false,
      ok: true,
      at: 3,
    });
    applyChainStep(marks, {
      id: "sipout",
      side: "purchased",
      started: false,
      skipped: true,
      ok: false,
      at: null,
    });
    expect(marks.find((row) => row.provider === "Aurora Telecom")).toMatchObject({
      free: "ok",
      purchased: "ok",
    });
    expect(marks.find((row) => row.provider === "SipOut")).toMatchObject({
      free: "skipped",
      purchased: "skipped",
    });
  });
});

describe("numbering summary letter", () => {
  it("dates the 17:00 UTC slot on the previous day when that slot is local midnight", () => {
    const started = new Date("2026-11-20T17:00:00.000Z");
    expect(scheduledAsOf(started, "Asia/Novosibirsk")).toBe("2026-11-20");
    expect(weekdayAccusative("2026-11-20")).toBe("пятницу");
    expect(scheduledAsOf(started, "Europe/Moscow")).toBe("2026-11-20");
  });

  it("renders an error without a new count and escapes html", () => {
    expect(formatDelta(20, 30)).toBe("-10");
    expect(formatDelta(30, 10)).toBe("+20");
    expect(formatDelta(9, 9)).toBe("0");
    expect(formatDelta(9, null)).toBe("—");
    const input: SummaryLetterInput = {
      asOf: "2026-11-20",
      previousAsOf: "2026-11-19",
      timeZone: "Asia/Novosibirsk",
      freeTotal: 3,
      freeErrors: 1,
      purchasedTotal: 1,
      purchasedErrors: 0,
      freeRows: [
        {
          provider: "UIS",
          count: null,
          previous: 30976,
          at: Date.parse("2026-11-20T17:02:00.000Z"),
          error: true,
          dateOnly: false,
        },
      ],
      purchasedRows: [],
      problems: [
        {
          provider: "Runexis <x>",
          side: "free",
          abc: "499",
          number: "3507666",
          city: "Москва",
          region: "Москва",
          problem: "mask",
        },
      ],
      problemTotal: 1,
    };
    const letter = renderSummary(input);
    expect(letter.subject).toContain("на пятницу, на 20.11.2026");
    expect(letter.text).toContain("Ошибка загрузки");
    expect(letter.text).toContain("30 976");
    expect(letter.html).toContain("Runexis &lt;x&gt;");
    expect(letter.html).not.toContain("Runexis <x>");
    expect(letter.text).toContain("7 (499)");
    expect(letter.text).toContain("Нет маски и типа");
  });
});
