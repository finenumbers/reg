import { describe, expect, it } from "vitest";
import { msUntilNextUtcHour } from "@/modules/numbering-chain/cadence";
import { chainStartBlock, chainSlot } from "@/modules/numbering-chain/gate";
import {
  CHAIN_BUSY_RETRY,
  CHAIN_CANCELLED,
  CHAIN_STOPPING,
  CHAIN_VACUUM,
  classifyFinish,
  classifyStart,
} from "@/modules/numbering-chain/outcome";
import { buildChainView } from "@/modules/numbering-chain/text";

describe("numbering chain cadence", () => {
  it("waits until the next 17:00 UTC and does not catch the exact hour", () => {
    const hour = msUntilNextUtcHour(new Date("2026-11-16T16:00:00.000Z"));
    expect(hour).toBe(60 * 60 * 1000);
    const exact = msUntilNextUtcHour(new Date("2026-11-16T17:00:00.000Z"));
    expect(exact).toBe(24 * 60 * 60 * 1000);
    const later = msUntilNextUtcHour(new Date("2026-11-16T17:30:00.000Z"));
    expect(later).toBe(23.5 * 60 * 60 * 1000);
    const year = msUntilNextUtcHour(new Date("2026-12-31T18:00:00.000Z"));
    expect(new Date(Date.parse("2026-12-31T18:00:00.000Z") + year).toISOString()).toBe(
      "2027-01-01T17:00:00.000Z",
    );
  });
});

describe("numbering chain outcome", () => {
  it("retries a busy or vacuum start and skips a missing secret", () => {
    expect(classifyStart(CHAIN_BUSY_RETRY)).toBe("retry");
    expect(classifyStart(CHAIN_VACUUM)).toBe("retry");
    expect(classifyStart(CHAIN_STOPPING)).toBe("stop");
    expect(classifyStart("Ключ ещё не задан.")).toBe("skip");
    expect(classifyStart("Ссылка не читается.")).toBe("skip");
    expect(classifyStart("Площадка не ответила.")).toBe("next");
  });

  it("uses a new finish stamp and ignores a stale error", () => {
    expect(
      classifyFinish({
        beforeFinishedAt: 1,
        afterFinishedAt: 1,
        lastError: "Список изменился во время чтения. Каталог не изменён.",
        stopping: false,
      }),
    ).toBe("next");
    expect(
      classifyFinish({
        beforeFinishedAt: 1,
        afterFinishedAt: 2,
        lastError: null,
        stopping: false,
      }),
    ).toBe("ok");
    expect(
      classifyFinish({
        beforeFinishedAt: 1,
        afterFinishedAt: 2,
        lastError: CHAIN_CANCELLED,
        stopping: false,
      }),
    ).toBe("stop");
    expect(
      classifyFinish({
        beforeFinishedAt: 1,
        afterFinishedAt: 2,
        lastError: "Площадка не ответила.",
        stopping: false,
      }),
    ).toBe("next");
    expect(
      classifyFinish({
        beforeFinishedAt: 1,
        afterFinishedAt: 2,
        lastError: null,
        stopping: true,
      }),
    ).toBe("stop");
  });
});

describe("numbering chain text", () => {
  it("puts the remainder on the matching card and names the tail", () => {
    const view = buildChainView({
      running: true,
      index: 11,
      mode: "masks",
      progress: { provider: "MCN Telecom", kind: "free", done: 1000, total: 235150 },
    });
    expect(view.cards.mcn).toBe("Маски, свободные: осталось 234150 из 235150.");
    expect(view.banner).toBeNull();
    expect(view.queue).toBe(
      "Маски, MCN Telecom. Дальше: MCN Telecom, купленные, MCN Telecom, свободные, Finenumbers.",
    );
  });

  it("names the global mask side in the queue and banner", () => {
    const view = buildChainView({
      running: true,
      index: 0,
      mode: "masks",
      progress: { provider: null, kind: "free", done: 29497, total: 30272 },
    });
    expect(view.banner).toBe("Маски, свободные: осталось 775 из 30272.");
    expect(view.cards).toEqual({});
    expect(view.queue).toBe(
      "Маски, свободные. Дальше: SipOut, купленные, SipOut, свободные, Runexis, купленные, Runexis, свободные, UIS, купленные, UIS, свободные, Aurora Telecom, свободные, MTS Exolve, купленные, MTS Exolve, свободные, Voximplant, купленные, Voximplant, свободные, MCN Telecom, купленные, MCN Telecom, свободные, Finenumbers.",
    );
  });

  it("shows a tariff remainder above the cards", () => {
    const view = buildChainView({
      running: true,
      index: 0,
      mode: "wait",
      progress: { provider: null, kind: "resplit-free", done: 1000, total: 4000 },
    });
    expect(view.banner).toBe("Тариф, свободные: осталось 3000 из 4000.");
    expect(view.cards).toEqual({});
    expect(view.queue).toBe(
      "Тариф. Дальше: SipOut, купленные, SipOut, свободные, Runexis, купленные, Runexis, свободные, UIS, купленные, UIS, свободные, Aurora Telecom, свободные, MTS Exolve, купленные, MTS Exolve, свободные, Voximplant, купленные, Voximplant, свободные, MCN Telecom, купленные, MCN Telecom, свободные, Finenumbers.",
    );
  });

  it("shows a client pass above the cards", () => {
    const view = buildChainView({
      running: true,
      index: 1,
      mode: "wait",
      progress: { provider: null, kind: "client", done: 10, total: 40 },
    });
    expect(view.banner).toBe("Клиенты, купленные: осталось 30 из 40.");
    expect(view.cards).toEqual({});
    expect(view.queue).toBe(
      "Клиенты, купленные. Дальше: SipOut, свободные, Runexis, купленные, Runexis, свободные, UIS, купленные, UIS, свободные, Aurora Telecom, свободные, MTS Exolve, купленные, MTS Exolve, свободные, Voximplant, купленные, Voximplant, свободные, MCN Telecom, купленные, MCN Telecom, свободные, Finenumbers.",
    );
  });

  it("names the source being read", () => {
    const view = buildChainView({
      running: false,
      index: 0,
      mode: "read",
      progress: null,
    });
    expect(view.queue).toBeNull();
    const reading = buildChainView({
      running: true,
      index: 1,
      mode: "read",
      progress: null,
    });
    expect(reading.queue).toBe(
      "Цепочка: SipOut, свободные. Дальше: Runexis, купленные, Runexis, свободные, UIS, купленные, UIS, свободные, Aurora Telecom, свободные, MTS Exolve, купленные, MTS Exolve, свободные, Voximplant, купленные, Voximplant, свободные, MCN Telecom, купленные, MCN Telecom, свободные, Finenumbers.",
    );
  });
});

describe("numbering chain gate", () => {
  it("refuses a card load while the chain is running", () => {
    const slot = chainSlot();
    slot.running = false;
    expect(chainStartBlock(false)).toBeNull();
    slot.running = true;
    expect(chainStartBlock(false)).toBe("Идёт цепочка загрузок.");
    expect(chainStartBlock(true)).toBeNull();
    slot.running = false;
  });
});
