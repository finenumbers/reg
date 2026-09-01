import { describe, expect, it } from "vitest";
import {
  buildJobsListUrl,
  formatDurationMs,
  formatJobAction,
  formatJobActionTitle,
  formatJobMessage,
  formatJobMetaDetails,
  formatJobTrigger,
  jobStatusBadgeVariant,
  summarizeJobResult,
} from "@/modules/jobs/ui-format";
import type { JobRunListItem } from "@/modules/jobs/query";

function sample(overrides: Partial<JobRunListItem> = {}): JobRunListItem {
  return {
    id: "j1",
    actionCode: "regs.poll",
    trigger: "manual",
    status: "success",
    startedAt: "2026-08-06T10:00:00.000Z",
    finishedAt: "2026-08-06T10:00:02.000Z",
    durationMs: 2000,
    errorMessage: null,
    exitCode: 0,
    phonesParsed: 12,
    linesBad: 0,
    changesCount: 3,
    actorUserId: "u1",
    actorUsername: "ops",
    hasArtifact: true,
    meta: null,
    ...overrides,
  };
}

describe("jobs ui-format", () => {
  it("formats duration, trigger, and action labels", () => {
    expect(formatDurationMs(250)).toBe("1");
    expect(formatDurationMs(1500)).toBe("2");
    expect(formatDurationMs(65000)).toBe("65");
    expect(formatDurationMs(null)).toBe("—");
    expect(formatJobTrigger("schedule")).toBe("По расписанию");
    expect(formatJobAction("regs.poll")).toBe("Опрос регистраций");
    expect(formatJobAction("unknown.job")).toBe("unknown.job");
    expect(formatJobActionTitle("cdr.import")).toBe("Импорт CDR (cdr.import)");
  });

  it("summarizes running and failed without using meta", () => {
    expect(summarizeJobResult(sample({ status: "running" }))).toBe(
      "Выполняется…",
    );
    expect(
      summarizeJobResult(
        sample({ status: "failed", errorMessage: "SSH timeout" }),
      ),
    ).toBe("SSH timeout");
    expect(
      summarizeJobResult(
        sample({
          status: "failed",
          actionCode: "cdr.import",
          errorMessage: null,
          linesBad: 4,
        }),
      ),
    ).toMatch(/битых строк/);
    expect(
      summarizeJobResult(
        sample({ status: "failed", errorMessage: null, linesBad: 0 }),
      ),
    ).toBe("Ошибка (без деталей)");
  });

  it("summarizes regs.poll without artifact or exit-code noise", () => {
    const line = summarizeJobResult(sample());
    expect(line).toContain("12 номеров");
    expect(line).toContain("3 изменений");
    expect(line).not.toContain("артефакт");
    expect(line).not.toContain("код 0");
    expect(
      summarizeJobResult(
        sample({
          changesCount: 0,
          meta: { removed: 2, duplicatePhones: 1 },
        }),
      ),
    ).toBe("12 номеров · без изменений · 2 снято · 1 дублей");
  });

  it("summarizes phones and groups without duplicate change counts", () => {
    expect(
      summarizeJobResult(
        sample({
          actionCode: "phones.sync",
          phonesParsed: 10,
          changesCount: 10,
          meta: { endpointCount: 7, gatewayCount: 3 },
        }),
      ),
    ).toBe("10 номеров · 7 EP · 3 шлюзов");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "groups.sync",
          phonesParsed: 5,
          changesCount: 5,
        }),
      ),
    ).toBe("5 групп");
  });

  it("summarizes cdr.import using skipped as already-in-db, not changes", () => {
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.import",
          phonesParsed: 8,
          linesBad: 2,
          changesCount: 3,
          meta: { fileCount: 2, files: ["a", "b"] },
        }),
      ),
    ).toBe("8 записей · 2 файлов · 2 битых строк · 3 уже в базе");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.import",
          phonesParsed: 8,
          changesCount: 1,
          meta: null,
        }),
      ),
    ).toBe("8 записей · 1 уже в базе");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.import",
          phonesParsed: 0,
          changesCount: 0,
          meta: { fileCount: 0, files: [], backfilled: 40, backfillRemaining: 9 },
        }),
      ),
    ).toBe("дообогащено 40 · осталось обогатить 9");
  });

  it("summarizes voipmonitor skip, empty queue, counters, and partial", () => {
    expect(
      summarizeJobResult(
        sample({
          actionCode: "voipmonitor.match",
          phonesParsed: 0,
          changesCount: 0,
          meta: { skipped: true, reason: "disabled" },
        }),
      ),
    ).toBe("Пропущено: выключено в Настройках");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "voipmonitor.match",
          phonesParsed: 0,
          changesCount: 0,
          meta: { skipped: true, reason: "missing_credentials" },
        }),
      ),
    ).toBe("Пропущено: нет учётных данных");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "voipmonitor.match",
          phonesParsed: 0,
          changesCount: 0,
          meta: { remainingHours: 0, hours: [] },
        }),
      ),
    ).toBe("Нечего сопоставлять");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "voipmonitor.match",
          phonesParsed: 0,
          changesCount: 0,
          meta: null,
        }),
      ),
    ).toBe("0 сопоставлено · 0 записано");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "voipmonitor.match",
          phonesParsed: 4,
          changesCount: 3,
          errorMessage: "live: timeout; archive: boom",
        }),
      ),
    ).toBe("4 сопоставлено · 3 записано · есть ошибки по часам");
  });

  it("summarizes sides refresh and purge without duplicating counters", () => {
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.sides.refresh",
          phonesParsed: 3,
          changesCount: 12,
          meta: { replay: true },
        }),
      ),
    ).toBe("12 строк обновлено · 3 номеров в diff · повторный прогон");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.sides.refresh",
          phonesParsed: 0,
          changesCount: 0,
        }),
      ),
    ).toBe("Без изменений");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.purge.month",
          phonesParsed: 42,
          errorMessage: "Удалено 42 записей · Август 2026 года",
          meta: { month: "2026-08" },
        }),
      ),
    ).toBe("Удалено 42 записей · Август 2026 года");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.purge.month",
          phonesParsed: 42,
          errorMessage: null,
          meta: { month: "2026-08" },
        }),
      ),
    ).toBe("Удалено 42 · Август 2026 года");
  });

  it("does not throw on unknown action or broken meta", () => {
    expect(
      summarizeJobResult(
        sample({ actionCode: "future.job", phonesParsed: null, changesCount: null }),
      ),
    ).toBe("Готово");
    expect(
      summarizeJobResult(
        sample({
          actionCode: "cdr.purge.month",
          errorMessage: null,
          phonesParsed: 1,
          meta: { month: "nope" },
        }),
      ),
    ).toBe("Удалено 1 · nope");
    expect(
      formatJobMetaDetails(
        sample({ meta: { month: "nope", files: "x" } as unknown as Record<string, unknown> }),
        "UTC",
      ),
    ).toEqual([{ label: "Месяц", value: "nope" }]);
  });

  it("lists whitelisted meta details", () => {
    const details = formatJobMetaDetails(
      sample({
        actionCode: "cdr.import",
        meta: {
          files: ["a.csv", "b.csv"],
          backfilled: 4,
          enrich: {
            pstnCacheHits: 1,
            pstnLiveLookups: 2,
            geoCacheHits: 0,
            geoLiveLookups: 3,
          },
        },
      }),
      "UTC",
    );
    expect(details.map((d) => d.label)).toEqual([
      "Файлы",
      "Дообогащено",
      "Обогащение",
    ]);
    expect(details[0]?.value).toContain("a.csv");
    expect(details.find((d) => d.label === "Обогащение")?.value).toContain(
      "из кэша",
    );
  });

  it("writes an expanded message when errorMessage is empty", () => {
    expect(
      formatJobMessage(
        sample({ phonesParsed: 13, changesCount: 0, linesBad: 0 }),
        "UTC",
      ),
    ).toBe("Снимок 13 номеров. Изменений status/ip/port нет.");
    expect(
      formatJobMessage(
        sample({
          actionCode: "cdr.sides.refresh",
          phonesParsed: 0,
          changesCount: 0,
        }),
        "UTC",
      ),
    ).toMatch(/не обновляли/);
    expect(
      formatJobMessage(
        sample({
          actionCode: "voipmonitor.match",
          phonesParsed: 9,
          changesCount: 9,
          meta: {
            hours: [
              {
                lane: "live",
                hour: "2026-09-01T03:00:00.000Z",
                matched: 9,
              },
            ],
          },
        }),
        "UTC",
      ),
    ).toMatch(/Сопоставлено 9/);
    expect(
      formatJobMessage(
        sample({
          actionCode: "cdr.import",
          phonesParsed: 12,
          changesCount: 0,
          meta: {
            files: ["20260901_035147"],
            enrich: {
              pstnCacheHits: 18,
              pstnLiveLookups: 2,
              geoCacheHits: 5,
              geoLiveLookups: 0,
            },
          },
        }),
        "UTC",
      ),
    ).toMatch(/Файл 20260901_035147/);
  });

  it("maps status badge variants", () => {
    expect(jobStatusBadgeVariant("success")).toBe("default");
    expect(jobStatusBadgeVariant("failed")).toBe("destructive");
    expect(jobStatusBadgeVariant("running")).toBe("outline");
  });

  it("builds list URLs with filters", () => {
    expect(buildJobsListUrl()).toBe("/api/jobs");
    expect(buildJobsListUrl({ status: "failed", page: 2 })).toBe(
      "/api/jobs?status=failed&page=2",
    );
  });
});
