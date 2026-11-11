import { describe, expect, it } from "vitest";
import { AXIS_BASELINE, AXIS_TOP } from "@/modules/dashboard/concurrency";
import { ZABBIX_GRAPH2_MARK, zabbixPlotY, zabbixScale } from "@/modules/zabbix/scale";

describe("zabbixScale level", () => {
  it("leaves a small series below 50M when no level is set", () => {
    expect(zabbixScale([1_000, 2_000]).max).toBeLessThan(ZABBIX_GRAPH2_MARK);
  });

  it("lifts an empty series to the level and keeps the mark inside the plot", () => {
    const scale = zabbixScale([0, null], ZABBIX_GRAPH2_MARK);
    expect(scale.max).toBeGreaterThanOrEqual(ZABBIX_GRAPH2_MARK);
    const y = zabbixPlotY(ZABBIX_GRAPH2_MARK, scale);
    expect(y).toBeGreaterThan(AXIS_TOP);
    expect(y).toBeLessThan(AXIS_BASELINE);
  });

  it("does not drop the max below taller traffic", () => {
    const high = 80_000_000;
    const scale = zabbixScale([0, high], ZABBIX_GRAPH2_MARK);
    expect(scale.max).toBeGreaterThanOrEqual(high);
    expect(scale.max).toBeGreaterThanOrEqual(ZABBIX_GRAPH2_MARK);
  });
});
