import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cityDigitSplit } from "@/modules/number-geography/city-digit-split";

const MIGRATION = path.join(
  process.cwd(),
  "prisma/migrations/20261107161000_tariff_region/migration.sql",
);

function functionBody(sql: string, name: string): string {
  const marker = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION ${name}\\b[\\s\\S]*?AS \\$fn\\$([\\s\\S]*?)\\$fn\\$`,
  );
  return marker.exec(sql)?.[1] ?? "";
}

describe("cityDigitSplit", () => {
  it("strips one trailing tariff digit for Владивосток and leaves the krai row whole", () => {
    expect(cityDigitSplit("74232234567", "74232", [7])).toEqual({
      abc: "7423",
      telephone: "2234567",
    });
    expect(cityDigitSplit("74232234567", "7423", null)).toEqual({
      abc: "7423",
      telephone: "2234567",
    });
  });

  it("strips two trailing tariff digits for Красноярск and Обнинск", () => {
    expect(cityDigitSplit("73919823456", "739198", [7])).toEqual({
      abc: "7391",
      telephone: "9823456",
    });
    expect(cityDigitSplit("74843923456", "748439", [7])).toEqual({
      abc: "7484",
      telephone: "3923456",
    });
    expect(cityDigitSplit("74845823456", "748458", [7])).toEqual({
      abc: "7484",
      telephone: "5823456",
    });
  });

  it("strips one digit for Миасс and nothing when the numbering already fits", () => {
    expect(cityDigitSplit("73513523456", "735135", [6])).toEqual({
      abc: "73513",
      telephone: "523456",
    });
    expect(cityDigitSplit("73882234567", "738822", [5])).toEqual({
      abc: "738822",
      telephone: "34567",
    });
    expect(cityDigitSplit("78472234567", "784722", [5])).toEqual({
      abc: "784722",
      telephone: "34567",
    });
  });

  it("leaves a mobile code and an empty numbering on the tariff ABC", () => {
    expect(cityDigitSplit("79001234567", "79", null)).toEqual({
      abc: "79",
      telephone: "001234567",
    });
    expect(cityDigitSplit("74232234567", "74232", [])).toEqual({
      abc: "74232",
      telephone: "234567",
    });
    expect(cityDigitSplit("74232234567", "74232", [0])).toEqual({
      abc: "74232",
      telephone: "234567",
    });
  });

  it("does not choose among two numbering values that would both trim", () => {
    expect(cityDigitSplit("739198234567", "739198", [7, 8])).toEqual({
      abc: "739198",
      telephone: "234567",
    });
    expect(cityDigitSplit("74232234567", "74232", [0, 7])).toEqual({
      abc: "7423",
      telephone: "2234567",
    });
  });

  it("trims the matched number, not a prefix taken from the phone", () => {
    expect(cityDigitSplit("  74232234567 ", "74232", [7])).toEqual({
      abc: "7423",
      telephone: "2234567",
    });
    expect(cityDigitSplit("74232234567", "", [7])).toEqual({ abc: "", telephone: "" });
    expect(cityDigitSplit("84232234567", "74232", [7])).toEqual({
      abc: "74232",
      telephone: "",
    });
  });
});

describe("geography_digit_split sql", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = functionBody(sql, "geography_digit_split");

  it("removes a suffix of the tariff ABC and ignores every other numbering value", () => {
    expect(body).toContain("left(tariff_abc, length(tariff_abc) - chosen.overlap)");
    expect(body).toContain("count(*) = 1");
    expect(body).toContain("> 0");
    expect(body).toContain("< length(tariff_abc)");
    expect(body).not.toContain("left(trimmed.number");
    expect(body).not.toContain("left(raw_number");
  });

  it("does not replace the CDR rater", () => {
    expect(sql).toContain("CREATE FUNCTION cdr_tariff_geo");
    expect(sql).toContain("CREATE FUNCTION geography_digit_split");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION cdr_tariff_direction");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION cdr_tariff_abc");
    expect(sql).not.toContain("FUNCTION cdr_rate_call");
    expect(sql).not.toContain("DROP FUNCTION");
  });
});
