import { describe, expect, it } from "vitest";
import {
  graphRows,
  hostRows,
  pickGraph,
  pickHost,
  type ZabbixGraphRow,
  type ZabbixHostRow,
} from "@/modules/zabbix/resolve";

const host = (row: Partial<ZabbixHostRow> & Pick<ZabbixHostRow, "hostid">): ZabbixHostRow => ({
  host: "",
  name: "",
  status: "0",
  ...row,
});

describe("Zabbix host match", () => {
  const rows: ZabbixHostRow[] = [
    host({ hostid: "1", host: "sip-gw", name: "SIP GW" }),
    host({ hostid: "2", host: "edge", name: "Edge", status: "3" }),
    host({ hostid: "3", host: "gw", name: "GW" }),
  ];

  it("keeps one exact host and drops a template", () => {
    expect(pickHost(rows, "gw", "exact")).toEqual({
      ok: true,
      row: rows[2],
    });
    expect(pickHost([host({ hostid: "9", host: "edge", name: "Edge", status: "3" })], "edge", "exact")).toEqual({
      ok: false,
      reason: "none",
    });
  });

  it("does not treat a search substring as the host", () => {
    expect(pickHost(rows, "sip", "loose")).toEqual({ ok: false, reason: "none" });
  });

  it("accepts a different case only on the loose pass", () => {
    expect(pickHost(rows, "Gw", "exact")).toEqual({ ok: false, reason: "none" });
    expect(pickHost(rows, "Gw", "loose").ok).toBe(true);
  });

  it("fails when two real hosts share the text", () => {
    const many = [
      host({ hostid: "1", host: "gw", name: "One" }),
      host({ hostid: "2", host: "other", name: "gw" }),
    ];
    expect(pickHost(many, "gw", "exact")).toEqual({ ok: false, reason: "many" });
  });

  it("reads status as text and skips a row without an id", () => {
    expect(
      hostRows([
        { hostid: 4, host: "gw", name: "GW", status: 0 },
        { host: "nope" },
      ]),
    ).toEqual([host({ hostid: "4", host: "gw", name: "GW", status: "0" })]);
  });
});

describe("Zabbix graph match", () => {
  const graph = (row: Partial<ZabbixGraphRow> & Pick<ZabbixGraphRow, "graphid" | "name">): ZabbixGraphRow => ({
    graphtype: "0",
    items: [],
    ...row,
  });

  it("requires the full graph name", () => {
    const rows = graphRows([
      {
        graphid: "10",
        name: "SIP sessions",
        graphtype: "1",
        gitems: [{ itemid: "7", color: "00C800", calc_fnc: "2", sortorder: "1", type: "0" }],
      },
      { graphid: "11", name: "SIP", graphtype: 2 },
    ]);
    expect(pickGraph(rows, "SI", "loose")).toEqual({ ok: false, reason: "none" });
    expect(pickGraph(rows, "sip", "loose").ok).toBe(true);
    expect(pickGraph(rows, "SIP sessions", "exact").ok).toBe(true);
    expect(rows[0]?.items[0]).toMatchObject({ itemid: "7", color: "00C800", calc: "2" });
    expect(pickGraph([graph({ graphid: "1", name: "A" }), graph({ graphid: "2", name: "A" })], "A", "exact")).toEqual({
      ok: false,
      reason: "many",
    });
  });
});
