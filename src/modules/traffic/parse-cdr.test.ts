import { describe, expect, it } from "vitest";
import {
  CDR_COLUMNS,
  CDR_COLUMN_COUNT,
  CDR_ENRICH_COLUMNS,
  RAW_TABLE_COLUMNS,
  TRAFFIC_GEOGRAPHY_COLUMNS,
  TRAFFIC_GEOGRAPHY_LABELS,
  TRAFFIC_OPERATORS_COLUMNS,
  TRAFFIC_OPERATORS_LABELS,
  TRAFFIC_SUMMARY_COLUMNS,
  TRAFFIC_SUMMARY_LABELS,
  headersMatchCanonical,
  isTrafficColumn,
} from "@/modules/traffic/columns";
import {
  assertCanonicalCdrHeader,
  parseCdrDataLine,
  parseCdrDate,
  parseCdrHeaderLine,
} from "@/modules/traffic/parse-cdr";

const HEADER =
  '"cdr_id";"cdr_date";"in_ani";"in_dnis";"out_ani";"out_dnis";"bill_ani";"bill_dnis";"sig_node_name";"src_gatekeeper_address";"remote_src_sig_address";"remote_dst_sig_address";"remote_src_media_address";"remote_dst_media_address";"local_src_sig_address";"local_dst_sig_address";"local_src_media_address";"local_dst_media_address";"in_leg_proto";"out_leg_proto";"conf_id";"in_leg_call_id";"out_leg_call_id";"src_user";"dst_user";"radius_user";"src_name";"dst_name";"dp_name";"elapsed_time";"setup_time";"connect_time";"disconnect_time";"in_leg_codecs";"out_leg_codecs";"src_faststart_present";"dst_faststart_present";"src_tunneling_present";"dst_tunneling_present";"proxy_mode";"lar_fault_reason";"route_retries";"scd";"pdd";"media_group";"src_media_bytes_in";"src_media_bytes_out";"dst_media_bytes_in";"dst_media_bytes_out";"src_media_packets";"dst_media_packets";"src_media_packets_late";"dst_media_packets_late";"src_media_packets_lost";"dst_media_packets_lost";"src_min_jitter_size";"src_max_jitter_size";"dst_min_jitter_size";"dst_max_jitter_size";"last_cdr";"in_cpc";"out_cpc";"in_zone";"out_zone";"disconnect_initiator";"in_ani_type_of_number";"in_dnis_type_of_number";"out_ani_type_of_number";"out_dnis_type_of_number";"src_in_leg_conf_id";"src_in_leg_call_id";"src_out_leg_call_id";"in_orig_dnis";"out_orig_dnis";"record_type";"extradata";"term_elapsed_time";"term_setup_time";"term_connect_time";"term_disconnect_time";"term_scd";"term_pdd";"external_router";"radius_group";"in_ani_screening";"in_ani_presentation";"out_ani_screening";"out_ani_presentation";"outgoing_pulses";"incoming_pulses";"in_lrn";"retrieved_lrn";"lrn";"ext_lrn";"out_lrn";"lnp_server";"in_leg_transport_proto";"out_leg_transport_proto";"sip_routing_group";"looping_cycles";"auth_dnis";"ext_ani";"ext_dnis";"ext_sig_address";"in_partner_id";"out_partner_id";"disconnect_code_string";"disconnect_code_success";"src_disconnect_codes_string";"dst_disconnect_codes_string";"in_orig_dnis_type_of_number";"out_orig_dnis_type_of_number";"in_encryption";"out_encryption";"ext_ani_type_of_number";"ext_dnis_type_of_number";"ext_orig_dnis_type_of_number";"src_disconnect_codes";"dst_disconnect_codes";"disconnect_code"';

function quotedRow(overrides: Partial<Record<(typeof CDR_COLUMNS)[number], string>>): string {
  return CDR_COLUMNS.map((col) => {
    const raw = overrides[col] ?? (col === "cdr_id" ? "202608270000007910" : "");
    return `"${raw.replaceAll('"', '""')}"`;
  }).join(";");
}

