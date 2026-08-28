import { describe, expect, it } from "vitest";
import { VoipmonitorClient } from "@/modules/voipmonitor/client";

function jsonCalls(count: number): string {
  const rows = Array.from({ length: count }, (_, i) => ({
    cdrId: String(i + 1),
    callId: `id-${i + 1}`,
    caller: "1",
    called: "2",
    calldate: "2026-08-28 12:00:00",
  }));
  return JSON.stringify(rows);
}

describe("VoipmonitorClient.listVoipCallsRange", () => {
  it("fetches 15-minute slices in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seenStarts: string[] = [];
    const client = new VoipmonitorClient({
      apiUrl: "https://vm.example",
      user: "u",
      password: "p",
      rateLimitPerSec: 0,
      fetchImpl: async (_url, init) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const parsed = new URLSearchParams(String(init?.body ?? ""));
        const params = JSON.parse(parsed.get("params") ?? "{}") as {
          startTime?: string;
        };
        seenStarts.push(params.startTime ?? "");
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return new Response(jsonCalls(1), { status: 200 });
      },
    });
    await client.listVoipCallsRange(
      new Date("2026-08-28T12:00:00.000Z"),
      new Date("2026-08-28T13:00:00.000Z"),
    );
    expect(seenStarts).toHaveLength(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("splits a slice that returns an exact cap count", async () => {
    const starts: string[] = [];
    const client = new VoipmonitorClient({
      apiUrl: "https://vm.example",
      user: "u",
      password: "p",
      rateLimitPerSec: 0,
      fetchImpl: async (_url, init) => {
        const parsed = new URLSearchParams(String(init?.body ?? ""));
        const params = JSON.parse(parsed.get("params") ?? "{}") as {
          startTime?: string;
          startTimeTo?: string;
        };
        starts.push(`${params.startTime}->${params.startTimeTo}`);
        const from = Date.parse(`${(params.startTime ?? "").replace(" ", "T")}Z`);
        const to = Date.parse(`${(params.startTimeTo ?? "").replace(" ", "T")}Z`);
        const wide = to - from >= 15 * 60 * 1000;
        return new Response(jsonCalls(wide ? 2000 : 3), { status: 200 });
      },
    });
    await client.listVoipCallsRange(
      new Date("2026-08-28T12:00:00.000Z"),
      new Date("2026-08-28T12:15:00.000Z"),
    );
    expect(starts.length).toBeGreaterThan(1);
    expect(client.lastRangeMeta?.suspectedCap).toBe(true);
    expect(client.lastRangeMeta?.sliceSplits).toBeGreaterThan(0);
  });

  it("does not parse a clipped body as success", async () => {
    const client = new VoipmonitorClient({
      apiUrl: "https://vm.example",
      user: "u",
      password: "p",
      rateLimitPerSec: 0,
      maxResponseBytes: 8,
      fetchImpl: async () => new Response("{\"cdrId\":\"1\"}", { status: 200 }),
    });
    await expect(
      client.getVoipCalls({
        startTime: "2026-08-28 12:00:00",
        startTimeTo: "2026-08-28 12:01:00",
      }),
    ).rejects.toThrow(/truncated/);
  });

  it("does not split a busy slice that is not an exact cap", async () => {
    let hits = 0;
    const client = new VoipmonitorClient({
      apiUrl: "https://vm.example",
      user: "u",
      password: "p",
      rateLimitPerSec: 0,
      fetchImpl: async () => {
        hits += 1;
        return new Response(jsonCalls(1999), { status: 200 });
      },
    });
    const calls = await client.listVoipCallsRange(
      new Date("2026-08-28T12:00:00.000Z"),
      new Date("2026-08-28T12:15:00.000Z"),
    );
    expect(hits).toBe(1);
    expect(calls).toHaveLength(1999);
    expect(client.lastRangeMeta?.sliceSplits).toBe(0);
  });
});
