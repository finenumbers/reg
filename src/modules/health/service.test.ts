import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??=
    "postgresql://reg:reg@localhost:5432/reg?schema=public";
});

describe("health probes", () => {
  it("liveness is always ok", async () => {
    const { checkLiveness } = await import("@/modules/health/service");
    expect(checkLiveness()).toEqual({ status: "ok" });
  });
});
