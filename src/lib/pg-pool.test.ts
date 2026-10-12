import { describe, expect, it } from "vitest";
import { appPoolOptions } from "@/lib/pg-pool";

describe("app pool lock timeout", () => {
  it("sets a short lock_timeout on the application pool only", () => {
    expect(appPoolOptions("postgres://reg:reg@db:5432/reg").options).toBe(
      "-c lock_timeout=5000",
    );
  });
});
