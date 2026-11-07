import { describe, expect, it } from "vitest";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { geographyRowTone, type GeographyToneRow } from "@/modules/rtu/row-tone";

function row(over: Partial<GeographyToneRow> = {}): GeographyToneRow {
  return {
    operator: "МТС",
    supplier: "Ростелеком",
    category: "VIP",
    cityAlert: false,
    pstnStatus: "resolved",
    activation: "",
    missing: false,
    unregistered: false,
    ...over,
  };
}

describe("geographyRowTone", () => {
  it("paints a DID-only number red ahead of a blocked status", () => {
    expect(
      geographyRowTone(
        row({
          missing: true,
          activation: "Заблокировано",
          operator: MISSING_PSTN_LABEL,
          supplier: "",
          category: "",
          cityAlert: true,
          pstnStatus: "unresolved",
        }),
        { surface: "screen" },
      ),
    ).toBe("missing");
  });

  it("paints a blocked number black ahead of every other tone", () => {
    expect(
      geographyRowTone(
        row({
          activation: "Заблокировано",
          operator: MISSING_PSTN_LABEL,
          cityAlert: true,
          supplier: "",
          pstnStatus: "unresolved",
        }),
        { surface: "screen" },
      ),
    ).toBe("blocked");
    expect(
      geographyRowTone(row({ activation: "Заблокировано" }), { surface: "export" }),
    ).toBe("blocked");
    expect(
      geographyRowTone(row({ activation: "Активно", operator: MISSING_PSTN_LABEL }), {
        surface: "screen",
      }),
    ).toBe("operator");
  });

  it("paints a registry miss blue ahead of the tariff alert and a blank supplier", () => {
    expect(
      geographyRowTone(
        row({
          operator: MISSING_PSTN_LABEL,
          cityAlert: true,
          supplier: "",
          pstnStatus: "unresolved",
        }),
        { surface: "screen" },
      ),
    ).toBe("operator");
  });

  it("paints a number that cannot be a PSTN key blue before the lookup returns", () => {
    expect(
      geographyRowTone(row({ operator: "", pstnStatus: "unresolved", cityAlert: true }), {
        surface: "screen",
      }),
    ).toBe("operator");
  });

  it("trusts a real operator even when the stored status is still pending", () => {
    expect(
      geographyRowTone(
        row({ operator: "МТС", pstnStatus: "pending", cityAlert: true, supplier: "" }),
        { surface: "screen", lookupFailed: true },
      ),
    ).toBe("yellow");
  });

  it("leaves an in-flight cache miss for yellow or blue", () => {
    expect(
      geographyRowTone(
        row({
          operator: "",
          pstnStatus: "pending",
          cityAlert: true,
          supplier: "Ростелеком",
          category: "VIP",
        }),
        { surface: "screen" },
      ),
    ).toBe("yellow");
    expect(
      geographyRowTone(
        row({ operator: "", pstnStatus: "pending", supplier: "", category: "VIP" }),
        { surface: "screen" },
      ),
    ).toBe("blue");
  });

  it("paints a failed lookup blue and a pending export blue", () => {
    expect(
      geographyRowTone(row({ operator: "", pstnStatus: "pending" }), {
        surface: "screen",
        lookupFailed: true,
      }),
    ).toBe("operator");
    expect(
      geographyRowTone(
        row({ operator: "", pstnStatus: "pending", cityAlert: true, supplier: "" }),
        { surface: "export" },
      ),
    ).toBe("operator");
  });

  it("paints a live unregistered number under black and a DID-only row", () => {
    expect(
      geographyRowTone(
        row({
          unregistered: true,
          operator: MISSING_PSTN_LABEL,
          cityAlert: true,
          supplier: "",
          category: "",
        }),
        { surface: "screen" },
      ),
    ).toBe("unregistered");
    expect(
      geographyRowTone(row({ unregistered: true, activation: "Заблокировано" }), {
        surface: "screen",
      }),
    ).toBe("blocked");
    expect(
      geographyRowTone(row({ unregistered: true, missing: true }), { surface: "export" }),
    ).toBe("missing");
  });

  it("lets the tariff alert win over a blank category", () => {
    expect(
      geographyRowTone(row({ cityAlert: true, category: "" }), { surface: "screen" }),
    ).toBe("yellow");
  });

  it("paints blue when only one annotation is empty", () => {
    expect(geographyRowTone(row({ category: "" }), { surface: "screen" })).toBe("blue");
    expect(geographyRowTone(row({ supplier: "  " }), { surface: "screen" })).toBe("blue");
    expect(geographyRowTone(row(), { surface: "screen" })).toBe("none");
  });
});
