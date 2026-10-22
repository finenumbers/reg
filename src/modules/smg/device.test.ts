import { describe, expect, it } from "vitest";
import {
  foldSmgDevices,
  pickSmgDevice,
  SMG_NO_DATA_DEVICE,
  SMG_NO_DATA_LABEL,
  smgDeviceSigns,
} from "@/modules/smg/device";

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

const NODES = [
  { identifier: "kazan", name: "Казань" },
  { identifier: "mts", name: "МТС" },
  { identifier: null, name: "Без знака" },
];

describe("foldSmgDevices", () => {
  it("names nodes from settings and parks unknown signs last", () => {
    expect(
      foldSmgDevices(
        [
          { sign: "mts", count: 9 },
          { sign: "Kazan", count: 1 },
          { sign: "kazan", count: 2 },
          { sign: "other", count: 4 },
          { sign: "", count: 5 },
        ],
        NODES,
      ),
    ).toEqual([
      { sign: "kazan", name: "Казань", count: 3 },
      { sign: "mts", name: "МТС", count: 9 },
      { sign: SMG_NO_DATA_DEVICE, name: SMG_NO_DATA_LABEL, count: 9 },
    ]);
  });

  it("omits a node that has no calls this month", () => {
    expect(foldSmgDevices([{ sign: "mts", count: 1 }], NODES)).toEqual([
      { sign: "mts", name: "МТС", count: 1 },
    ]);
  });
});

describe("smgDeviceSigns", () => {
  it("includes the identifier and every stored spelling", () => {
    expect(
      smgDeviceSigns(
        [
          { sign: "Kazan", count: 1 },
          { sign: "mts", count: 2 },
        ],
        NODES,
        "kazan",
      ),
    ).toEqual(["kazan", "Kazan"]);
  });

  it("collects blank and unknown signs for the no-data bucket", () => {
    expect(
      smgDeviceSigns(
        [
          { sign: "mts", count: 2 },
          { sign: "other", count: 1 },
          { sign: "", count: 4 },
        ],
        NODES,
        SMG_NO_DATA_DEVICE,
      ),
    ).toEqual(["", "other"]);
  });

  it("matches nothing for a sign that is not a saved node", () => {
    expect(smgDeviceSigns([{ sign: "other", count: 1 }], NODES, "other")).toEqual([]);
    expect(smgDeviceSigns([], NODES, "")).toEqual([]);
  });
});