describe("CDR column contract", () => {
  it("has exactly 120 canonical headers", () => {
    expect(CDR_COLUMN_COUNT).toBe(120);
    expect(CDR_COLUMNS[0]).toBe("cdr_id");
    expect(CDR_COLUMNS[119]).toBe("disconnect_code");
  });

  it("accepts the sample header line", () => {
    const headers = parseCdrHeaderLine(HEADER);
    expect(headers).toHaveLength(120);
    expect(headersMatchCanonical(headers)).toBe(true);
    expect(() => assertCanonicalCdrHeader(headers)).not.toThrow();
  });

  it("keeps traffic summary columns inside the dump or enrich set", () => {
    expect(TRAFFIC_SUMMARY_COLUMNS).toEqual([
      "cdr_day",
      "cdr_time",
      "bill_ani",
      "side_a",
      "bill_dnis",
      "side_b",
      "out_orig_dnis",
      "elapsed_time",
      "src_name",
      "dst_name",
      "dp_name",
      "disconnect_code_string",
      "voipmonitor_url_in",
      "voipmonitor_url_out",
    ]);
    expect(TRAFFIC_SUMMARY_LABELS.cdr_day).toBe("Дата");
    expect(TRAFFIC_SUMMARY_LABELS.cdr_time).toBe("Время");
    expect(TRAFFIC_SUMMARY_LABELS.side_a).toBe("Сторона A");
    expect(TRAFFIC_SUMMARY_LABELS.disconnect_code_string).toBe(
      "Код завершения",
    );
    expect(TRAFFIC_SUMMARY_LABELS.voipmonitor_url_in).toBe("Calltrace In");
    expect(TRAFFIC_SUMMARY_LABELS.voipmonitor_url_out).toBe("Calltrace Out");
    for (const col of TRAFFIC_SUMMARY_COLUMNS) {
      if (col === "voipmonitor_url_in" || col === "voipmonitor_url_out") {
        expect(isTrafficColumn(col)).toBe(false);
        continue;
      }
      expect(isTrafficColumn(col)).toBe(true);
    }
  });

  it("keeps geography view columns inside the dump or enrich set", () => {
    expect(TRAFFIC_GEOGRAPHY_COLUMNS).toEqual([
      "cdr_day",
      "cdr_time",
      "bill_ani",
      "side_a",
      "operator_a",
      "geography_a",
      "bill_dnis",
      "side_b",
      "operator_b",
      "geography_b",
      "out_orig_dnis",
      "elapsed_time",
      "src_name",
      "dst_name",
      "dp_name",
      "disconnect_code_string",
    ]);
    expect(TRAFFIC_GEOGRAPHY_LABELS.operator_a).toBe("Оператор А");
    expect(TRAFFIC_GEOGRAPHY_LABELS.geography_a).toBe("География A");
    expect(TRAFFIC_GEOGRAPHY_LABELS.disconnect_code_string).toBe(
      "Код завершения",
    );
    for (const col of TRAFFIC_GEOGRAPHY_COLUMNS) {
      expect(isTrafficColumn(col)).toBe(true);
    }
  });

  it("keeps operators view columns inside the dump or enrich set", () => {
    expect(TRAFFIC_OPERATORS_COLUMNS).toEqual([
      "cdr_day",
      "cdr_time",
      "bill_ani",
      "side_a",
      "bill_dnis",
      "side_b",
      "out_orig_dnis",
      "elapsed_time",
      "remote_src_sig_address",
      "country_a",
      "city_a",
      "provider_a",
      "remote_dst_sig_address",
      "country_b",
      "city_b",
      "provider_b",
      "src_name",
      "dst_name",
      "dp_name",
      "disconnect_code_string",
    ]);
    expect(TRAFFIC_OPERATORS_LABELS.remote_src_sig_address).toBe(
      "Инициирование",
    );
    expect(TRAFFIC_OPERATORS_LABELS.remote_dst_sig_address).toBe("Терминация");
    expect(TRAFFIC_OPERATORS_LABELS.country_a).toBe("Страна А");
    for (const col of TRAFFIC_OPERATORS_COLUMNS) {
      expect(isTrafficColumn(col)).toBe(true);
    }
  });

  it("places enrich columns next to source fields without changing the dump contract", () => {
    expect(CDR_ENRICH_COLUMNS).toHaveLength(12);
    expect(RAW_TABLE_COLUMNS).toHaveLength(134);
    expect(RAW_TABLE_COLUMNS[1]).toBe("voipmonitor_url_in");
    expect(RAW_TABLE_COLUMNS[2]).toBe("voipmonitor_url_out");
    for (const col of CDR_COLUMNS) {
      expect(RAW_TABLE_COLUMNS).toContain(col);
    }
    for (const col of CDR_ENRICH_COLUMNS) {
      expect(RAW_TABLE_COLUMNS).toContain(col);
      expect(CDR_COLUMNS).not.toContain(col);
    }
    expect(RAW_TABLE_COLUMNS.indexOf("side_a")).toBe(
      RAW_TABLE_COLUMNS.indexOf("bill_ani") + 1,
    );
    expect(RAW_TABLE_COLUMNS.indexOf("country_a")).toBe(
      RAW_TABLE_COLUMNS.indexOf("remote_src_sig_address") + 1,
    );
  });

  it("rejects the 11-column slice header", () => {
    const slim = parseCdrHeaderLine(
      '"cdr_date";"bill_ani";"bill_dnis";"out_orig_dnis";"elapsed_time";"src_name";"dst_name";"dp_name";"disconnect_code_string";"remote_src_sig_address";"remote_dst_sig_address"',
    );
    expect(headersMatchCanonical(slim)).toBe(false);
    expect(() => assertCanonicalCdrHeader(slim)).toThrow(/Неверный заголовок/);
  });
});

