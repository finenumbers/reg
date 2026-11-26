import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { writeCostEstimateXlsx } from "@/modules/cost-estimate/write-xlsx";
import {
  COST_ESTIMATE_COL,
  COST_ESTIMATE_OUTPUT_HEADERS,
} from "@/modules/cost-estimate/types";
import { CALL_TYPE } from "@/modules/traffic/call-class";

describe("writeCostEstimateXlsx", () => {
  it("writes A-номер, numeric charge cols, and a bold total outside autoFilter", async () => {
    const { buffer } = await writeCostEstimateXlsx([
      {
        dateDisplay: "2026-01-01",
        aNumberRaw: "",
        bNumberRaw: "+79031234567",
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        seconds: 4,
        minutes: 1,
        charge: "1000.00",
        network: "МТС",
        operator: "ПАО МТС",
        geography: "Москва",
        fillTone: "red",
      },
      {
        dateDisplay: "2026-01-02",
        aNumberRaw: "73831234567",
        bNumberRaw: "73839999999",
        callType: CALL_TYPE.local,
        direction: "г. Новосибирск",
        seconds: 60,
        minutes: 1,
        charge: "",
        network: "",
        operator: "Ростелеком",
        geography: "НСК",
        fillTone: null,
      },
      {
        dateDisplay: "2026-01-03",
        aNumberRaw: "",
        bNumberRaw: "73831234567",
        callType: CALL_TYPE.intercity,
        direction: "г. Новосибирск",
        seconds: 60,
        minutes: 1,
        charge: "9000.33",
        network: "",
        operator: "Ростелеком",
        geography: "НСК",
        fillTone: null,
      },
    ]);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).getCell(2).text).toBe("A-номер");
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.seconds + 1).text).toBe(
      "Секунды",
    );
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.charge + 1).text).toBe(
      "Стоимость",
    );

    expect(sheet.getRow(2).getCell(2).text).toBe("");
    expect(sheet.getRow(3).getCell(2).text).toBe("73831234567");

    const chargeCell = sheet.getRow(2).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(chargeCell.value).toBe(1000);
    expect(chargeCell.numFmt).toBe("0.00");

    const emptyCharge = sheet.getRow(3).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(emptyCharge.value === null || emptyCharge.value === "").toBe(true);

    const totalRow = sheet.getRow(5);
    const totalCell = totalRow.getCell(COST_ESTIMATE_COL.charge + 1);
    expect(totalCell.value).toBe("10 000,33");
    expect(totalCell.font?.bold).toBe(true);

    const filter = sheet.autoFilter;
    expect(filter).toBeTruthy();
    if (typeof filter === "string") {
      expect(filter.replace(/\$/g, "").toUpperCase()).toBe("A1:K4");
    } else if (filter && typeof filter === "object" && "to" in filter) {
      expect(filter.to).toEqual({
        row: 4,
        column: COST_ESTIMATE_OUTPUT_HEADERS.length,
      });
    }
  });
});
