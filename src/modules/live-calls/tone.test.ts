import { describe, expect, it } from "vitest";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  liveCallCategory,
  liveCallDirection,
  liveCallTone,
  type LiveCallToneInput,
} from "@/modules/live-calls/tone";
import { CALL_CATEGORY } from "@/modules/traffic/call-class";
import { matchTariffAbc, type TariffAbcRate } from "@/modules/traffic/tariff-match";

const MOBILE: TariffAbcRate[] = [
  { direction: "Мобильный", abc: "79", sortIndex: 0, digitLengths: null },
];

const EIGHT: TariffAbcRate[] = [
  { direction: "Восьмёрка", abc: "8", sortIndex: 0, digitLengths: null },
];

const MOBILE_NUMBER = "79001112233";

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

  it("fills tariff direction only for the category already shown", () => {
    const outgoing = row({
      sideA: "Офис",
      sideB: "-",
      destName: "term",
      outB: MOBILE_NUMBER,
    });
    const padded = { ...outgoing, outB: ` ${MOBILE_NUMBER} ` };
    const redirect = row({ sourceName: "Redirect_1", destName: "term", outB: MOBILE_NUMBER });
    const incoming = row({ sideA: "-", sideB: "Офис", destName: "term", outB: MOBILE_NUMBER });
    const phantom = row({ outB: MOBILE_NUMBER });
    const check = row({
      sideA: "Офис",
      dialpeer: "Service_Check",
      destName: "term",
      outB: MOBILE_NUMBER,
    });
    const unknownSides = row({ sideA: "-", sideB: "-", destName: "term", outB: MOBILE_NUMBER });
    const blocked = row({
      sideA: "Офис",
      sideB: "-",
      destName: "term",
      outB: "89001234567",
    });
    const unmatched = row({
      sideA: "Офис",
      sideB: "-",
      destName: "term",
      outB: "49001112233",
    });

    expect(matchTariffAbc(MOBILE_NUMBER, MOBILE)?.direction).toBe("Мобильный");
    expect(liveCallCategory(outgoing, MOBILE, [], true, true)).toBe(CALL_CATEGORY.outgoing);
    expect(liveCallDirection(CALL_CATEGORY.outgoing, outgoing.outB, MOBILE)).toBe("Мобильный");
    expect(liveCallDirection(CALL_CATEGORY.outgoing, padded.outB, MOBILE)).toBe("Мобильный");
    expect(liveCallCategory(redirect, MOBILE, [], true, false)).toBe(CALL_CATEGORY.outgoing);
    expect(liveCallDirection(CALL_CATEGORY.outgoing, redirect.outB, MOBILE)).toBe("Мобильный");

    expect(liveCallCategory(incoming, MOBILE, [], true, true)).toBe(CALL_CATEGORY.incoming);
    expect(liveCallCategory(phantom, MOBILE, [], true, true)).toBe(CALL_CATEGORY.phantom);
    expect(liveCallCategory(check, MOBILE, [], true, false)).toBe(CALL_CATEGORY.check);
    expect(liveCallCategory(unknownSides, MOBILE, [], true, true)).toBe(CALL_CATEGORY.errors);
    expect(liveCallCategory(row(), MOBILE, [], false, true)).toBe("-");
    for (const number of [incoming.outB, phantom.outB, check.outB, unknownSides.outB]) {
      expect(liveCallDirection(CALL_CATEGORY.incoming, number, MOBILE)).toBe("");
      expect(liveCallDirection(CALL_CATEGORY.phantom, number, MOBILE)).toBe("");
      expect(liveCallDirection(CALL_CATEGORY.check, number, MOBILE)).toBe("");
      expect(liveCallDirection(CALL_CATEGORY.errors, number, MOBILE)).toBe("");
      expect(liveCallDirection("-", number, MOBILE)).toBe("");
    }

    expect(matchTariffAbc(blocked.outB, EIGHT)?.direction).toBe("Восьмёрка");
    expect(liveCallCategory(blocked, EIGHT, ["89"], true, true)).toBe(CALL_CATEGORY.errors);
    expect(liveCallDirection(CALL_CATEGORY.errors, blocked.outB, EIGHT)).toBe("");

    expect(liveCallCategory(unmatched, MOBILE, [], true, true)).toBe(CALL_CATEGORY.outgoing);
    expect(liveCallDirection(CALL_CATEGORY.outgoing, unmatched.outB, MOBILE)).toBe("");
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
