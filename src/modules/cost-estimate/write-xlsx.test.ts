import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { writeCostEstimateXlsx } from "@/modules/cost-estimate/write-xlsx";
import {
  COST_ESTIMATE_COL,
  COST_ESTIMATE_OUTPUT_HEADERS,
} from "@/modules/cost-estimate/types";
import { CALL_TYPE } from "@/modules/traffic/call-class";

describe("writeCostEstimateXlsx", () => {
  it("writes numeric seconds/minutes/charge and a bold total outside autoFilter", async () => {
    const { buffer } = await writeCostEstimateXlsx([
      {
        dateDisplay: "2026-01-01",
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
      {
        dateDisplay: "2026-01-03",
        bNumberRaw: "442071234567",
        callType: CALL_TYPE.international,
        direction: "",
        seconds: 10,
        minutes: 1,
        charge: "",
        network: "",
        operator: "",
        geography: "",
        fillTone: null,
      },
    ]);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.seconds + 1).text).toBe(
      "Секунды",
    );
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.minutes + 1).text).toBe(
      "Минуты",
    );
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.charge + 1).text).toBe(
      "Стоимость",
    );

    const secondsCell = sheet.getRow(2).getCell(COST_ESTIMATE_COL.seconds + 1);
    expect(secondsCell.value).toBe(4);
    expect(secondsCell.numFmt).toBe("0");

    const chargeCell = sheet.getRow(2).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(chargeCell.value).toBe(1000);
    expect(chargeCell.numFmt).toBe("0.00");

    const emptyCharge = sheet.getRow(4).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(emptyCharge.value === null || emptyCharge.value === "").toBe(true);

    const totalRow = sheet.getRow(5);
    const totalCell = totalRow.getCell(COST_ESTIMATE_COL.charge + 1);
    expect(totalCell.value).toBe("10 000,33");
    expect(totalCell.font?.bold).toBe(true);
    expect(totalRow.getCell(1).value === null || totalRow.getCell(1).value === "").toBe(
      true,
    );

    const filter = sheet.autoFilter;
    expect(filter).toBeTruthy();
    if (typeof filter === "string") {
      expect(filter.replace(/\$/g, "").toUpperCase()).toBe("A1:J4");
    } else if (filter && typeof filter === "object" && "to" in filter) {
      expect(filter.to).toEqual({
        row: 4,
        column: COST_ESTIMATE_OUTPUT_HEADERS.length,
      });
    }
  });
});
