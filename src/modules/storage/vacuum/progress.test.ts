import { describe, expect, it } from "vitest";
import { ORPHAN_RECLAIM_MESSAGE } from "@/modules/jobs/reclaim-orphans";
import {
  VACUUM_RESTART_MARK,
  vacuumClusterFromRow,
  vacuumFailureMessage,
  vacuumStageLine,
  vacuumStageMeta,
  vacuumViews,
} from "@/modules/storage/vacuum/progress";
import {
  DATABASE_VACUUM_SQL,
  VACUUM_TABLE_ORDER,
} from "@/modules/storage/vacuum/sql";

describe("database vacuum statements", () => {
  it("is exactly three VACUUM FULL commands and nothing that deletes rows", () => {
    expect(VACUUM_TABLE_ORDER).toEqual([
      "cdr_voipmonitor_links",
      "cdr_records",
      "smg_cdr_records",
    ]);
    expect(DATABASE_VACUUM_SQL.cdr_voipmonitor_links).toBe(
      "VACUUM (FULL) cdr_voipmonitor_links",
    );
    expect(DATABASE_VACUUM_SQL.cdr_records).toBe("VACUUM (FULL) cdr_records");
    expect(DATABASE_VACUUM_SQL.smg_cdr_records).toBe(
      "VACUUM (FULL) smg_cdr_records",
    );
    const text = Object.values(DATABASE_VACUUM_SQL).join("\n");
    expect(text).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/i);
    expect(text).not.toMatch(/VACUUM FULL;/);
  });
});

describe("vacuum progress", () => {
  it("uses the same restart mark as orphan reclaim", () => {
    expect(VACUUM_RESTART_MARK).toBe(ORPHAN_RECLAIM_MESSAGE);
  });

  it("builds a live stage list from job meta and cluster progress", () => {
    const view = vacuumViews({
      meta: vacuumStageMeta("cdr_records"),
      cluster: vacuumClusterFromRow({
        relname: "cdr_records",
        phase: "writing new heap",
        scanned: 10,
        written: 4,
      }),
    });
    expect(view.stages.map((stage) => stage.state)).toEqual([
      "done",
      "active",
      "pending",
    ]);
    expect(vacuumStageLine(view.stages[1])).toBe(
      "Звонки — идёт, запись новой кучи — просмотрено 10, записано 4",
    );
    expect(vacuumStageLine(view.stages[0])).toBe("Ссылки VoIPmonitor — готово");
  });

  it("keeps an unknown cluster phase and treats a missing row as in progress", () => {
    const view = vacuumViews({
      meta: vacuumStageMeta("cdr_voipmonitor_links"),
      cluster: vacuumClusterFromRow({
        relname: "cdr_voipmonitor_links",
        phase: "some future phase",
        scanned: null,
        written: null,
      }),
    });
    expect(vacuumStageLine(view.stages[0])).toBe(
      "Ссылки VoIPmonitor — идёт, some future phase",
    );
  });

  it("explains a restart in Russian and keeps the failed table", () => {
    const message = vacuumFailureMessage(
      VACUUM_RESTART_MARK,
      "Звонки",
    );
    expect(message).toMatch(/перезапуском/);
    expect(message).toMatch(/Звонки/);
    const view = vacuumViews({
      meta: vacuumStageMeta("cdr_records", "cdr_records"),
      errorMessage: VACUUM_RESTART_MARK,
      failed: true,
    });
    expect(view.stages.map((stage) => stage.state)).toEqual([
      "done",
      "failed",
      "pending",
    ]);
    expect(view.stages[1]?.error).toBe(message);
    expect(vacuumStageLine(view.stages[1]!)).toContain("ошибка");
  });
});
