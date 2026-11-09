import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { workbookToBuffer } from "@/lib/xlsx-export";
import { parseTariffXlsx } from "@/modules/tariffs/parse-xlsx";
import {
  buildTariffExportWorkbook,
  tariffExportCells,
} from "@/modules/tariffs/xlsx-export";

const minsk = {
  direction: "Минск",
  region: "Беларусь",
  abc: "375",
  digitLengths: "12/13",
  numbering: "12/13",
  price: "-1.5",
};

describe("tariff XLSX export", () => {
  it("round-trips slash lengths and a negative price", async () => {
    const workbook = buildTariffExportWorkbook([
      minsk,
      {
        direction: "Москва",
        region: null,
        abc: "7495",
        digitLengths: "11",
        numbering: "7",
        price: "1.25",
      },
    ]);
    const sheet = workbook.getWorksheet("Тарифы");
    expect(sheet?.getRow(2).getCell(4).numFmt).toBe("@");
    expect(sheet?.getRow(2).getCell(3).numFmt).toBe("@");
    const parsed = await parseTariffXlsx(await workbookToBuffer(workbook));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      {
        sortIndex: 0,
        direction: "Минск",
        region: "Беларусь",
        abc: "375",
        digitLengths: [12, 13],
        numbering: [12, 13],
        price: "-1.5",
      },
      {
        sortIndex: 1,
        direction: "Москва",
        region: null,
        abc: "7495",
        digitLengths: null,
        numbering: [7],
        price: "1.25",
      },
    ]);
  });

  it("writes an empty digit length for an ABC on 7 and prefixes a formula", () => {
    expect(
      tariffExportCells({
        direction: "=cmd",
        region: null,
        abc: "7495",
        digitLengths: "11",
        numbering: null,
        price: "-1.5",
      }),
    ).toEqual(["'=cmd", "", "7495", "", "", "-1.5"]);
  });

  it("keeps 12/13 as text after a write", async () => {
    const workbook = buildTariffExportWorkbook([minsk]);
    const again = new ExcelJS.Workbook();
    await again.xlsx.load((await workbookToBuffer(workbook)) as never);
    const length = again.getWorksheet("Тарифы")?.getRow(2).getCell(4).value;
    expect(length).toBe("12/13");
  });
});
