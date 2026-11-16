import { describe, expect, it } from "vitest";
import { phoneClientHash, phoneDescription } from "@/modules/phones/client-hash";

describe("phone client hash", () => {
  it("ignores order and duplicate lines", () => {
    const left = phoneClientHash([
      { phone: "74950000001", description: "Бета" },
      { phone: "74950000002", description: "Альфа" },
      { phone: "74950000001", description: "Бета" },
    ]);
    const right = phoneClientHash([
      { phone: " 74950000002 ", description: " Альфа " },
      { phone: "74950000001", description: "Бета" },
    ]);
    expect(left).toBe(right);
  });

  it("changes when a description changes", () => {
    const before = phoneClientHash([{ phone: "74950000001", description: "Альфа" }]);
    const after = phoneClientHash([{ phone: "74950000001", description: "Бета" }]);
    expect(before).not.toBe(after);
    expect(phoneDescription({ Описание: " Альфа " })).toBe("Альфа");
    expect(phoneDescription({})).toBe("");
  });
});