import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  XLSX_COST_ESTIMATE_TOTAL_FILL,
  XLSX_OPRS_MTS_FILL,
  XLSX_REGISTRY_MISSING_FILL,
} from "@/modules/cost-estimate/fills";
import { writeCostEstimateXlsx } from "@/modules/cost-estimate/write-xlsx";
import {
  COST_ESTIMATE_COL,
  COST_ESTIMATE_LOCAL_CHARGE,
  COST_ESTIMATE_OUTPUT_HEADERS,
} from "@/modules/cost-estimate/types";
import { CALL_TYPE } from "@/modules/traffic/call-class";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";

describe("writeCostEstimateXlsx", () => {
  it("writes numeric phones, formats, and a green total outside autoFilter", async () => {
    const { buffer } = await writeCostEstimateXlsx([
      {
        dateDisplay: "2026-01-01",
        aNumberRaw: "",
        bNumberRaw: "+79031234567",
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        region: "",
        seconds: 4,
        minutes: 1,
        price: "3",
        charge: "1000.00",
        network: "МТС",
        operator: "ПАО МТС",
        geography: "Москва",
        fillTone: "red",
        registryMissing: false,
      },
      {
        dateDisplay: "2026-01-02",
        aNumberRaw: "73831234567",
        bNumberRaw: "73839999999",
        callType: CALL_TYPE.local,
        direction: "г. Новосибирск",
        region: "Московская область",
        seconds: 60,
        minutes: 1,
        price: "1.5",
        charge: COST_ESTIMATE_LOCAL_CHARGE,
        network: "-",
        operator: "Ростелеком",
        geography: "НСК",
        fillTone: null,
        registryMissing: false,
      },
      {
        dateDisplay: "2026-01-03",
        aNumberRaw: "",
        bNumberRaw: "73831234567",
        callType: CALL_TYPE.intercity,
        direction: "г. Новосибирск",
        region: "Московская область",
        seconds: 60,
        minutes: 1,
        price: "1.5",
        charge: "9000.33",
        network: "-",
        operator: "Ростелеком",
        geography: "НСК",
        fillTone: null,
        registryMissing: false,
      },
    ]);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).getCell(2).text).toBe("A-номер");
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.seconds + 1).text).toBe(
      "Секунды",
    );
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.price + 1).text).toBe("Цена");
    expect(sheet.getRow(1).getCell(COST_ESTIMATE_COL.charge + 1).text).toBe(
      "Стоимость",
    );
    expect(sheet.getRow(1).getCell(11).text).toBe("Сеть ОПРС");
    expect(sheet.getRow(1).getCell(12).text).toBe(
      "Оператор связи (реестр МинЦифры)",
    );
    expect(sheet.getRow(1).getCell(2).alignment?.horizontal).toBe("center");

    const emptyA = sheet.getRow(2).getCell(COST_ESTIMATE_COL.aNumber + 1);
    expect(emptyA.value === null || emptyA.value === "").toBe(true);

    const bPlus = sheet.getRow(2).getCell(COST_ESTIMATE_COL.bNumber + 1);
    expect(bPlus.value).toBe(79031234567);
    expect(bPlus.numFmt).toBe("0");
    expect(bPlus.alignment?.horizontal).toBe("left");

    const aDigits = sheet.getRow(3).getCell(COST_ESTIMATE_COL.aNumber + 1);
    expect(aDigits.value).toBe(73831234567);
    expect(aDigits.numFmt).toBe("0");
    expect(aDigits.alignment?.horizontal).toBe("left");

    const secondsCell = sheet.getRow(2).getCell(COST_ESTIMATE_COL.seconds + 1);
    expect(secondsCell.value).toBe(4);
    expect(secondsCell.numFmt).toBe("#,##0");

    const priceCell = sheet.getRow(2).getCell(COST_ESTIMATE_COL.price + 1);
    expect(priceCell.value).toBe(3);
    expect(priceCell.numFmt).toBe("#,##0.00");
    expect(priceCell.alignment?.horizontal).toBe("right");

    const chargeCell = sheet.getRow(2).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(chargeCell.value).toBe(1000);
    expect(chargeCell.numFmt).toBe("#,##0.00");
    expect(chargeCell.alignment?.horizontal).toBe("right");

    const localCharge = sheet.getRow(3).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(localCharge.value).toBe(COST_ESTIMATE_LOCAL_CHARGE);
    expect(localCharge.alignment?.horizontal).toBe("right");

    const mobileType = sheet.getRow(2).getCell(4);
    expect(mobileType.font?.bold).toBe(true);
    const localType = sheet.getRow(3).getCell(4);
    expect(localType.font?.bold).not.toBe(true);
    const localB = sheet
      .getRow(3)
      .getCell(COST_ESTIMATE_COL.bNumber + 1);
    expect(localB.font?.bold).toBe(true);

    const mtsFill = sheet.getRow(2).getCell(1).fill as ExcelJS.FillPattern;
    expect(mtsFill.fgColor?.argb).toBe(
      (XLSX_OPRS_MTS_FILL as ExcelJS.FillPattern).fgColor?.argb,
    );

    const totalRow = sheet.getRow(5);
    const totalCell = totalRow.getCell(COST_ESTIMATE_COL.charge + 1);
    expect(totalCell.value).toBe(10000.33);
    expect(totalCell.numFmt).toBe("#,##0.00");
    expect(totalCell.font?.bold).toBe(true);
    expect(totalCell.alignment?.horizontal).toBe("right");
    const totalFill = totalCell.fill as ExcelJS.FillPattern;
    expect(totalFill.fgColor?.argb).toBe(
      (XLSX_COST_ESTIMATE_TOTAL_FILL as ExcelJS.FillPattern).fgColor?.argb,
    );
    expect(totalCell.border?.top?.style).toBe("medium");
    expect(totalCell.border?.left?.style).toBe("medium");

    const emptyFooter = totalRow.getCell(1);
    const emptyFill = emptyFooter.fill as ExcelJS.FillPattern | undefined;
    expect(emptyFill?.fgColor?.argb).not.toBe(
      (XLSX_COST_ESTIMATE_TOTAL_FILL as ExcelJS.FillPattern).fgColor?.argb,
    );
    expect(emptyFooter.border?.top).toBeUndefined();

    const filter = sheet.autoFilter;
    expect(filter).toBeTruthy();
    if (typeof filter === "string") {
      expect(filter.replace(/\$/g, "").toUpperCase()).toBe("A1:M4");
    } else if (filter && typeof filter === "object" && "to" in filter) {
      expect(filter.to).toEqual({
        row: 4,
        column: COST_ESTIMATE_OUTPUT_HEADERS.length,
      });
    }
  });

  it("paints registry-missing rows black with white font and excludes empty charge from the total", async () => {
    const { buffer } = await writeCostEstimateXlsx([
      {
        dateDisplay: "2026-01-01 10:00:00",
        aNumberRaw: "",
        bNumberRaw: "79031234567",
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        region: "",
        seconds: 10,
        minutes: 1,
        price: "3",
        charge: "",
        network: "",
        operator: MISSING_PSTN_LABEL,
        geography: MISSING_PSTN_LABEL,
        fillTone: null,
        registryMissing: true,
      },
      {
        dateDisplay: "2026-01-02 11:00:00",
        aNumberRaw: "",
        bNumberRaw: "73831234567",
        callType: CALL_TYPE.intercity,
        direction: "г. Новосибирск",
        region: "Московская область",
        seconds: 60,
        minutes: 1,
        price: "1.5",
        charge: "1.50",
        network: "-",
        operator: "Ростелеком",
        geography: "НСК",
        fillTone: null,
        registryMissing: false,
      },
    ]);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0]!;

    const missCell = sheet.getRow(2).getCell(1);
    const blackFill = missCell.fill as ExcelJS.FillPattern;
    expect(blackFill.fgColor?.argb).toBe(
      (XLSX_REGISTRY_MISSING_FILL as ExcelJS.FillPattern).fgColor?.argb,
    );
    expect(blackFill.fgColor?.argb).toBe("FF000000");
    expect(missCell.font?.color?.argb).toBe("FFFFFFFF");
    expect(sheet.getRow(2).getCell(4).font?.bold).toBe(true);
    expect(sheet.getRow(2).getCell(COST_ESTIMATE_COL.charge + 1).value).toBe(
      "",
    );

    const intercityFill = sheet.getRow(3).getCell(1).fill as
      | ExcelJS.FillPattern
      | undefined;
    expect(intercityFill?.fgColor?.argb).not.toBe("FF000000");
    expect(sheet.getRow(3).getCell(4).font?.bold).not.toBe(true);

    const totalCell = sheet.getRow(4).getCell(COST_ESTIMATE_COL.charge + 1);
    expect(totalCell.value).toBe(1.5);
    expect(totalCell.numFmt).toBe("#,##0.00");
  });
});
