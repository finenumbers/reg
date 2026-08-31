import { describe, expect, it } from "vitest";
import {
  isPstnLdc,
  pairPstnRows,
  pstnJoinName,
  type PstnDeviceInput,
} from "@/modules/stats/pair-pstn";

function device(
  name: string,
  overrides: Partial<Omit<PstnDeviceInput, "name">> = {},
): PstnDeviceInput {
  return {
    name,
    inCalls: 0,
    inMinutes: 0,
    outCalls: 0,
    outMinutes: 0,
    parkingCalls: 0,
    parkingMinutes: 0,
    phantomCalls: 0,
    phantomMinutes: 0,
    ...overrides,
  };
}

describe("pstnJoinName / isPstnLdc", () => {
  it("strips a single trailing Local or LDC suffix", () => {
    expect(pstnJoinName("PSTN_Sochi_MTS_Local")).toBe("PSTN_Sochi_MTS");
    expect(pstnJoinName("PSTN_Sochi_MTS_LDC")).toBe("PSTN_Sochi_MTS");
    expect(pstnJoinName("PSTN_A")).toBe("PSTN_A");
  });

  it("treats only an exact trailing _LDC as the LDC side", () => {
    expect(isPstnLdc("PSTN_Sochi_MTS_LDC")).toBe(true);
    expect(isPstnLdc("PSTN_Sochi_MTS_Local")).toBe(false);
    expect(isPstnLdc("PSTN_A")).toBe(false);
    expect(isPstnLdc("Trunk_Sochi_LDC")).toBe(false);
  });

  it("does not strip lowercase suffixes or Trunk_ names", () => {
    expect(pstnJoinName("PSTN_Sochi_MTS_ldc")).toBe("PSTN_Sochi_MTS_ldc");
    expect(pstnJoinName("PSTN_Sochi_MTS_local")).toBe("PSTN_Sochi_MTS_local");
    expect(isPstnLdc("PSTN_Sochi_MTS_ldc")).toBe(false);
    expect(pstnJoinName("Trunk_Sochi_Local")).toBeNull();
    expect(pstnJoinName("Service_IVR")).toBeNull();
  });

  it("strips only the last suffix when both appear", () => {
    expect(pstnJoinName("PSTN_X_Local_LDC")).toBe("PSTN_X_Local");
    expect(isPstnLdc("PSTN_X_Local_LDC")).toBe(true);
  });
});

describe("pairPstnRows", () => {
  it("merges Local and LDC onto one join row", () => {
    const rows = pairPstnRows([
      device("PSTN_Kazan_Tattelecom_Local", {
        inCalls: 10,
        inMinutes: 20,
        outCalls: 3,
        outMinutes: 4,
        parkingCalls: 1,
        parkingMinutes: 2,
        phantomCalls: 1,
        phantomMinutes: 2,
      }),
      device("PSTN_Kazan_Tattelecom_LDC", {
        inCalls: 99,
        inMinutes: 88,
        outCalls: 7,
        outMinutes: 9,
        parkingCalls: 5,
        parkingMinutes: 6,
        phantomCalls: 5,
        phantomMinutes: 6,
      }),
    ]);
    expect(rows).toEqual([
      {
        name: "PSTN_Kazan_Tattelecom",
        inCalls: 10,
        inMinutes: 20,
        outCalls: 3,
        outMinutes: 4,
        parkingCalls: 1,
        parkingMinutes: 2,
        phantomCalls: 1,
        phantomMinutes: 2,
        ldcCalls: 7,
        ldcMinutes: 9,
      },
    ]);
  });

  it("keeps Local-only and LDC-only rows with zeros on the missing side", () => {
    const rows = pairPstnRows([
      device("PSTN_OnlyLocal_Local", { inCalls: 2, inMinutes: 3 }),
      device("PSTN_OnlyLdc_LDC", { inCalls: 100, outCalls: 5, outMinutes: 8 }),
    ]);
    expect(rows).toEqual([
      {
        name: "PSTN_OnlyLdc",
        inCalls: 0,
        inMinutes: 0,
        outCalls: 0,
        outMinutes: 0,
        parkingCalls: 0,
        parkingMinutes: 0,
        phantomCalls: 0,
        phantomMinutes: 0,
        ldcCalls: 5,
        ldcMinutes: 8,
      },
      {
        name: "PSTN_OnlyLocal",
        inCalls: 2,
        inMinutes: 3,
        outCalls: 0,
        outMinutes: 0,
        parkingCalls: 0,
        parkingMinutes: 0,
        phantomCalls: 0,
        phantomMinutes: 0,
        ldcCalls: 0,
        ldcMinutes: 0,
      },
    ]);
  });

  it("treats unsuffixed PSTN names as the local side and pairs them with LDC", () => {
    const rows = pairPstnRows([
      device("PSTN_A", { inCalls: 4, outCalls: 1 }),
      device("PSTN_A_LDC", { outCalls: 6, outMinutes: 11 }),
    ]);
    expect(rows).toEqual([
      {
        name: "PSTN_A",
        inCalls: 4,
        inMinutes: 0,
        outCalls: 1,
        outMinutes: 0,
        parkingCalls: 0,
        parkingMinutes: 0,
        phantomCalls: 0,
        phantomMinutes: 0,
        ldcCalls: 6,
        ldcMinutes: 11,
      },
    ]);
  });

  it("sums local fields when Local and unsuffixed share a key", () => {
    const rows = pairPstnRows([
      device("PSTN_A_Local", { inCalls: 1, parkingCalls: 2 }),
      device("PSTN_A", { inCalls: 3, parkingCalls: 4 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "PSTN_A",
      inCalls: 4,
      parkingCalls: 6,
      ldcCalls: 0,
    });
  });

  it("does not merge different cities", () => {
    const rows = pairPstnRows([
      device("PSTN_Kazan_Tattelecom_Local", { inCalls: 1 }),
      device("PSTN_Sochi_MTS_LDC", { outCalls: 2 }),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      "PSTN_Kazan_Tattelecom",
      "PSTN_Sochi_MTS",
    ]);
  });

  it("uses only LDC outbound for Межгород and ignores LDC inbound/parking/phantom", () => {
    const rows = pairPstnRows([
      device("PSTN_X_LDC", {
        inCalls: 100,
        inMinutes: 200,
        outCalls: 5,
        outMinutes: 8,
        parkingCalls: 9,
        parkingMinutes: 10,
        phantomCalls: 11,
        phantomMinutes: 12,
      }),
    ]);
    expect(rows).toEqual([
      {
        name: "PSTN_X",
        inCalls: 0,
        inMinutes: 0,
        outCalls: 0,
        outMinutes: 0,
        parkingCalls: 0,
        parkingMinutes: 0,
        phantomCalls: 0,
        phantomMinutes: 0,
        ldcCalls: 5,
        ldcMinutes: 8,
      },
    ]);
  });

  it("skips Trunk_ rows and returns an empty list for an empty input", () => {
    expect(pairPstnRows([])).toEqual([]);
    expect(pairPstnRows([device("Trunk_MSK", { inCalls: 1 })])).toEqual([]);
  });

  it("sorts joined rows by name", () => {
    const rows = pairPstnRows([
      device("PSTN_Sochi_MTS_Local", { inCalls: 1 }),
      device("PSTN_Kazan_Tattelecom_LDC", { outCalls: 1 }),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      "PSTN_Kazan_Tattelecom",
      "PSTN_Sochi_MTS",
    ]);
  });
});
