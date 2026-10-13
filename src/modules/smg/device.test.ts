import { describe, expect, it } from "vitest";
import { pickSmgDevice } from "@/modules/smg/device";

const devices = [{ sign: "kazan" }, { sign: "mts" }];

describe("pickSmgDevice", () => {
  it("keeps a node that is in the month", () => {
    expect(pickSmgDevice(devices, "mts")).toBe("mts");
  });

  it("trims the requested name", () => {
    expect(pickSmgDevice(devices, "  kazan  ")).toBe("kazan");
  });

  it("uses the first listed node when the request is missing", () => {
    expect(pickSmgDevice(devices, "other")).toBe("kazan");
    expect(pickSmgDevice(devices, "")).toBe("kazan");
    expect(pickSmgDevice(devices, undefined)).toBe("kazan");
  });

  it("selects nothing when the month has no nodes", () => {
    expect(pickSmgDevice([], "mts")).toBe("");
  });
});
