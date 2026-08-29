import { describe, expect, it } from "vitest";
import { auditExactCallIdInvariant, auditLinkInvariants } from "@/modules/voipmonitor/invariants";
import { matchBucket, matchOne } from "@/modules/voipmonitor/match";
import {
  MISS_FALLBACK_AMBIGUOUS,
  SOURCE_SATEL,
  STATUS_AMBIGUOUS,
  STATUS_MATCHED_EXACT,
  STATUS_MATCHED_FALLBACK,
  type CdrCandidate,
  type VmCall,
  type VoipmonitorClientLike,
} from "@/modules/voipmonitor/types";
import { callIdsEqual } from "@/modules/voipmonitor/normalize";

function vm(partial: Partial<VmCall> & Pick<VmCall, "cdrId" | "callId">): VmCall {
  return {
    caller: "",
    called: "",
    sipCallerIp: "",
    sipCalledIp: "",
    duration: 0,
    connectDuration: 0,
    callDate: new Date("2026-07-27T12:00:00Z"),
    callEnd: null,
    ...partial,
  };
}

function fakeClient(catalog: VmCall[]): VoipmonitorClientLike {
  return {
    async listVoipCallsRange() {
      return catalog;
    },
    async getVoipCalls(params) {
      const wantCallId = String(params.callId ?? "");
      const wantCdrId = String(params.cdrId ?? "");
      return catalog.filter((item) => {
        if (wantCdrId && item.cdrId !== wantCdrId) return false;
        if (wantCallId && !callIdsEqual(wantCallId, item.callId)) return false;
        return true;
      });
    },
  };
}

function satel(partial: Partial<CdrCandidate>): CdrCandidate {
  return {
    sourceRecordId: "r1",
    sourceSystem: SOURCE_SATEL,
    sourceCdrId: "cdr-1",
    setupTime: new Date("2026-07-27T12:00:00Z"),
    durationSec: null,
    connectDurationSec: null,
    caller: "",
    called: "",
    callerNumbers: [],
    calledNumbers: [],
    callerIp: "",
    calledIp: "",
    sipCallIds: [],
    inCallIds: [],
    outCallIds: [],
    inCaller: "",
    inCalled: "",
    outCaller: "",
    outCalled: "",
    inIp: "",
    outIp: "",
    ...partial,
  };
}

