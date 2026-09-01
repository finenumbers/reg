import { beforeEach, describe, expect, it, vi } from "vitest";

const jobRunCount = vi.fn();
const jobRunFindMany = vi.fn();
const appSettingFindUnique = vi.fn();
const userFindMany = vi.fn();
const hasVoipmonitorWork = vi.fn();
const countUnenrichedVoipmonitor = vi.fn();
const countParkedVoipmonitor = vi.fn();
const countUnenrichedCdrEnrich = vi.fn();
const loggerWarn = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      count: (...args: unknown[]) => jobRunCount(...args),
      findMany: (...args: unknown[]) => jobRunFindMany(...args),
    },
    appSetting: {
      findUnique: (...args: unknown[]) => appSettingFindUnique(...args),
    },
    user: {
      findMany: (...args: unknown[]) => userFindMany(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (...args: unknown[]) => loggerWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/modules/voipmonitor/count", () => ({
  hasVoipmonitorWork: (...args: unknown[]) => hasVoipmonitorWork(...args),
  countUnenrichedVoipmonitor: (...args: unknown[]) =>
    countUnenrichedVoipmonitor(...args),
  countParkedVoipmonitor: (...args: unknown[]) => countParkedVoipmonitor(...args),
}));

vi.mock("@/modules/traffic/enrich-import", () => ({
  countUnenrichedCdrEnrich: (...args: unknown[]) =>
    countUnenrichedCdrEnrich(...args),
}));

import {
  JOB_LIST_ERROR_MAX_BYTES,
  listJobRuns,
} from "@/modules/jobs/query";

function jobRow(errorMessage: string | null) {
  return {
    id: "j1",
    actionCode: "voipmonitor.match",
    trigger: "schedule" as const,
    status: "failed" as const,
    startedAt: new Date("2026-09-01T08:35:04.000Z"),
    finishedAt: new Date("2026-09-01T08:35:05.000Z"),
    durationMs: 1000,
    errorMessage,
    exitCode: null,
    phonesParsed: 0,
    linesBad: null,
    changesCount: 0,
    actorUserId: null,
    artifact: null,
  };
}

describe("listJobRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobRunCount.mockResolvedValue(1);
    jobRunFindMany.mockResolvedValue([jobRow("short")]);
    appSettingFindUnique.mockResolvedValue({ voipmonitorEnabled: true });
    userFindMany.mockResolvedValue([]);
    hasVoipmonitorWork.mockResolvedValue(true);
    countUnenrichedVoipmonitor.mockResolvedValue(4);
    countParkedVoipmonitor.mockResolvedValue(2);
    countUnenrichedCdrEnrich.mockResolvedValue(0);
  });

  it("still returns rows when a banner probe throws", async () => {
    hasVoipmonitorWork.mockRejectedValue(
      new Error("Invalid `prisma.cdrRecord.findFirst()` invocation:"),
    );
    const result = await listJobRuns({ status: "failed" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("j1");
    expect(result.voipmonitorHasWork).toBe(false);
    expect(loggerWarn).toHaveBeenCalled();
  });

  it("truncates huge errorMessage on read", async () => {
    const huge = "E".repeat(20_000);
    jobRunFindMany.mockResolvedValue([jobRow(huge)]);
    const result = await listJobRuns();
    const message = result.items[0]?.errorMessage ?? "";
    expect(Buffer.byteLength(message, "utf8")).toBeLessThanOrEqual(
      JOB_LIST_ERROR_MAX_BYTES,
    );
    expect(message).toContain("[truncated]");
  });
});
