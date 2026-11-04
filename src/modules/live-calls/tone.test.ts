import { describe, expect, it } from "vitest";
import { PARKING_DST } from "@/modules/stats/classify";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";
import { liveCallCategory, liveCallTone, type LiveCallToneInput } from "@/modules/live-calls/tone";
import { CALL_CATEGORY } from "@/modules/traffic/call-class";

const MOBILE: TariffAbcRate[] = [
  { direction: "Мобильный", abc: "79", sortIndex: 0, digitLengths: null },
];

function row(patch: Partial<LiveCallToneInput> = {}): LiveCallToneInput {
  return {
    sideA: "-",
    sideB: "-",
    destName: PARKING_DST,
    sourceName: "gw",
    dialpeer: "",
    outB: "",
    connectedAt: "",
    ...patch,
  };
}

const connected = "2026-11-03 23:32:00";

describe("liveCallTone", () => {
  it("paints a phantom green before the call connects", () => {
    expect(liveCallTone(row(), [], [], true)).toBe("phantom");
    expect(liveCallTone(row({ connectedAt: connected }), [], [], true)).toBe("phantom");
    expect(liveCallTone(row({ sideA: "", sideB: "" }), [], [], true)).toBe("phantom");
  });

  it("paints incoming parking blue only after the connection stamp parses", () => {
    const incoming = row({ sideA: "-", sideB: "Офис", connectedAt: connected });
    expect(liveCallTone(incoming, [], [], true)).toBe("parking");
    expect(liveCallTone({ ...incoming, connectedAt: "" }, [], [], true)).toBeNull();
  });

  it("paints outgoing parking blue only when the live tariff accepts the B-number", () => {
    const outgoing = row({
      sideA: "Офис",
      sideB: "-",
      outB: "79001112233",
      connectedAt: connected,
    });
    expect(liveCallTone(outgoing, MOBILE, [], true)).toBe("parking");
    expect(liveCallTone(outgoing, [], [], true)).toBeNull();
  });

  it("paints a connected redirect on Service_Parking without a tariff", () => {
    const redirect = row({ sourceName: "Redirect_1", connectedAt: connected });
    expect(liveCallTone(redirect, [], [], true)).toBe("parking");
    expect(liveCallTone({ ...redirect, connectedAt: "" }, [], [], true)).toBeNull();
  });

  it("leaves a check, another device, and a near miss unpainted", () => {
    expect(
      liveCallTone(
        row({ sideA: "Офис", dialpeer: "Service_Check", connectedAt: connected }),
        MOBILE,
        [],
        true,
      ),
    ).toBeNull();
    expect(
      liveCallTone(
        row({ destName: "term", sideA: "Офис", connectedAt: connected }),
        [],
        [],
        true,
      ),
    ).toBeNull();
    expect(liveCallTone(row({ destName: "Service_Parking_1" }), [], [], true)).toBeNull();
    expect(liveCallTone(row({ destName: " Service_Parking" }), [], [], true)).toBeNull();
    expect(
      liveCallTone(
        row({ sideA: "Офис", outB: "200", connectedAt: connected }),
        MOBILE,
        [],
        true,
      ),
    ).toBeNull();
    expect(
      liveCallTone(
        row({ sideA: "Офис", outB: "79001112233", connectedAt: connected }),
        MOBILE,
        [],
        true,
      ),
    ).toBe("parking");
  });

  it("labels the row with the traffic category", () => {
    const outgoing = row({
      sideA: "Офис",
      sideB: "-",
      destName: "term",
      outB: "79001112233",
    });
    expect(liveCallCategory(outgoing, MOBILE, [], true, true)).toBe(CALL_CATEGORY.outgoing);
    expect(liveCallCategory(outgoing, [], [], true, false)).toBe("-");
    expect(liveCallCategory(outgoing, [], [], true, true)).toBe(CALL_CATEGORY.errors);
    expect(liveCallCategory(row(), [], [], false, true)).toBe("-");
    expect(
      liveCallCategory(
        row({ sideA: "Офис", outB: "*123", destName: "term" }),
        [],
        [],
        true,
        false,
      ),
    ).toBe(CALL_CATEGORY.errors);
    expect(
      liveCallCategory(row({ sourceName: "Redirect_1" }), [], [], true, false),
    ).toBe(CALL_CATEGORY.outgoing);
    expect(liveCallCategory(row(), [], [], true, false)).toBe(CALL_CATEGORY.phantom);
    expect(
      liveCallCategory(
        row({ sideA: "Офис", dialpeer: "Service_Check", destName: "term", outB: "79001112233" }),
        [],
        [],
        true,
        false,
      ),
    ).toBe(CALL_CATEGORY.check);
  });

  it("does not paint when the catalog read failed", () => {
    expect(liveCallTone(row(), [], [], false)).toBeNull();
    expect(
      liveCallTone(
        row({ sideA: "Офис", outB: "79001112233", connectedAt: connected }),
        MOBILE,
        [],
        false,
      ),
    ).toBeNull();
  });
});