describe("parseCdrDataLine", () => {
  it("maps quoted fields and keeps cdr_date digits as civil UTC", () => {
    const row = parseCdrDataLine(
      quotedRow({
        cdr_id: "202608270000007910",
        cdr_date: "2026-08-27 20:04:19",
        in_ani: "79528752577",
        in_dnis: "78622444444",
        elapsed_time: "126109",
        src_name: "PSTN_Sochi_MTS_Local",
      }),
    );
    expect(row).not.toBeNull();
    expect(row!.cdrId).toBe("202608270000007910");
    expect(row!.prisma.inAni).toBe("79528752577");
    expect(row!.prisma.elapsedTime).toBe("126109");
    expect(row!.cdrAt?.toISOString()).toBe("2026-08-27T20:04:19.000Z");
    expect(row!.prisma.cdrDay).toBe("2026-08-27");
    expect(row!.prisma.cdrTime).toBe("20:04:19");
  });

  it("rejects empty cdr_id, wrong width, and missing date", () => {
    expect(parseCdrDataLine(quotedRow({ cdr_id: "" }))).toBeNull();
    expect(parseCdrDataLine('"a";"b"')).toBeNull();
    expect(parseCdrDataLine(quotedRow({ cdr_id: "id1", cdr_date: "" }))).toBeNull();
    expect(
      parseCdrDataLine(quotedRow({ cdr_id: "id1", cdr_date: "not-a-date" })),
    ).toBeNull();
  });

  it("keeps empty optional fields", () => {
    const row = parseCdrDataLine(
      quotedRow({
        cdr_id: "id1",
        cdr_date: "2026-08-27 20:04:19",
        out_orig_dnis: "",
      }),
    );
    expect(row!.fields.out_orig_dnis).toBe("");
    expect(row!.prisma.outOrigDnis).toBe("");
  });
});

describe("parseCdrDate", () => {
  it("returns null for garbage", () => {
    expect(parseCdrDate("not-a-date")).toBeNull();
  });

  it("does not subtract a display timezone", () => {
    expect(parseCdrDate("2026-06-30 23:59:59")?.toISOString()).toBe(
      "2026-06-30T23:59:59.000Z",
    );
    expect(parseCdrDate("2026-07-01T00:30:00")?.toISOString()).toBe(
      "2026-07-01T00:30:00.000Z",
    );
  });
});
