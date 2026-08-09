import { describe, expect, it } from "vitest";
import {
  buildUfwSheets,
  mergeAddressLists,
  UFW_GROUP_OPERATOR,
  UFW_GROUP_REGISTRATION,
  UFW_GROUP_TRUNK,
  UFW_HEADERS,
  UFW_RTU_FILL,
  UFW_SHEET_GATEWAYS,
  UFW_SHEET_REGISTERED,
  UFW_SHEET_UNREGISTERED,
  workbookFromUfwSheets,
} from "@/modules/phones/ufw-export";
import type { PhoneRowData } from "@/modules/phones/types";

describe("mergeAddressLists", () => {
  it("merges, trims, and dedupes preserving order", () => {
    expect(mergeAddressLists("1.1.1.1; 2.2.2.2", "2.2.2.2,3.3.3.3")).toBe(
      "1.1.1.1;2.2.2.2;3.3.3.3",
    );
  });

  it("returns empty for blank inputs", () => {
    expect(mergeAddressLists("", null, undefined, "  ; ,")).toBe("");
  });
});

describe("buildUfwSheets", () => {
  it("maps gateways and endpoints to three sheets and skips empty IPs", () => {
    const gateways: PhoneRowData[] = [
      {
        Название: "gw1",
        Описание: "Gate A",
        "ИНИЦ. список адресов": "10.0.0.1",
        "ТЕРМ. список адресов": "10.0.0.2",
      },
      {
        Название: "gw-empty",
        Описание: "No IPs",
        "ИНИЦ. список адресов": "",
        "ТЕРМ. список адресов": "",
      },
    ];
    const endpoints: PhoneRowData[] = [
      {
        Название: "ep-reg",
        Описание: "Reg trunk",
        Регистрация: "Да",
        "Список разрешенных адресов для регистрации": "8.8.8.8",
        "ИНИЦ. список адресов": "1.1.1.1",
      },
      {
        Название: "ep-trunk",
        Описание: "No reg",
        Регистрация: "Нет",
        "ИНИЦ. список адресов": "9.9.9.9",
        "ТЕРМ. список адресов": "",
      },
      {
        Название: "ep-reg-empty",
        Описание: "Reg empty",
        Регистрация: "Да",
        "Список разрешенных адресов для регистрации": "",
      },
    ];

    const sheets = buildUfwSheets({ gateways, endpoints });
    expect(sheets.gateways).toEqual([
      {
        group: UFW_GROUP_OPERATOR,
        rtu: "gw1",
        name: "Gate A",
        fromAddress: "10.0.0.1;10.0.0.2",
      },
    ]);
    expect(sheets.registered).toEqual([
      {
        group: UFW_GROUP_REGISTRATION,
        rtu: "ep-reg",
        name: "Reg trunk",
        fromAddress: "8.8.8.8",
      },
    ]);
    expect(sheets.unregistered).toEqual([
      {
        group: UFW_GROUP_TRUNK,
        rtu: "ep-trunk",
        name: "No reg",
        fromAddress: "9.9.9.9",
      },
    ]);
  });
});

describe("workbookFromUfwSheets", () => {
  it("writes three sheets with orange rtu column fill", async () => {
    const wb = workbookFromUfwSheets({
      gateways: [
        {
          group: UFW_GROUP_OPERATOR,
          rtu: "gw1",
          name: "desc",
          fromAddress: "1.2.3.4",
        },
      ],
      registered: [],
      unregistered: [],
    });

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      UFW_SHEET_GATEWAYS,
      UFW_SHEET_REGISTERED,
      UFW_SHEET_UNREGISTERED,
    ]);

    const sheet = wb.getWorksheet(UFW_SHEET_GATEWAYS)!;
    expect(UFW_HEADERS.map((_, i) => String(sheet.getRow(1).getCell(i + 1).value))).toEqual(
      [...UFW_HEADERS],
    );

    const headerRtu = sheet.getRow(1).getCell(2);
    const dataRtu = sheet.getRow(2).getCell(2);
    expect(headerRtu.value).toBe("rtu");
    expect(dataRtu.value).toBe("gw1");
    expect(headerRtu.fill).toMatchObject(UFW_RTU_FILL);
    expect(dataRtu.fill).toMatchObject(UFW_RTU_FILL);
    expect(sheet.getRow(2).getCell(7).value).toBe("1.2.3.4");
    expect(sheet.getRow(2).getCell(4).value).toBe("ALLOW");
    expect(sheet.getRow(2).getCell(13).value).toBe(false);
  });
});
