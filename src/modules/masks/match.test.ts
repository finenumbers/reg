import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { maskFits, matchNumberMask, type MaskCandidate } from "@/modules/masks/match";
import { FREE_CALL_DIRECTION, MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";

function row(
  over: Partial<MaskCandidate> & Pick<MaskCandidate, "mask" | "sortIndex">,
): MaskCandidate {
  return {
    digitLength: over.mask.length,
    category: "Городской",
    abc: null,
    maskType: null,
    purchase: null,
    premium: null,
    ...over,
  };
}

describe("maskFits", () => {
  it("keeps one digit per letter and lets a letter equal a written digit", () => {
    expect(maskFits("00000", "00000")).toBe(true);
    expect(maskFits("00000", "00001")).toBe(false);
    expect(maskFits("ZZZZZ", "00000")).toBe(true);
    expect(maskFits("ZZZZZ", "00001")).toBe(false);
    expect(maskFits("00000X", "000001")).toBe(true);
    expect(maskFits("00000X", "000000")).toBe(true);
    expect(maskFits("A0000", "00000")).toBe(true);
    expect(maskFits("A0000", "50000")).toBe(true);
    expect(maskFits("XYZZZZZ", "1255555")).toBe(true);
    expect(maskFits("XYZZZZZ", "5555555")).toBe(false);
    expect(maskFits("AABB", "1122")).toBe(true);
    expect(maskFits("AABB", "1111")).toBe(false);
    expect(maskFits("ABAB", "1213")).toBe(false);
    expect(maskFits("XXXXX", "11111")).toBe(true);
    expect(maskFits("XXXXX", "11112")).toBe(false);
  });
});

describe("matchNumberMask", () => {
  const catalog = [
    row({ sortIndex: 0, mask: "00000" }),
    row({
      sortIndex: 1,
      mask: "ZZZZZ",
      maskType: "Платина",
      premium: "100",
      purchase: "50",
    }),
    row({ sortIndex: 2, mask: "00000X", digitLength: 6, maskType: "Ноль" }),
    row({
      sortIndex: 3,
      mask: "XYZZZZZ",
      category: "Мобильный",
      abc: "903",
      maskType: "Золотой",
      premium: "10",
    }),
    row({
      sortIndex: 4,
      mask: "AAAAAAA",
      category: "Городской",
      abc: "495",
      maskType: "Город",
      purchase: "1",
    }),
    row({
      sortIndex: 9,
      mask: "AAAAAAA",
      category: "Городской",
      abc: "7495",
      maskType: "Точный",
    }),
    row({
      sortIndex: 5,
      mask: "AAAAAAA",
      category: "Бесплатный вызов",
      maskType: "800",
    }),
    row({ sortIndex: 6, mask: "AAAAA", category: "Служебный", maskType: "Служебный" }),
  ];

  it("prefers the literal mask over a letter mask that has a type", () => {
    expect(
      matchNumberMask(
        { city: "Москва", cityAlert: false, abc: "7495", telephone: "00000" },
        catalog,
      ),
    ).toEqual({ mask: "00000", maskType: "", purchase: "", premium: "" });
  });

  it("uses a letter mask when no literal mask fits", () => {
    expect(
      matchNumberMask(
        { city: "Москва", cityAlert: false, abc: "7495", telephone: "11111" },
        catalog,
      ),
    ).toEqual({ mask: "ZZZZZ", maskType: "Платина", purchase: "50", premium: "100" });
  });

  it("matches a mobile DEF and a city code with the leading 7 removed", () => {
    expect(
      matchNumberMask(
        {
          city: MOBILE_RF_DIRECTION,
          cityAlert: true,
          abc: "903",
          telephone: "1255555",
        },
        catalog,
      ),
    ).toEqual({ mask: "XYZZZZZ", maskType: "Золотой", purchase: "", premium: "10" });
    expect(
      matchNumberMask(
        { city: "Москва", cityAlert: false, abc: "7495", telephone: "1111111" },
        catalog,
      ),
    ).toEqual({ mask: "AAAAAAA", maskType: "Точный", purchase: "", premium: "" });
  });

  it("uses the stripped ABC only when the exact screen ABC is absent", () => {
    const stripped = catalog.filter((item) => item.abc !== "7495");
    expect(
      matchNumberMask(
        { city: "Москва", cityAlert: false, abc: "7495", telephone: "1111111" },
        stripped,
      ),
    ).toEqual({ mask: "AAAAAAA", maskType: "Город", purchase: "1", premium: "" });
  });

  it("keeps a free-call category and leaves the other rows empty", () => {
    expect(
      matchNumberMask(
        {
          city: FREE_CALL_DIRECTION,
          cityAlert: false,
          abc: "7800",
          telephone: "1111111",
        },
        catalog,
      ),
    ).toEqual({ mask: "AAAAAAA", maskType: "800", purchase: "", premium: "" });
    expect(
      matchNumberMask(
        { city: "Служебный", cityAlert: true, abc: "7495", telephone: "11111" },
        catalog,
      ),
    ).toBeNull();
    expect(
      matchNumberMask(
        { city: "Москва", cityAlert: false, abc: "7495", telephone: "111111" },
        catalog,
      ),
    ).toBeNull();
    expect(
      matchNumberMask(
        { city: "Москва", cityAlert: false, abc: "7495", telephone: "11111111" },
        catalog,
      ),
    ).toBeNull();
    expect(
      matchNumberMask(
        { city: "", cityAlert: false, abc: "7495", telephone: "00000" },
        catalog,
      ),
    ).toBeNull();
  });
});

describe("rtu_mask_lookup sql", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20261113043000_rtu_screen_masks/migration.sql",
    ),
    "utf8",
  );

  it("keeps the category order and the literal-digit winner in the database", () => {
    expect(sql).toContain("trimmed_city = 'Мобильные РФ'");
    expect(sql).toContain("mapped := 'Мобильный'");
    expect(sql).toContain("trimmed_city = 'Бесплатный вызов'");
    expect(sql).toContain("mapped := 'Бесплатный вызов'");
    expect(sql.indexOf("Мобильные РФ")).toBeLessThan(sql.indexOf("city_alert IS TRUE"));
    expect(sql).toContain("mapped := 'Городской'");
    expect(sql).toContain("rtu_mask_fits");
    expect(sql).toContain("picked.literals DESC");
    expect(sql).toContain('"sortIndex"');
    expect(sql).toContain("Does not scan cdr_records");
    expect(sql).not.toMatch(/from\s+cdr_records/i);
  });
});
