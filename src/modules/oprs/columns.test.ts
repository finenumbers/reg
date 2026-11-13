import { describe, expect, it } from "vitest";
import {
  isTrafficColumn,
  OPRS_COLUMNS,
  OPRS_LABELS,
  OPRS_STATIC_COLUMNS,
} from "@/modules/traffic/columns";

describe("OPRS columns", () => {
  it("follows the screen order and leaves marking empty of a database field", () => {
    expect(OPRS_COLUMNS).toEqual([
      "cdr_day",
      "cdr_time",
      "call_status",
      "bill_ani",
      "side_a",
      "bill_dnis",
      "out_orig_dnis",
      "operator_b",
      "geography_b",
      "oprs_marking",
      "oprs_mav",
      "elapsed_time",
      "src_name",
      "dst_name",
      "dp_name",
      "disconnect_code_string",
      "voipmonitor_url_in",
      "voipmonitor_url_out",
    ]);
    expect(OPRS_LABELS.operator_b).toBe("ОПРС (Реестр Минцифры)");
    expect(OPRS_LABELS.geography_b).toBe("География");
    expect(OPRS_LABELS.bill_ani).toBe("А-номер");
    expect(OPRS_LABELS.dst_name).toBe("Терминирующее устройство");
    expect(OPRS_LABELS.oprs_marking).toBe("Маркировка");
    expect(OPRS_LABELS.oprs_mav).toBe("МАВ");
    for (const column of OPRS_STATIC_COLUMNS) {
      expect(isTrafficColumn(column)).toBe(false);
    }
    expect(isTrafficColumn("operator_b")).toBe(true);
    expect(isTrafficColumn("geography_b")).toBe(true);
  });
});
