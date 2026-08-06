import { describe, expect, it } from "vitest";
import type { RegistrationDetailResult } from "@/modules/registrations/service";
import {
  describeHistoryEvent,
  formatEndpoint,
  formatTimestamp,
} from "@/modules/registrations/ui-format";

/**
 * Detail panel projection — mirrors what RegsDetailSheet / detail page render
 * from a mocked GET /api/regs/[phone] payload.
 */
function projectDetailPanel(detail: RegistrationDetailResult) {
  return {
    phone: detail.current.phone,
    status: detail.current.status,
    endpoint: formatEndpoint(detail.current.ip, detail.current.port),
    lastChangedAt: formatTimestamp(detail.current.lastChangedAt),
    lastSeenAt: formatTimestamp(detail.current.lastSeenAt),
    history: detail.events.map((event) => ({
      id: event.id,
      summary: describeHistoryEvent(event),
      changedAt: formatTimestamp(event.changedAt),
      newStatus: event.newStatus,
    })),
  };
}

describe("registration detail panel projection", () => {
  it("renders current fields + chronological history from mocked API body", () => {
    const mocked: RegistrationDetailResult = {
      current: {
        phone: "73912193303",
        description: null,
        status: "Unregistered",
        ip: null,
        port: null,
        lastSeenAt: "2026-08-06T12:00:00.000Z",
        lastChangedAt: "2026-08-06T11:00:00.000Z",
      },
      events: [
        {
          id: "ev2",
          phone: "73912193303",
          oldStatus: "Registered",
          newStatus: "Unregistered",
          oldIp: "1.1.1.1",
          newIp: null,
          oldPort: 5060,
          newPort: null,
          changedAt: "2026-08-06T11:00:00.000Z",
        },
        {
          id: "ev1",
          phone: "73912193303",
          oldStatus: null,
          newStatus: "Registered",
          oldIp: null,
          newIp: "1.1.1.1",
          oldPort: null,
          newPort: 5060,
          changedAt: "2026-08-06T10:00:00.000Z",
        },
      ],
    };

    const view = projectDetailPanel(mocked);
    expect(view.phone).toBe("73912193303");
    expect(view.status).toBe("Unregistered");
    expect(view.endpoint).toBe("—");
    expect(view.lastSeenAt).not.toBe("—");
    expect(view.history).toHaveLength(2);
    expect(view.history[0]?.summary).toContain(
      "Зарегистрирован → Не зарегистрирован",
    );
    expect(view.history[1]?.summary).toContain(
      "Впервые как Зарегистрирован",
    );
  });

  it("handles empty history", () => {
    const view = projectDetailPanel({
      current: {
        phone: "420910902600",
        description: "Fine Numbers",
        status: "Registered",
        ip: "185.175.158.149",
        port: 5060,
        lastSeenAt: "2026-08-06T12:00:00.000Z",
        lastChangedAt: "2026-08-06T12:00:00.000Z",
      },
      events: [],
    });
    expect(view.endpoint).toBe("185.175.158.149:5060");
    expect(view.history).toEqual([]);
  });
});