describe("matchOne", () => {
  it("matches exact SIP Call-ID and builds fcallid URL", async () => {
    const client = fakeClient([
      vm({
        cdrId: "42",
        callId: "sip-abc@vm",
        caller: "79001112233",
        called: "79005556677",
        duration: 12,
      }),
    ]);
    const { result, error } = await matchOne(
      {
        client,
        guiBase: "https://vm.example",
        now: () => new Date("2026-07-27T12:00:01Z"),
      },
      satel({
        caller: "79001112233",
        called: "79005556677",
        sipCallIds: ["sip-abc"],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_MATCHED_EXACT);
    expect(result.score).toBe(100);
    expect(result.vm?.cdrId).toBe("42");
    expect(result.cardUrl).toContain("fcallid");
    expect(result.cardUrl).not.toContain("fId");
    expect(result.legs.in?.cdrId).toBe("42");
    expect(result.legs.out).toBeUndefined();
    expect(
      auditExactCallIdInvariant(satel({ sipCallIds: ["sip-abc"] }), result),
    ).toBe(true);
  });

  it("treats multi-leg same Call-ID as exact and picks the better IP", async () => {
    const client = fakeClient([
      vm({
        cdrId: "10",
        callId: "shared-id",
        caller: "100",
        called: "200",
        duration: 10,
        sipCallerIp: "1.1.1.1",
        sipCalledIp: "2.2.2.2",
      }),
      vm({
        cdrId: "11",
        callId: "shared-id",
        caller: "100",
        called: "200",
        duration: 10,
        callDate: new Date("2026-07-27T12:00:01Z"),
        sipCallerIp: "9.9.9.9",
        sipCalledIp: "8.8.8.8",
      }),
    ]);
    const { result, error } = await matchOne(
      { client, guiBase: "https://vm.example" },
      satel({
        caller: "100",
        called: "200",
        durationSec: 10,
        callerIp: "1.1.1.1",
        calledIp: "2.2.2.2",
        sipCallIds: ["shared-id"],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_MATCHED_EXACT);
    expect(result.vm?.cdrId).toBe("10");
  });

  it("marks close fallback candidates as ambiguous without a URL", async () => {
    const client = fakeClient([
      vm({
        cdrId: "1",
        callId: "a",
        caller: "79001112233",
        called: "79005556677",
        duration: 10,
      }),
      vm({
        cdrId: "2",
        callId: "b",
        caller: "79001112233",
        called: "79005556677",
        duration: 10,
        callDate: new Date("2026-07-27T12:00:01Z"),
      }),
    ]);
    const { result, error } = await matchOne(
      { client, guiBase: "https://vm.example" },
      satel({
        caller: "79001112233",
        called: "79005556677",
        durationSec: 10,
        callerNumbers: ["79001112233"],
        calledNumbers: ["79005556677"],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_AMBIGUOUS);
    expect(result.missReason).toBe(MISS_FALLBACK_AMBIGUOUS);
    expect(result.cardUrl).toBe("");
  });

  it("falls back on B2BUA regenerated Call-ID", async () => {
    const client = fakeClient([
      vm({
        cdrId: "77",
        callId: "vm-regenerated",
        caller: "79001112233",
        called: "79005556677",
        duration: 30,
        callDate: new Date("2026-07-27T12:00:02Z"),
        sipCallerIp: "10.0.0.1",
        sipCalledIp: "10.0.0.2",
      }),
    ]);
    const { result, error } = await matchOne(
      { client, guiBase: "https://vm.example" },
      satel({
        caller: "79001112233",
        called: "79005556677",
        callerNumbers: ["79001112233"],
        calledNumbers: ["79005556677"],
        callerIp: "10.0.0.1",
        calledIp: "10.0.0.2",
        durationSec: 30,
        sipCallIds: ["smg-only-call-id"],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_MATCHED_FALLBACK);
    expect(result.vm?.cdrId).toBe("77");
    expect(result.cardUrl).toContain("fcallid");
    expect(result.legs.in?.cdrId).toBe("77");
    expect(result.legs.out).toBeUndefined();
  });

  it("puts a conf-only exact match in the In column", async () => {
    const { result, error } = await matchOne(
      {
        client: fakeClient([vm({ cdrId: "c1", callId: "conf-xyz" })]),
        guiBase: "https://vm.example",
      },
      satel({
        sipCallIds: ["conf-xyz"],
        inCallIds: [],
        outCallIds: [],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_MATCHED_EXACT);
    expect(result.legs.in?.cdrId).toBe("c1");
    expect(result.legs.out).toBeUndefined();
  });

  it("does not exact-match a different Call-ID", async () => {
    const client = fakeClient([
      vm({
        cdrId: "9",
        callId: "other-id",
        caller: "100",
        called: "200",
        duration: 5,
      }),
    ]);
    const { result, error } = await matchOne(
      { client, guiBase: "https://vm.example" },
      satel({
        sipCallIds: ["my-id"],
        caller: "999",
        called: "888",
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).not.toBe(STATUS_MATCHED_EXACT);
  });

  it("assigns a VM cdrId to only one candidate", async () => {
    const client = fakeClient([
      vm({
        cdrId: "1",
        callId: "shared",
        caller: "100",
        called: "200",
        duration: 10,
      }),
    ]);
    const setup = new Date("2026-07-27T12:00:00Z");
    const cands = [
      satel({ sourceRecordId: "a", setupTime: setup, sipCallIds: ["shared"] }),
      satel({ sourceRecordId: "b", setupTime: setup, sipCallIds: ["shared"] }),
    ];
    const { results, error } = await matchBucket(
      { client, guiBase: "https://vm.example" },
      cands,
    );
    expect(error).toBeUndefined();
    expect(auditLinkInvariants(cands, results)).toEqual([]);
    expect(results.filter((r) => r.status === STATUS_MATCHED_EXACT)).toHaveLength(
      1,
    );
  });

  it("does not assign a cdrId-less VM call to two candidates", async () => {
    const client = fakeClient([
      vm({
        cdrId: "",
        callId: "anon-shared",
        callDate: new Date("2026-07-27T12:00:00Z"),
      }),
    ]);
    const setup = new Date("2026-07-27T12:00:00Z");
    const cands = [
      satel({
        sourceRecordId: "a",
        setupTime: setup,
        sipCallIds: ["anon-shared"],
      }),
      satel({
        sourceRecordId: "b",
        setupTime: setup,
        sipCallIds: ["anon-shared"],
      }),
    ];
    const { results, error } = await matchBucket(
      { client, guiBase: "https://vm.example" },
      cands,
    );
    expect(error).toBeUndefined();
    const hits = results.filter((r) => r.status === STATUS_MATCHED_EXACT);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.legs.in?.callId).toBe("anon-shared");
    expect(results.filter((r) => r.status !== STATUS_MATCHED_EXACT)).toHaveLength(
      1,
    );
  });

  it("does not probe misses when probeBudget is 0", async () => {
    let probes = 0;
    const client: VoipmonitorClientLike = {
      async listVoipCallsRange() {
        return [];
      },
      async getVoipCalls() {
        probes += 1;
        return [];
      },
    };
    const { results, error, stats } = await matchBucket(
      {
        client,
        guiBase: "https://vm.example",
        probeBudget: 0,
      },
      [satel({ sipCallIds: ["missing-id"] })],
    );
    expect(error).toBeUndefined();
    expect(probes).toBe(0);
    expect(stats?.probes).toBe(0);
    expect(results[0]?.status).not.toBe(STATUS_MATCHED_EXACT);
  });

  it("caps unique Call-ID probes to the budget", async () => {
    let probes = 0;
    const client: VoipmonitorClientLike = {
      async listVoipCallsRange() {
        return [
          vm({
            cdrId: "keep-index-nonempty",
            callId: "other",
            caller: "1",
            called: "2",
          }),
        ];
      },
      async getVoipCalls() {
        probes += 1;
        return [];
      },
    };
    await matchBucket(
      {
        client,
        guiBase: "https://vm.example",
        probeBudget: 1,
      },
      [
        satel({ sourceRecordId: "a", sipCallIds: ["id-a"] }),
        satel({ sourceRecordId: "b", sipCallIds: ["id-b"] }),
      ],
    );
    expect(probes).toBeGreaterThanOrEqual(1);
    expect(probes).toBeLessThanOrEqual(4);
  });

  it("does not verify fallback matches with an extra cdrId lookup", async () => {
    let lookups = 0;
    const catalog = [
      vm({
        cdrId: "77",
        callId: "vm-regenerated",
        caller: "79001112233",
        called: "79005556677",
        duration: 30,
        callDate: new Date("2026-07-27T12:00:02Z"),
        sipCallerIp: "10.0.0.1",
        sipCalledIp: "10.0.0.2",
      }),
    ];
    const client: VoipmonitorClientLike = {
      async listVoipCallsRange() {
        return catalog;
      },
      async getVoipCalls() {
        lookups += 1;
        return catalog;
      },
    };
    const { result, error } = await matchOne(
      { client, guiBase: "https://vm.example", probeBudget: 0 },
      satel({
        caller: "79001112233",
        called: "79005556677",
        callerNumbers: ["79001112233"],
        calledNumbers: ["79005556677"],
        callerIp: "10.0.0.1",
        calledIp: "10.0.0.2",
        durationSec: 30,
        sipCallIds: ["smg-only-call-id"],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_MATCHED_FALLBACK);
    expect(lookups).toBe(0);
  });

  it("raises a zero archive budget when the range fetch looks capped", async () => {
    let probes = 0;
    const client: VoipmonitorClientLike = {
      lastRangeMeta: { sliceSplits: 1, clipped: false, suspectedCap: true },
      async listVoipCallsRange() {
        return [vm({ cdrId: "1", callId: "present" })];
      },
      async getVoipCalls() {
        probes += 1;
        return [];
      },
    };
    const { stats } = await matchBucket(
      { client, guiBase: "https://vm.example", probeBudget: 0 },
      [satel({ sipCallIds: ["missing-id"] })],
    );
    expect(stats?.probeBudget).toBeGreaterThan(0);
    expect(probes).toBeGreaterThan(0);
  });

  it("does not persist-style unmatched when hour fetch fails", async () => {
    const client: VoipmonitorClientLike = {
      async listVoipCallsRange() {
        throw new Error("hour down");
      },
      async getVoipCalls() {
        return [];
      },
    };
    const { results, error } = await matchBucket(
      { client, guiBase: "https://vm.example" },
      [satel({ sipCallIds: ["x"] })],
    );
    expect(error?.message).toContain("hour down");
    expect(results[0]?.status).toBe("unmatched");
  });

  it("places distinct in/out Call-IDs in the matching columns", async () => {
    const client = fakeClient([
      vm({ cdrId: "in-1", callId: "call-in", sipCallerIp: "1.1.1.1" }),
      vm({ cdrId: "out-1", callId: "call-out", sipCallerIp: "9.9.9.9" }),
    ]);
    const { result, error } = await matchOne(
      { client, guiBase: "https://vm.example" },
      satel({
        sipCallIds: ["call-out", "call-in"],
        inCallIds: ["call-in"],
        outCallIds: ["call-out"],
      }),
    );
    expect(error).toBeUndefined();
    expect(result.status).toBe(STATUS_MATCHED_EXACT);
    expect(result.legs.in?.cdrId).toBe("in-1");
    expect(result.legs.out?.cdrId).toBe("out-1");
    expect(result.legs.in?.url).toContain("fcallid");
    expect(result.legs.out?.url).toContain("fcallid");
    expect(result.vm?.cdrId).toBe("in-1");
  });

  it("puts a shared Call-ID in both columns", async () => {
    const { result } = await matchOne(
      {
        client: fakeClient([vm({ cdrId: "1", callId: "same" })]),
        guiBase: "https://vm.example",
      },
      satel({
        sipCallIds: ["same"],
        inCallIds: ["same"],
        outCallIds: ["same"],
      }),
    );
    expect(result.legs.in?.cdrId).toBe("1");
    expect(result.legs.out?.cdrId).toBe("1");
  });

  it("does not label an in-only Call-ID as out", async () => {
    const { result } = await matchOne(
      {
        client: fakeClient([vm({ cdrId: "7", callId: "only-in" })]),
        guiBase: "https://vm.example",
      },
      satel({
        sipCallIds: ["only-in"],
        inCallIds: ["only-in"],
        outCallIds: [],
      }),
    );
    expect(result.legs.in?.cdrId).toBe("7");
    expect(result.legs.out).toBeUndefined();
  });

  it("probes the missing out Call-ID after an in-leg exact hit", async () => {
    const probes: string[] = [];
    const outLeg = vm({ cdrId: "out-9", callId: "out-id" });
    const client: VoipmonitorClientLike = {
      async listVoipCallsRange() {
        return [vm({ cdrId: "in-9", callId: "in-id" })];
      },
      async getVoipCalls(params) {
        const want = String(params.callId ?? "");
        probes.push(want);
        return want === "out-id" ? [outLeg] : [];
      },
    };
    const { result } = await matchOne(
      { client, guiBase: "https://vm.example", probeBudget: 4 },
      satel({
        sipCallIds: ["in-id", "out-id"],
        inCallIds: ["in-id"],
        outCallIds: ["out-id"],
      }),
    );
    expect(probes.some((id) => id.includes("out-id"))).toBe(true);
    expect(result.legs.in?.cdrId).toBe("in-9");
    expect(result.legs.out?.cdrId).toBe("out-9");
  });

  it("reserves sibling VM cdrIds so they are not reused", async () => {
    const client = fakeClient([
      vm({ cdrId: "taken", callId: "id-a" }),
      vm({ cdrId: "free", callId: "id-b" }),
    ]);
    const { result } = await matchOne(
      {
        client,
        guiBase: "https://vm.example",
        reservedCdrIds: ["taken"],
      },
      satel({
        sipCallIds: ["id-a", "id-b"],
        inCallIds: ["id-a", "id-b"],
      }),
    );
    expect(result.legs.in?.cdrId).toBe("free");
  });
});
