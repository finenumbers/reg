import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const listRegistrations = vi.fn();
const getRegistrationDetail = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/modules/registrations/service", () => ({
  listRegistrations: (...args: unknown[]) => listRegistrations(...args),
  getRegistrationDetail: (...args: unknown[]) => getRegistrationDetail(...args),
}));

import { GET as listGet } from "@/app/api/regs/route";
import { GET as detailGet } from "@/app/api/regs/[phone]/route";

describe("GET /api/regs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401/403 from guard failure", async () => {
    requireApiPermission.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await listGet(new Request("http://localhost/api/regs"));
    expect(res.status).toBe(401);
    expect(listRegistrations).not.toHaveBeenCalled();
  });

  it("lists current registrations with filters", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { session: { user: { id: "u1" } } },
    });
    listRegistrations.mockResolvedValue({
      items: [
        {
          phone: "73852222205",
          status: "Registered",
          ip: "46.20.69.189",
          port: 5060,
          lastSeenAt: "2026-08-06T00:00:00.000Z",
          lastChangedAt: "2026-08-06T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    const filters = encodeURIComponent(
      JSON.stringify({ status: ["Registered"] }),
    );
    const res = await listGet(
      new Request(
        `http://localhost/api/regs?phoneQ=738&filters=${filters}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].phone).toBe("73852222205");
    expect(listRegistrations).toHaveBeenCalledWith({
      phoneQ: "738",
      filters: { status: ["Registered"] },
      page: 1,
      pageSize: 100,
    });
  });
});

describe("GET /api/regs/[phone]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns detail with history", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { session: { user: { id: "u1" } } },
    });
    getRegistrationDetail.mockResolvedValue({
      current: {
        phone: "73912193303",
        status: "Unregistered",
        ip: null,
        port: null,
        lastSeenAt: "2026-08-06T00:00:00.000Z",
        lastChangedAt: "2026-08-06T00:00:00.000Z",
      },
      events: [
        {
          id: "ev1",
          phone: "73912193303",
          oldStatus: "Registered",
          newStatus: "Unregistered",
          oldIp: "1.1.1.1",
          newIp: null,
          oldPort: 5060,
          newPort: null,
          changedAt: "2026-08-06T00:00:00.000Z",
        },
      ],
    });

    const res = await detailGet(new Request("http://localhost/api/regs/73912193303"), {
      params: Promise.resolve({ phone: "73912193303" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current.phone).toBe("73912193303");
    expect(body.events).toHaveLength(1);
  });

  it("returns 404 when phone unknown", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { session: { user: { id: "u1" } } },
    });
    getRegistrationDetail.mockResolvedValue(null);

    const res = await detailGet(new Request("http://localhost/api/regs/missing"), {
      params: Promise.resolve({ phone: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});
