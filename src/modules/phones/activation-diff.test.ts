import { describe, expect, it } from "vitest";
import { confirmActivationDiff } from "@/modules/phones/activation-diff";
import type { EquipmentIdentity } from "@/modules/phones/rtu-rows";
import { STATUS_ACTIVE, STATUS_BLOCKED } from "@/modules/phones/types";

function endpoint(patch: Partial<EquipmentIdentity> = {}): EquipmentIdentity {
  return {
    pk: "15",
    kind: "endpoint",
    name: "EP",
    number: "74951234567",
    rawActive: "1",
    activation: STATUS_ACTIVE,
    endpoint: {
      Название: "EP",
      "Номер оконечного оборудования": "74951234567",
      "Регистрационный пароль": "secret",
      Статус: STATUS_ACTIVE,
      Поставщик: "МТТ",
    },
    ...patch,
  };
}

function pair(before: EquipmentIdentity, after: EquipmentIdentity) {
  return confirmActivationDiff({
    before: [before],
    after: [after],
    pk: "15",
    fromWire: "1",
    toWire: "0",
    fromStatus: STATUS_ACTIVE,
    toStatus: STATUS_BLOCKED,
  });
}

describe("confirmActivationDiff", () => {
  it("accepts the one checkbox change and ignores supplier", () => {
    const before = endpoint();
    const after = endpoint({
      rawActive: "0",
      activation: STATUS_BLOCKED,
      endpoint: {
        ...(before.endpoint ?? {}),
        Статус: STATUS_BLOCKED,
        Поставщик: "другой",
      },
    });
    expect(pair(before, after).ok).toBe(true);
  });

  it("rejects a second row whose flag changed", () => {
    const other = endpoint({ pk: "16", number: "74950000000", rawActive: "1" });
    const changed = endpoint({ pk: "16", number: "74950000000", rawActive: "0" });
    const result = confirmActivationDiff({
      before: [endpoint(), other],
      after: [
        endpoint({
          rawActive: "0",
          activation: STATUS_BLOCKED,
          endpoint: { ...endpoint().endpoint, Статус: STATUS_BLOCKED },
        }),
        changed,
      ],
      pk: "15",
      fromWire: "1",
      toWire: "0",
      fromStatus: STATUS_ACTIVE,
      toStatus: STATUS_BLOCKED,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("не только у этого номера");
    expect(result.detail).not.toContain("secret");
  });

  it("rejects another field on the same row", () => {
    const before = endpoint();
    const after = endpoint({
      rawActive: "0",
      activation: STATUS_BLOCKED,
      endpoint: {
        ...(before.endpoint ?? {}),
        Статус: STATUS_BLOCKED,
        "Регистрационный пароль": "other",
      },
    });
    const result = pair(before, after);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("других полей");
    expect(result.detail).not.toContain("other");
  });
});
