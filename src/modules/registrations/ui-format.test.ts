import { describe, expect, it } from "vitest";
import {
  buildRegsListUrl,
  describeHistoryEvent,
  formatEndpoint,
  formatTimestamp,
  statusBadgeVariant,
} from "@/modules/registrations/ui-format";
import type { RegistrationHistoryItem, RegistrationListItem } from "@/modules/registrations/types";

const sampleRows: RegistrationListItem[] = [
  {
    phone: "73852222205",
    description: "Клиент А",
    status: "Registered",
    ip: "46.20.69.189",
    port: 5060,
    lastSeenAt: "2026-08-06T12:00:00.000Z",
    lastChangedAt: "2026-08-06T10:00:00.000Z",
  },
  {
    phone: "73912193303",
    description: null,
    status: "Unregistered",
    ip: null,
    port: null,
    lastSeenAt: "2026-08-06T12:00:00.000Z",
    lastChangedAt: "2026-08-06T11:00:00.000Z",
  },
];

describe("registrations UI format helpers", () => {
  it("formats endpoints for table rendering", () => {
    expect(formatEndpoint("46.20.69.189", 5060)).toBe("46.20.69.189:5060");
    expect(formatEndpoint(null, null)).toBe("—");
    expect(formatEndpoint("1.2.3.4", null)).toBe("1.2.3.4");
  });

  it("formats timestamps and handles invalid values", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp("not-a-date")).toBe("—");
    expect(formatTimestamp("2026-08-06T12:00:00.000Z")).not.toBe("—");
  });

  it("distinguishes Registered vs Unregistered badge variants", () => {
    expect(statusBadgeVariant("Registered")).toBe("default");
    expect(statusBadgeVariant("Unregistered")).toBe("secondary");
  });

  it("builds list API URLs from search/filter/page state", () => {
    expect(buildRegsListUrl()).toBe("/api/regs");
    expect(buildRegsListUrl({ phoneQ: "738", page: 2 })).toBe(
      "/api/regs?phoneQ=738&page=2",
    );
    expect(
      buildRegsListUrl({
        filters: { status: ["Registered"], phone: ["738"] },
        page: 2,
      }),
    ).toBe(
      `/api/regs?filters=${encodeURIComponent(JSON.stringify({ status: ["Registered"], phone: ["738"] }))}&page=2`,
    );
  });

  it("projects sample table fields used by columns", () => {
    const projected = sampleRows.map((row) => ({
      phone: row.phone,
      status: row.status,
      endpoint: formatEndpoint(row.ip, row.port),
      lastChangedAt: row.lastChangedAt,
      lastSeenAt: row.lastSeenAt,
    }));

    expect(projected).toEqual([
      {
        phone: "73852222205",
        status: "Registered",
        endpoint: "46.20.69.189:5060",
        lastChangedAt: "2026-08-06T10:00:00.000Z",
        lastSeenAt: "2026-08-06T12:00:00.000Z",
      },
      {
        phone: "73912193303",
        status: "Unregistered",
        endpoint: "—",
        lastChangedAt: "2026-08-06T11:00:00.000Z",
        lastSeenAt: "2026-08-06T12:00:00.000Z",
      },
    ]);
  });

  it("describes detail history events for the panel", () => {
    const first: RegistrationHistoryItem = {
      id: "1",
      phone: "73852222205",
      oldStatus: null,
      newStatus: "Registered",
      oldIp: null,
      newIp: "46.20.69.189",
      oldPort: null,
      newPort: 5060,
      changedAt: "2026-08-06T10:00:00.000Z",
    };
    expect(describeHistoryEvent(first)).toContain(
      "Впервые как Зарегистрирован",
    );
    expect(describeHistoryEvent(first)).toContain("46.20.69.189:5060");

    const flip: RegistrationHistoryItem = {
      id: "2",
      phone: "73912193303",
      oldStatus: "Registered",
      newStatus: "Unregistered",
      oldIp: "1.1.1.1",
      newIp: null,
      oldPort: 5060,
      newPort: null,
      changedAt: "2026-08-06T11:00:00.000Z",
    };
    expect(describeHistoryEvent(flip)).toContain(
      "Зарегистрирован → Не зарегистрирован",
    );
    expect(describeHistoryEvent(flip)).toContain("1.1.1.1:5060 → —");
  });

  it("supports phone substring + status filter matching used by search UX", () => {
    const phonePart = "222205";
    const statusFilter: "" | "Registered" | "Unregistered" = "Registered";
    const filtered = sampleRows.filter((row) => {
      if (phonePart && !row.phone.includes(phonePart)) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      return true;
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.phone).toBe("73852222205");
  });
});
