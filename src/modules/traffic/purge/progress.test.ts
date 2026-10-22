import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";
import {
  PURGE_INTERRUPT_NOTE,
  purgeProgressFromJob,
  purgeStageLine,
  type PurgeStagesMeta,
} from "@/modules/traffic/purge/progress";

function stages(overrides?: Partial<PurgeStagesMeta>): PurgeStagesMeta {
  return {
    calls: { done: 10, total: 10 },
    journal: { done: 1, total: 1 },
    cards: { done: 3, total: 3 },
    delays: { done: 2, total: 2 },
    smg: { done: 4, total: 4 },
    syslog: { done: 6, total: 6 },
    jobs: { done: 2, total: 8 },
    audit: { done: 0, total: 4 },
    ...overrides,
  };
}

describe("purgeProgressFromJob", () => {
  it("lists stages in order and marks the active one", () => {
    const progress = purgeProgressFromJob({
      phonesParsed: 10,
      meta: { month: "2026-08", phase: "jobs", stages: stages() },
    });
    expect(progress).toEqual({
      month: "2026-08",
      mode: "stages",
      stages: [
        {
          id: "calls",
          label: "Звонки CDR",
          done: 10,
          total: 10,
          state: "done",
        },
        {
          id: "journal",
          label: "Журнал АнтиФрода",
          done: 1,
          total: 1,
          state: "done",
        },
        {
          id: "cards",
          label: "Карточки АнтиФрода",
          done: 3,
          total: 3,
          state: "done",
        },
        {
          id: "delays",
          label: "Задержки АнтиФрода",
          done: 2,
          total: 2,
          state: "done",
        },
        {
          id: "smg",
          label: "Звонки SMG",
          done: 4,
          total: 4,
          state: "done",
        },
        {
          id: "syslog",
          label: "Архивы Syslog",
          done: 6,
          total: 6,
          state: "done",
        },
        {
          id: "jobs",
          label: "Задачи",
          done: 2,
          total: 8,
          state: "active",
        },
        {
          id: "audit",
          label: "Аудит",
          done: 0,
          total: 4,
          state: "pending",
        },
      ],
    });
  });

  it("marks a zero total ready before that stage starts", () => {
    const progress = purgeProgressFromJob({
      phonesParsed: 1,
      meta: {
        month: "2026-08",
        phase: "calls",
        stages: stages({
          calls: { done: 1, total: 3 },
          journal: { done: 0, total: 0 },
          cards: { done: 0, total: 0 },
          delays: { done: 0, total: 0 },
          smg: { done: 0, total: 0 },
          syslog: { done: 0, total: 0 },
          jobs: { done: 0, total: 0 },
          audit: { done: 0, total: 5 },
        }),
      },
    });
    expect(progress?.mode).toBe("stages");
    if (progress?.mode !== "stages") return;
    expect(progress.stages.map((stage) => stage.state)).toEqual([
      "active",
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "pending",
    ]);
  });

  it("marks delays active while cards are still deleting", () => {
    const progress = purgeProgressFromJob({
      phonesParsed: 1,
      meta: {
        month: "2026-08",
        phase: "cards",
        stages: stages({
          cards: { done: 1, total: 3 },
          delays: { done: 0, total: 2 },
        }),
      },
    });
    expect(progress?.mode).toBe("stages");
    if (progress?.mode !== "stages") return;
    expect(progress.stages.find((stage) => stage.id === "cards")?.state).toBe("active");
    expect(progress.stages.find((stage) => stage.id === "delays")?.state).toBe("active");
    expect(progress.stages.find((stage) => stage.id === "smg")?.state).toBe("pending");
  });

  it("keeps a finished stage done when the count and the deletes differ", () => {
    const progress = purgeProgressFromJob({
      phonesParsed: 11,
      meta: {
        month: "2026-08",
        phase: "jobs",
        stages: stages({ calls: { done: 11, total: 10 } }),
      },
    });
    expect(progress?.mode).toBe("stages");
    if (progress?.mode !== "stages") return;
    expect(progress.stages[0]).toMatchObject({ state: "done", done: 11, total: 10 });
    expect(purgeStageLine(progress.stages[0])).toBe(
      `Звонки CDR — готово, ${formatCount(11)} / ${formatCount(10)}`,
    );
    expect(purgeStageLine(progress.stages[4])).toBe(
      `Звонки SMG — готово, ${formatCount(4)}`,
    );
    expect(purgeStageLine(progress.stages[6])).toBe(
      `Задачи — ${formatCount(2)} / ${formatCount(8)}`,
    );
    expect(purgeStageLine(progress.stages[7])).toBe(`Аудит — ожидает, ${formatCount(4)}`);
  });

  it("falls back to one calls line when stages are missing or broken", () => {
    expect(
      purgeProgressFromJob({
        phonesParsed: 3,
        meta: { month: "2026-08", targetCount: 9, phase: "started" },
      }),
    ).toEqual({ month: "2026-08", mode: "legacy", deleted: 3, target: 9 });

    expect(
      purgeProgressFromJob({
        phonesParsed: null,
        meta: { month: "2026-08", deletedCount: 4, stages: { calls: { done: 1 } } },
      }),
    ).toEqual({ month: "2026-08", mode: "legacy", deleted: 4, target: 0 });
  });

  it("hides the banner when the month key is missing", () => {
    expect(
      purgeProgressFromJob({
        phonesParsed: 1,
        meta: { phase: "calls", stages: stages() },
      }),
    ).toBeNull();
    expect(purgeProgressFromJob({ phonesParsed: 1, meta: null })).toBeNull();
  });

  it("states that a restart continues the later stages after CDR calls are gone", () => {
    expect(PURGE_INTERRUPT_NOTE).toContain("обрывается");
    expect(PURGE_INTERRUPT_NOTE).toContain("продолжаются");
    expect(PURGE_INTERRUPT_NOTE).toContain("SMG");
    expect(PURGE_INTERRUPT_NOTE).toContain("Syslog");
  });
});
