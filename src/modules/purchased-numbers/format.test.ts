import { describe, expect, it } from "vitest";
import {
  buildBlockedNumberIndex,
  numberIsBlocked,
} from "@/modules/phones/blocked-numbers";
import {
  mapPurchasedNumberRow,
  purchasedMsisdn,
} from "@/modules/purchased-numbers/format";
import {
  PURCHASED_ROW_CLASS,
  purchasedRowTone,
} from "@/modules/purchased-numbers/row-tone";

describe("purchased-number rows", () => {
  it("keeps client and RTU text and drops hidden identifiers", () => {
    const row = mapPurchasedNumberRow({
      id: "abc",
      inventory_kind: "purchased",
      provider_code: "aurora",
      number_local: "1234567",
      client: "Нет в РТУ",
      operator: "Нет в реестре",
      rtu_connected: "Не подключено",
      buy_price: "1500.4",
      msisdn: "71234567890",
      provider_number_key: "key",
      is_currently_present: true,
    });
    expect(row).toMatchObject({
      id: "abc",
      provider_code: "Aurora Telecom",
      number_local: "1234567",
      client: "Нет в РТУ",
      operator: "Нет в реестре",
      rtu_connected: "Не подключено",
      buy_price: "1 500",
    });
    expect(row && "msisdn" in row).toBe(false);
    expect(row && "provider_number_key" in row).toBe(false);
    expect(row && "inventory_kind" in row).toBe(false);
    expect(row && "blocked" in row).toBe(false);
    const index = buildBlockedNumberIndex(["71234567890"]);
    expect(numberIsBlocked(index, purchasedMsisdn({ msisdn: "71234567890" }))).toBe(true);
    expect(numberIsBlocked(index, purchasedMsisdn({ msisdn: "" }))).toBe(false);
    expect(numberIsBlocked(index, "1234567")).toBe(false);
  });

  it("paints registry misses blue, then disconnected red, then external yellow", () => {
    expect(PURCHASED_ROW_CLASS.blocked).toBe(
      "bg-black text-white hover:bg-black hover:text-white",
    );
    expect(PURCHASED_ROW_CLASS.blue).toBe("bg-sky-500/15 hover:bg-sky-500/25");
    expect(PURCHASED_ROW_CLASS.red).toBe(
      "bg-red-600 text-white hover:bg-red-600 hover:text-white",
    );
    expect(PURCHASED_ROW_CLASS.yellow).toBe("bg-amber-400/25 hover:bg-amber-400/35");
    expect(
      purchasedRowTone({
        operator: "Нет в реестре",
        rtu_connected: "Не подключено",
        blocked: true,
      }),
    ).toBe("blocked");
    expect(
      purchasedRowTone({ operator: "Нет в реестре", rtu_connected: "Не подключено" }),
    ).toBe("blue");
    expect(purchasedRowTone({ operator: "МТС", rtu_connected: "Не подключено" })).toBe(
      "red",
    );
    expect(
      purchasedRowTone({ operator: "МТС", rtu_connected: "Внешняя нумерация" }),
    ).toBe("yellow");
    expect(purchasedRowTone({ operator: "МТС", rtu_connected: "Своя нумерация" })).toBe(
      "none",
    );
    expect(purchasedRowTone({ operator: "МТС", rtu_connected: "Нет в РТУ" })).toBe(
      "none",
    );
  });
});
