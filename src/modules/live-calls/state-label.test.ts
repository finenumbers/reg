import { describe, expect, it } from "vitest";
import { presentCallState, stateLabelMap } from "@/modules/live-calls/state-label";

describe("stateLabelMap", () => {
  it("keeps one interface string per key", () => {
    const labels = stateLabelMap([
      { key: "talk", value: "Разговор" },
      { key: "", value: "Пусто" },
      { key: "ring", value: "" },
      { key: "talk", value: "Другое" },
      { key: "hold", value: "Удержание" },
    ]);
    expect(labels.get("talk")).toBeUndefined();
    expect(labels.get("ring")).toBeUndefined();
    expect(labels.get("hold")).toBe("Удержание");
    expect(presentCallState("hold", labels)).toBe("Удержание");
    expect(presentCallState("talk", labels)).toBe("talk");
    expect(presentCallState("", labels)).toBe("");
    expect(presentCallState("hold", null)).toBe("hold");
  });
});
