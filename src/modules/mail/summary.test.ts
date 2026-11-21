import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyChainStep, emptyChainMarks } from "@/modules/mail/summary-marks";
import {
  formatDelta,
  numberNoun,
  problemsForSide,
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
      freeErrors: 2,
      purchasedTotal: 1,
      purchasedErrors: 1,
      freeRows: [
        {
          provider: "UIS",
          count: null,
          previous: 30976,
          at: Date.parse("2026-11-20T17:02:00.000Z"),
          error: true,
          dateOnly: false,
          errors: 2,
        },
      ],
      purchasedRows: [
        {
          provider: "Вручную",
          count: 1,
          previous: 1,
          at: Date.parse("2026-11-20T17:00:00.000Z"),
          error: false,
          dateOnly: true,
          errors: 0,
        },
      ],
      problems: [
        {
          provider: "Runexis <x>",
          side: "free",
          full: "74993507666",
          abc: "499",
          number: "3507666",
          city: "Москва",
          region: "Москва",
          problem: "mask",
        },
        {
          provider: "Вручную",
          side: "purchased",
          full: "73832003553",
          abc: "7383",
          number: "2003553",
          city: "Новосибирск",
          region: "Новосибирская область",
          problem: "pstn",
        },
        {
          provider: "UIS",
          side: "free",
          full: "3804412345",
          abc: "380",
          number: "4412345",
          city: "",
          region: "",
          problem: "rtu",
        },
      ],
      problemTotal: 3,
    };
    const letter = renderSummary(input);
    expect(letter.subject).toContain("на пятницу, на 20.11.2026");
    expect(letter.text).toContain("Ошибка загрузки");
    expect(letter.text).toContain("30 976");
    expect(letter.text).toContain("Ошибки");
    expect(letter.html).toContain("Ошибки");
    expect(letter.html).toContain("Runexis &lt;x&gt;");
    expect(letter.html).not.toContain("Runexis <x>");
    expect(letter.text).toContain("7 (499)");
    expect(letter.text).toContain("7 (383)");
    expect(letter.text).toContain("\t380\t");
    expect(letter.text).not.toContain("7 (380)");
    expect(letter.text).toContain("Нет маски и типа");
    expect(letter.text).not.toContain("Категория");
    expect(letter.html).not.toContain(">Категория<");
    expect(letter.text).toContain("Свободные");
    expect(letter.text).toContain("Купленные");
    expect(letter.html).toContain("border:1px solid #000");
    expect(letter.html).toContain("#16a34a");
    expect(letter.html).toContain("#2563eb");
    expect(letter.html).toContain('bgcolor="#dc2626"');
    expect(letter.html).toContain("color:#ffffff");
    expect(letter.html).toContain("#7c3aed");
    expect(letter.html).toContain('align="center"');
    expect(letter.html).toContain('align="left"');
    expect(letter.html).toContain('align="right"');
    expect(letter.text).toContain("3 номера");
    expect(letter.text).toContain("1 номер");
    const freeOrder = problemsForSide(input.problems, "free").map((row) => row.full);
    expect(freeOrder).toEqual(["3804412345", "74993507666"]);
    expect(letter.text.indexOf("4412345")).toBeLessThan(letter.text.indexOf("3507666"));
    expect(letter.html).toContain("color:#dc2626");
  });

  it("paints the manual row and declines 553", () => {
    expect(numberNoun(553)).toBe("номера");
    expect(numberNoun(11)).toBe("номеров");
    expect(numberNoun(22)).toBe("номера");
    const letter = renderSummary({
      asOf: "2026-11-20",
      previousAsOf: "2026-11-19",
      timeZone: "Asia/Novosibirsk",
      freeTotal: 817000,
      freeErrors: 22,
      purchasedTotal: 553,
      purchasedErrors: 0,
      freeRows: [],
      purchasedRows: [
        {
          provider: "Вручную",
          count: 53,
          previous: 53,
          at: Date.parse("2026-11-20T17:00:00.000Z"),
          error: false,
          dateOnly: true,
          errors: 0,
        },
      ],
      problems: [],
      problemTotal: 5,
    });
    expect(letter.text).toContain("553 номера");
    expect(letter.text).toContain("817 000 номеров");
    expect(letter.text).toContain("5 номеров");
    expect(letter.html).toContain("#7c3aed");
    expect(letter.html).toContain("Вручную");
  });

  it("treats a found mask as resolved", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/modules/mail/summary-data.ts"),
      "utf8",
    );
    expect(source).not.toContain("maskType");
    expect(source).toContain("btrim(${column}) = ''");
    expect(source).toContain("ORDER BY n.e164");
    expect(source).toContain("GROUP BY btrim(n.provider)");
  });
});
