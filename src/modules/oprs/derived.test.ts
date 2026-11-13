import { describe, expect, it } from "vitest";
import { OPRS_TONE_FIELD } from "@/modules/oprs/operator-tone";
import {
  attachOprsDerived,
  oprsCatalogCells,
  oprsNetworkLabel,
  stampOprsRow,
  type OprsCatalogLabels,
} from "@/modules/oprs/derived";

const labels: OprsCatalogLabels = {
  labelMts: "мтс-метка",
  labelMegafon: "мега-метка",
  labelBeeline: "би-метка",
  labelT2: "т2-метка",
  mavMts: "мтс-мав",
  mavMegafon: "мега-мав",
  mavBeeline: "би-мав",
  mavT2: "т2-мав",
};

const catalog = new Map<string, OprsCatalogLabels>([["74951234567", labels]]);

function row(patch: Record<string, string> = {}): Record<string, string> {
  return { operator_b: "ПАО МТС", bill_ani: "74951234567", ...patch };
}

describe("oprs network and catalog cells", () => {
  it("names the brand from the color and reads that pair", () => {
    expect(oprsNetworkLabel("red")).toBe("МТС");
    expect(oprsNetworkLabel("green")).toBe("Мегафон");
    expect(oprsNetworkLabel("yellow")).toBe("Билайн");
    expect(oprsNetworkLabel("gray")).toBe("Т2");
    expect(oprsNetworkLabel(null)).toBe("");
    expect(oprsCatalogCells("МТС", labels)).toEqual({
      marking: "мтс-метка",
      mav: "мтс-мав",
    });
    expect(oprsCatalogCells("Мегафон", labels)).toEqual({
      marking: "мега-метка",
      mav: "мега-мав",
    });
    expect(oprsCatalogCells("Билайн", labels)).toEqual({
      marking: "би-метка",
      mav: "би-мав",
    });
    expect(oprsCatalogCells("Т2", labels)).toEqual({
      marking: "т2-метка",
      mav: "т2-мав",
    });
    expect(oprsCatalogCells("", labels)).toEqual({ marking: "", mav: "" });
    expect(oprsCatalogCells("МТС", undefined)).toEqual({ marking: "", mav: "" });
  });

  it("stamps a red row from the trimmed A-number and clears a blocked or unknown row", () => {
    const painted = row();
    stampOprsRow(painted, {
      blocked: false,
      tones: { "ПАО МТС": "red" },
      labels: catalog,
    });
    expect(painted[OPRS_TONE_FIELD]).toBe("red");
    expect(painted.oprs_network).toBe("МТС");
    expect(painted.oprs_marking).toBe("мтс-метка");
    expect(painted.oprs_mav).toBe("мтс-мав");

    const padded = row({ bill_ani: "  74951234567  " });
    stampOprsRow(padded, {
      blocked: false,
      tones: { "ПАО МТС": "gray" },
      labels: catalog,
    });
    expect(padded.oprs_network).toBe("Т2");
    expect(padded.oprs_marking).toBe("т2-метка");
    expect(padded.oprs_mav).toBe("т2-мав");

    const blocked = row({ bill_dnis: "70000000000" });
    stampOprsRow(blocked, {
      blocked: true,
      tones: { "ПАО МТС": "red" },
      labels: catalog,
    });
    expect(blocked[OPRS_TONE_FIELD]).toBe("");
    expect(blocked.oprs_network).toBe("");
    expect(blocked.oprs_marking).toBe("");
    expect(blocked.oprs_mav).toBe("");

    const missing = row({ bill_ani: "70000000099" });
    stampOprsRow(missing, {
      blocked: false,
      tones: { "ПАО МТС": "yellow" },
      labels: catalog,
    });
    expect(missing.oprs_network).toBe("Билайн");
    expect(missing.oprs_marking).toBe("");
    expect(missing.oprs_mav).toBe("");

    const blank = row({ operator_b: "" });
    stampOprsRow(blank, {
      blocked: false,
      tones: { "ПАО МТС": "green" },
      labels: catalog,
    });
    expect(blank.oprs_network).toBe("");
    expect(blank.oprs_marking).toBe("");
    expect(blank.oprs_mav).toBe("");
  });

  it("paints from the supplied catalog and does not read it again", async () => {
    const painted = row();
    const blocked = row();
    await attachOprsDerived(
      [
        { data: painted },
        { blocked: true, data: blocked },
      ],
      { tones: { "ПАО МТС": "red" }, labels: catalog },
    );
    expect(painted.oprs_network).toBe("МТС");
    expect(painted.oprs_marking).toBe("мтс-метка");
    expect(blocked.oprs_network).toBe("");
    expect(blocked.oprs_marking).toBe("");

    const cold = row();
    await attachOprsDerived([{ data: cold }], {
      tones: { "ПАО МТС": "red" },
      labels: new Map(),
    });
    expect(cold.oprs_network).toBe("МТС");
    expect(cold.oprs_marking).toBe("");
  });
});
