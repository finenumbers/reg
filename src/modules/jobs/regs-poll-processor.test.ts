import { beforeEach, describe, expect, it, vi } from "vitest";

const createJobRun = vi.fn();
const updateJobRun = vi.fn();
const upsertArtifact = vi.fn();
const findUniqueSettings = vi.fn();
const findManyJobRuns = vi.fn();
const deleteManyArtifacts = vi.fn();
const appendAudit = vi.fn();
const countRegistrations = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: (...args: unknown[]) => createJobRun(...args),
      update: (...args: unknown[]) => updateJobRun(...args),
      findMany: (...args: unknown[]) => findManyJobRuns(...args),
    },
    jobRunArtifact: {
      upsert: (...args: unknown[]) => upsertArtifact(...args),
      deleteMany: (...args: unknown[]) => deleteManyArtifacts(...args),
    },
    appSetting: {
      findUnique: (...args: unknown[]) => findUniqueSettings(...args),
    },
    registrationCurrent: {
      count: (...args: unknown[]) => countRegistrations(...args),
    },
  },
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    REGS_POLL_MANUAL: "regs.poll_manual",
    REGS_POLL_START: "regs.poll_start",
    REGS_POLL_FINISH: "regs.poll_finish",
  },
  auditService: {
    append: (...args: unknown[]) => appendAudit(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { processRegsPoll } from "@/modules/jobs/regs-poll-processor";

const SAMPLE_STDOUT = [
  "73852222205;Registered;46.20.69.189:5060",
  "73912193303;Unregistered;",
].join("\n");

describe("processRegsPoll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createJobRun.mockResolvedValue({ id: "job_1" });
    updateJobRun.mockResolvedValue({});
    upsertArtifact.mockResolvedValue({});
    findUniqueSettings.mockResolvedValue({
      artifactMaxBytes: 1_048_576,
      artifactRetentionDays: 14,
      artifactKeepLastRuns: 50,
    });
    findManyJobRuns.mockResolvedValue([{ id: "job_1" }]);
    deleteManyArtifacts.mockResolvedValue({ count: 0 });
    appendAudit.mockResolvedValue(undefined);
    countRegistrations.mockResolvedValue(0);
  });

  it("applies parsed rows on successful synthetic SSH output", async () => {
    const apply = vi.fn().mockResolvedValue({
      upserted: 2,
      unchanged: 0,
      changesCount: 2,
      eventsWritten: 2,
      removed: 0,
    });
    const execute = vi.fn().mockResolvedValue({
      actionCode: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      exitCode: 0,
      stdout: SAMPLE_STDOUT,
      stderr: "",
      durationMs: 12,
      timedOut: false,
    });

    const result = await processRegsPoll(
      { trigger: "manual", actorUserId: "user_1" },
      { execute, apply },
    );

    expect(result.status).toBe("success");
    expect(result.phonesParsed).toBe(2);
    expect(result.changesCount).toBe(2);
    expect(execute).toHaveBeenCalledWith({
      actionCode: "regs.poll",
      timeoutMs: 60_000,
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0]![0]).toHaveLength(2);
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job_1" },
        data: expect.objectContaining({ status: "success", phonesParsed: 2 }),
      }),
    );
  });

  it("does not apply when exit code is non-zero", async () => {
    const apply = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      actionCode: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      exitCode: 1,
      stdout: SAMPLE_STDOUT,
      stderr: "boom",
      durationMs: 5,
      timedOut: false,
    });

    const result = await processRegsPoll(
      { trigger: "schedule" },
      { execute, apply },
    );

    expect(result.status).toBe("failed");
    expect(apply).not.toHaveBeenCalled();
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", changesCount: 0 }),
      }),
    );
  });

  it("does not apply when stdout is empty", async () => {
    const apply = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      actionCode: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      exitCode: 0,
      stdout: "\n",
      stderr: "",
      durationMs: 5,
      timedOut: false,
    });

    const result = await processRegsPoll(
      { trigger: "manual" },
      { execute, apply },
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/пустой stdout/i);
    expect(result.errorMessage).toMatch(/NOPASSWD/i);
    expect(apply).not.toHaveBeenCalled();
  });

  it("includes sanitized stderr snippet when stdout is empty", async () => {
    const apply = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      actionCode: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      exitCode: 0,
      stdout: "",
      stderr:
        "cat: /etc/mvts3g/access-db.conf: Permission denied\nmysql: option '-h' requires an argument\n",
      durationMs: 5,
      timedOut: false,
    });

    const result = await processRegsPoll(
      { trigger: "manual" },
      { execute, apply },
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Permission denied");
    expect(result.errorMessage).toMatch(/stderr:/);
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects all-bad dump without applying (fail-closed)", async () => {
    const apply = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      actionCode: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      exitCode: 0,
      stdout: "not-a-valid-line\n",
      stderr: "",
      durationMs: 5,
      timedOut: false,
    });

    const result = await processRegsPoll(
      { trigger: "manual" },
      { execute, apply },
    );

    expect(result.status).toBe("failed");
    expect(result.linesBad).toBeGreaterThan(0);
    expect(result.errorMessage).toMatch(/некорректных строк/i);
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects ANSI-only stdout without applying (fail-closed)", async () => {
    const apply = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      actionCode: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      exitCode: 0,
      stdout: "\u001b[0m\n\u001b[32m\u001b[0m\n",
      stderr: "",
      durationMs: 5,
      timedOut: false,
    });

    const result = await processRegsPoll(
      { trigger: "manual" },
      { execute, apply },
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/пустой stdout/i);
    expect(apply).not.toHaveBeenCalled();
  });
});
