import { describe, expect, it } from "vitest";
import {
  combineAuroraFiles,
  decodeAuroraCsv,
  parseCommaCsv,
  shouldPublishAurora,
} from "@/modules/aurora/parse";

const SHORT_HEADER = `"Column 1","Column 2","Column 3","Column 4","Column 5"`;
const FULL_HEADER = `"Column 1","Column 2","Column 3","Column 4","Column 5","Column 6"`;

function shortRow(phone: string, price: string): string {
  return `"${phone}","ЗОЛОТОЙ","${price}","г. Симферополь|Республика Крым","[ AA ]"`;
}

function fullRow(phone: string, price: string, status = "СВОБОДЕН"): string {
  return `"${phone}","${status}","ЗОЛОТОЙ","${price}","г. Москва","[ AA, BB ]"`;
}

describe("Aurora CSV", () => {
  it("reads the short price from column 3 and the full price from column 4", () => {
    const parsed = combineAuroraFiles([
      {
        name: "short.csv",
        format: "short",
        text: `${SHORT_HEADER}\n${shortRow("+7 (3652) 777117", "15990 Руб.")}\n`,
      },
      {
        name: "long.csv",
        format: "full",
        text: `${FULL_HEADER}\r\n${fullRow("+7 (495) 2360003", "5990 Руб.")}\r\n`,
      },
    ]);
    expect(parsed).toEqual({
      ok: true,
      read: 2,
      dropped: 0,
      rows: [
        { e164: "73652777117", incomingPurchase: "15990" },
        { e164: "74952360003", incomingPurchase: "5990" },
      ],
    });
  });

  it("keeps the first price when the same number is in a later file", () => {
    const parsed = combineAuroraFiles([
      {
        name: "a.csv",
        format: "short",
        text: `${SHORT_HEADER}\n${shortRow("+7 (3652) 777117", "15990 Руб.")}\n${shortRow("+7 (3652) 777117", "990 Руб.")}\n`,
      },
      {
        name: "b.csv",
        format: "full",
        text: `${FULL_HEADER}\n${fullRow("+7 (3652) 777117", "5990 Руб.")}\n`,
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.dropped).toBe(2);
    expect(parsed.rows).toEqual([{ e164: "73652777117", incomingPurchase: "15990" }]);
  });

  it("stores a contractual price as an empty purchase", () => {
    const parsed = combineAuroraFiles([
      {
        name: "short.csv",
        format: "short",
        text: `${SHORT_HEADER}\n${shortRow("+7 (36522) 55500", "ДОГОВОРНАЯ")}\n`,
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([{ e164: "73652255500", incomingPurchase: "" }]);
  });

  it("rejects an 8-prefix, a foreign price, and the wrong layout", () => {
    const eight = combineAuroraFiles([
      {
        name: "short.csv",
        format: "short",
        text: `${SHORT_HEADER}\n${shortRow("+8 (3652) 777117", "990 Руб.")}\n`,
      },
    ]);
    expect(eight.ok).toBe(false);

    const price = combineAuroraFiles([
      {
        name: "short.csv",
        format: "short",
        text: `${SHORT_HEADER}\n${shortRow("+7 (3652) 777117", "990 руб")}\n`,
      },
    ]);
    expect(price.ok).toBe(false);

    const layout = combineAuroraFiles([
      {
        name: "long.csv",
        format: "short",
        text: `${FULL_HEADER}\n${fullRow("+7 (495) 2360003", "990 Руб.")}\n`,
      },
    ]);
    expect(layout.ok).toBe(false);

    const status = combineAuroraFiles([
      {
        name: "long.csv",
        format: "full",
        text: `${FULL_HEADER}\n${fullRow("+7 (495) 2360003", "990 Руб.", "ЗАНЯТ")}\n`,
      },
    ]);
    expect(status.ok).toBe(false);
  });

  it("does not publish an empty set and accepts a comma inside a quoted field", () => {
    expect(shouldPublishAurora(0)).toBe(false);
    expect(shouldPublishAurora(1)).toBe(true);
    const table = parseCommaCsv(
      `${FULL_HEADER}\n${fullRow("+7 (495) 2360003", "990 Руб.")}\n`,
    );
    expect(table?.[1]?.[5]).toBe("[ AA, BB ]");
    expect(table?.[1]?.[3]).toBe("990 Руб.");
  });

  it("rejects a byte sequence that is not UTF-8 and accepts a BOM", () => {
    expect(decodeAuroraCsv("a.csv", Uint8Array.from([0xff, 0xfe, 0x41])).ok).toBe(false);
    expect(decodeAuroraCsv("a.csv", Uint8Array.from([0xfe, 0xff, 0x00, 0x41])).ok).toBe(
      false,
    );
    const body = new TextEncoder().encode(
      `${SHORT_HEADER}\n${shortRow("+7 (3652) 777117", "990\u00a0Руб.")}\n`,
    );
    const bytes = new Uint8Array(3 + body.length);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    const decoded = decodeAuroraCsv("short.csv", bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const parsed = combineAuroraFiles([
      { name: "short.csv", format: "short", text: decoded.text },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([{ e164: "73652777117", incomingPurchase: "990" }]);
  });

  it("reads a windows-1251 semicolon file that has no header", () => {
    const line = '"+7 (495) 2360003";СВОБОДЕН;ЗОЛОТОЙ;990 Руб.;г. Москва;"[ AA, BB ]"\n';
    const decoded = decodeAuroraCsv("MSK.csv", windows1251(line));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const parsed = combineAuroraFiles([
      { name: "MSK.csv", format: "full", text: decoded.text },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([{ e164: "74952360003", incomingPurchase: "990" }]);
    const short = combineAuroraFiles([
      { name: "MSK.csv", format: "short", text: decoded.text },
    ]);
    expect(short.ok).toBe(false);
  });
});

function windows1251(text: string): Uint8Array {
  const decoder = new TextDecoder("windows-1251");
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 128) {
      bytes.push(code);
      continue;
    }
    let found = -1;
    for (let value = 128; value < 256; value += 1) {
      if (decoder.decode(Uint8Array.of(value)) === ch) {
        found = value;
        break;
      }
    }
    if (found < 0) throw new Error("unmapped");
    bytes.push(found);
  }
  return Uint8Array.from(bytes);
}
