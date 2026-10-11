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
          label: "Звонки",
          done: 10,
          total: 10,
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
      "pending",
    ]);
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
      `Звонки — готово, ${formatCount(11)} / ${formatCount(10)}`,
    );
    expect(purgeStageLine(progress.stages[1])).toBe(
      `Задачи — ${formatCount(2)} / ${formatCount(8)}`,
    );
    expect(purgeStageLine(progress.stages[2])).toBe(`Аудит — ожидает, ${formatCount(4)}`);
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

  it("states that a restart continues jobs and audit after the calls are gone", () => {
    expect(PURGE_INTERRUPT_NOTE).toContain("обрывается");
    expect(PURGE_INTERRUPT_NOTE).toContain("продолжаются");
  });
});
