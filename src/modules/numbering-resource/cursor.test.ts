import { describe, expect, it } from "vitest";
import { encodeNumberingCursor } from "@/modules/numbering-resource/cursor";
import type { NumberingRow } from "@/modules/numbering-resource/types";

const row: NumberingRow = {
  id: 42,
  abc: "499",
  rangeStart: 6660000,
  rangeEnd: 6669999,
  capacity: 10000,
  operator: "ООО «Ростелеком»",
  garTerritory: "г. Москва",
  inn: "7707049388",
  uvrAntifraud: 7,
};

function pstnDecode(encoded: string): Record<string, unknown> {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe("numbering cursor", () => {
  it("round-trips the PSTN keyset fields as numbers", () => {
    const encoded = encodeNumberingCursor(row);
    expect(encoded).toBeTruthy();
    const decoded = pstnDecode(encoded!);
    expect(decoded).toEqual({
      id: 42,
      abc: "499",
      rangeStart: 6660000,
      rangeEnd: 6669999,
      capacity: 10000,
      operator: "ООО «Ростелеком»",
      garTerritory: "г. Москва",
      inn: "7707049388",
    });
    expect(typeof decoded.rangeStart).toBe("number");
    expect(decoded).not.toHaveProperty("uvrAntifraud");
  });

  it("does not encode id 0", () => {
    expect(encodeNumberingCursor({ ...row, id: 0 })).toBeNull();
  });
});
