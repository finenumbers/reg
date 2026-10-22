import { describe, expect, it } from "vitest";
import { traceDeviceIps } from "@/modules/smg-trace/drain";

describe("traceDeviceIps", () => {
  it("skips only an IP that is explicitly off and keeps the others", () => {
    expect(
      traceDeviceIps(["10.0.0.2", "10.0.0.8", "10.1.0.1"], new Set(["10.0.0.8"])),
    ).toEqual(["10.0.0.2", "10.1.0.1"]);
    expect(traceDeviceIps(["10.0.0.2"], new Set())).toEqual(["10.0.0.2"]);
  });
});
