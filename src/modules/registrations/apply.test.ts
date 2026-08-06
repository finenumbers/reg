import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import {
  planRegistrationUpdates,
  registrationFieldsChanged,
  type RegistrationStateSnapshot,
} from "@/modules/registrations/apply";
import type { ParsedRegistrationRow } from "@/modules/registrations/parser";

function row(
  partial: Partial<ParsedRegistrationRow> &
    Pick<ParsedRegistrationRow, "phone" | "status">,
): ParsedRegistrationRow {
  return {
    ip: null,
    port: null,
    rawLine: "",
    ...partial,
  };
}

describe("registrationFieldsChanged", () => {
  beforeAll(() => {
    // ensure mock is active before module use
  });

  it("treats missing previous as changed", () => {
    expect(
      registrationFieldsChanged(null, {
        status: "Registered",
        ip: "1.1.1.1",
        port: 5060,
      }),
    ).toBe(true);
  });

  it("detects status / endpoint changes and ignores identical state", () => {
    const previous = {
      status: "Registered" as const,
      ip: "1.1.1.1",
      port: 5060,
    };
    expect(registrationFieldsChanged(previous, previous)).toBe(false);
    expect(
      registrationFieldsChanged(previous, {
        status: "Unregistered",
        ip: "1.1.1.1",
        port: 5060,
      }),
    ).toBe(true);
    expect(
      registrationFieldsChanged(previous, {
        status: "Registered",
        ip: "2.2.2.2",
        port: 5060,
      }),
    ).toBe(true);
    expect(
      registrationFieldsChanged(previous, {
        status: "Registered",
        ip: "1.1.1.1",
        port: 5061,
      }),
    ).toBe(true);
  });
});

describe("planRegistrationUpdates", () => {
  it("plans insert, update, and unchanged correctly", () => {
    const previousByPhone = new Map<string, RegistrationStateSnapshot>([
      [
        "100",
        {
          phone: "100",
          status: "Registered",
          ip: "1.1.1.1",
          port: 5060,
        },
      ],
      [
        "200",
        {
          phone: "200",
          status: "Unregistered",
          ip: null,
          port: null,
        },
      ],
    ]);

    const plans = planRegistrationUpdates(previousByPhone, [
      row({ phone: "100", status: "Registered", ip: "1.1.1.1", port: 5060 }),
      row({ phone: "200", status: "Registered", ip: "9.9.9.9", port: 5060 }),
      row({ phone: "300", status: "Unregistered" }),
    ]);

    expect(
      plans.map((p) => ({ phone: p.phone, kind: p.kind, changed: p.changed })),
    ).toEqual([
      { phone: "100", kind: "unchanged", changed: false },
      { phone: "200", kind: "update", changed: true },
      { phone: "300", kind: "insert", changed: true },
    ]);
  });

  it("does not invent change events when nothing changed", () => {
    const previousByPhone = new Map<string, RegistrationStateSnapshot>([
      [
        "100",
        {
          phone: "100",
          status: "Registered",
          ip: "1.1.1.1",
          port: 5060,
        },
      ],
    ]);
    const plans = planRegistrationUpdates(previousByPhone, [
      row({ phone: "100", status: "Registered", ip: "1.1.1.1", port: 5060 }),
    ]);
    expect(plans.every((p) => !p.changed)).toBe(true);
    expect(plans.filter((p) => p.kind !== "unchanged")).toHaveLength(0);
  });
});
