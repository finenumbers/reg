/**
 * Canonical full-dump CDR headers (softswitch file like 20260827_200419).
 * Order is part of the contract — header mismatch fails the import.
 */

export const CDR_COLUMNS = [
  "cdr_id",
  "cdr_date",
  "in_ani",
  "in_dnis",
  "out_ani",
  "out_dnis",
  "bill_ani",
  "bill_dnis",
  "sig_node_name",
  "src_gatekeeper_address",
  "remote_src_sig_address",
  "remote_dst_sig_address",
  "remote_src_media_address",
  "remote_dst_media_address",
  "local_src_sig_address",
  "local_dst_sig_address",
  "local_src_media_address",
  "local_dst_media_address",
  "in_leg_proto",
  "out_leg_proto",
  "conf_id",
  "in_leg_call_id",
  "out_leg_call_id",
  "src_user",
  "dst_user",
  "radius_user",
  "src_name",
  "dst_name",
  "dp_name",
  "elapsed_time",
  "setup_time",
  "connect_time",
  "disconnect_time",
  "in_leg_codecs",
  "out_leg_codecs",
  "src_faststart_present",
  "dst_faststart_present",
  "src_tunneling_present",
  "dst_tunneling_present",
  "proxy_mode",
  "lar_fault_reason",
  "route_retries",
  "scd",
  "pdd",
  "media_group",
  "src_media_bytes_in",
  "src_media_bytes_out",
  "dst_media_bytes_in",
  "dst_media_bytes_out",
  "src_media_packets",
  "dst_media_packets",
  "src_media_packets_late",
  "dst_media_packets_late",
  "src_media_packets_lost",
  "dst_media_packets_lost",
  "src_min_jitter_size",
  "src_max_jitter_size",
  "dst_min_jitter_size",
  "dst_max_jitter_size",
  "last_cdr",
  "in_cpc",
  "out_cpc",
  "in_zone",
  "out_zone",
  "disconnect_initiator",
  "in_ani_type_of_number",
  "in_dnis_type_of_number",
  "out_ani_type_of_number",
  "out_dnis_type_of_number",
  "src_in_leg_conf_id",
  "src_in_leg_call_id",
  "src_out_leg_call_id",
  "in_orig_dnis",
  "out_orig_dnis",
  "record_type",
  "extradata",
  "term_elapsed_time",
  "term_setup_time",
  "term_connect_time",
  "term_disconnect_time",
  "term_scd",
  "term_pdd",
  "external_router",
  "radius_group",
  "in_ani_screening",
  "in_ani_presentation",
  "out_ani_screening",
  "out_ani_presentation",
  "outgoing_pulses",
  "incoming_pulses",
  "in_lrn",
  "retrieved_lrn",
  "lrn",
  "ext_lrn",
  "out_lrn",
  "lnp_server",
  "in_leg_transport_proto",
  "out_leg_transport_proto",
  "sip_routing_group",
  "looping_cycles",
  "auth_dnis",
  "ext_ani",
  "ext_dnis",
  "ext_sig_address",
  "in_partner_id",
  "out_partner_id",
  "disconnect_code_string",
  "disconnect_code_success",
  "src_disconnect_codes_string",
  "dst_disconnect_codes_string",
  "in_orig_dnis_type_of_number",
  "out_orig_dnis_type_of_number",
  "in_encryption",
  "out_encryption",
  "ext_ani_type_of_number",
  "ext_dnis_type_of_number",
  "ext_orig_dnis_type_of_number",
  "src_disconnect_codes",
  "dst_disconnect_codes",
  "disconnect_code",
] as const;

export type CdrColumn = (typeof CDR_COLUMNS)[number];

export const CDR_COLUMN_COUNT = CDR_COLUMNS.length;

export const CDR_COLUMN_SET = new Set<string>(CDR_COLUMNS);

/** Toolbar search — billing + signalling numbers. */
export const CDR_PHONE_COLUMNS = [
  "in_ani",
  "in_dnis",
  "out_ani",
  "out_dnis",
  "bill_ani",
  "bill_dnis",
] as const;

/** Short traffic table — subset of the full CDR dump, display labels in UI. */
export const VOIPMONITOR_COLUMN_IN = "voipmonitor_url_in";
export const VOIPMONITOR_COLUMN_OUT = "voipmonitor_url_out";
export const VOIPMONITOR_COLUMNS = [
  VOIPMONITOR_COLUMN_IN,
  VOIPMONITOR_COLUMN_OUT,
] as const;
export const VOIPMONITOR_COLUMN_SET = new Set<string>(VOIPMONITOR_COLUMNS);
export const VOIPMONITOR_RAW_LABELS: Record<
  (typeof VOIPMONITOR_COLUMNS)[number],
  string
> = {
  voipmonitor_url_in: "VoIPmonitor In",
  voipmonitor_url_out: "VoIPmonitor Out",
};
export const VOIPMONITOR_TRAFFIC_LABELS: Record<
  (typeof VOIPMONITOR_COLUMNS)[number],
  string
> = {
  voipmonitor_url_in: "Calltrace In",
  voipmonitor_url_out: "Calltrace Out",
};

export const TRAFFIC_SUMMARY_COLUMNS = [
  "cdr_date",
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
  ...VOIPMONITOR_COLUMNS,
] as const;

export const TRAFFIC_SUMMARY_LABELS: Record<
  (typeof TRAFFIC_SUMMARY_COLUMNS)[number],
  string
> = {
  cdr_date: "Время звонка",
  bill_ani: "А-номер",
  side_a: "Сторона A",
  bill_dnis: "В-номер",
  side_b: "Сторона B",
  out_orig_dnis: "Переадресация",
  src_name: "Инициирующее устройство",
  dst_name: "Терминирующее устройство",
  dp_name: "Объект набора",
  elapsed_time: "Длительность",
  disconnect_code_string: "Код завершения",
  voipmonitor_url_in: VOIPMONITOR_TRAFFIC_LABELS.voipmonitor_url_in,
  voipmonitor_url_out: VOIPMONITOR_TRAFFIC_LABELS.voipmonitor_url_out,
};

export const TRAFFIC_GEOGRAPHY_COLUMNS = [
  "cdr_date",
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
] as const;

export const TRAFFIC_GEOGRAPHY_LABELS: Record<
  (typeof TRAFFIC_GEOGRAPHY_COLUMNS)[number],
  string
> = {
  cdr_date: "Время звонка",
  bill_ani: "А-номер",
  side_a: "Сторона A",
  operator_a: "Оператор А",
  geography_a: "География A",
  bill_dnis: "В-номер",
  side_b: "Сторона B",
  operator_b: "Оператор B",
  geography_b: "География B",
  out_orig_dnis: "Переадресация",
  src_name: "Инициирующее устройство",
  dst_name: "Терминирующее устройство",
  dp_name: "Объект набора",
  elapsed_time: "Длительность",
  disconnect_code_string: "Код завершения",
};

export const TRAFFIC_OPERATORS_COLUMNS = [
  "cdr_date",
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
] as const;

export const TRAFFIC_OPERATORS_LABELS: Record<
  (typeof TRAFFIC_OPERATORS_COLUMNS)[number],
  string
> = {
  cdr_date: "Время звонка",
  bill_ani: "А-номер",
  side_a: "Сторона A",
  bill_dnis: "В-номер",
  side_b: "Сторона B",
  out_orig_dnis: "Переадресация",
  remote_src_sig_address: "Инициирование",
  country_a: "Страна А",
  city_a: "Город A",
  provider_a: "Провайдер A",
  remote_dst_sig_address: "Терминация",
  country_b: "Страна B",
  city_b: "Город B",
  provider_b: "Провайдер B",
  src_name: "Инициирующее устройство",
  dst_name: "Терминирующее устройство",
  dp_name: "Объект набора",
  elapsed_time: "Длительность",
  disconnect_code_string: "Код завершения",
};

export const TRAFFIC_BOLD_COLUMNS = ["bill_ani", "bill_dnis"] as const;

export const CDR_ENRICH_COLUMNS = [
  "side_a",
  "operator_a",
  "geography_a",
  "side_b",
  "operator_b",
  "geography_b",
  "country_a",
  "city_a",
  "provider_a",
  "country_b",
  "city_b",
  "provider_b",
] as const;

export type CdrEnrichColumn = (typeof CDR_ENRICH_COLUMNS)[number];

export const CDR_ENRICH_LABELS: Record<CdrEnrichColumn, string> = {
  side_a: "Сторона А",
  operator_a: "Оператор А",
  geography_a: "География A",
  side_b: "Сторона B",
  operator_b: "Оператор B",
  geography_b: "География B",
  country_a: "Страна А",
  city_a: "Город A",
  provider_a: "Провайдер A",
  country_b: "Страна B",
  city_b: "Город B",
  provider_b: "Провайдер B",
};

const ENRICH_AFTER: Record<string, readonly CdrEnrichColumn[]> = {
  bill_ani: ["side_a", "operator_a", "geography_a"],
  bill_dnis: ["side_b", "operator_b", "geography_b"],
  remote_src_sig_address: ["country_a", "city_a", "provider_a"],
  remote_dst_sig_address: ["country_b", "city_b", "provider_b"],
};

export const RAW_TABLE_COLUMNS: readonly string[] = CDR_COLUMNS.flatMap((col) => [
  col,
  ...(col === "cdr_id" ? [...VOIPMONITOR_COLUMNS] : []),
  ...(ENRICH_AFTER[col] ?? []),
]);

const TRAFFIC_COLUMN_SET = new Set<string>([
  ...CDR_COLUMNS,
  ...CDR_ENRICH_COLUMNS,
]);

export const CDR_INSERT_BATCH_SIZE = 400;
export const CDR_ENRICH_BACKFILL_MAX_ROWS = 2000;
export const CDR_ENRICH_BACKFILL_PAGE_SIZE = 400;

/** Full-day dumps are hundreds of MB; import streams line-by-line. */
export const CDR_MAX_FILE_BYTES = 1_000_000_000;

export function csvHeaderToCamel(header: string): string {
  return header.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

export const CDR_PRISMA_FIELDS = CDR_COLUMNS.map(csvHeaderToCamel);

const PRISMA_FIELD_SET = new Set(CDR_PRISMA_FIELDS);

export function isCdrColumn(value: string): value is CdrColumn {
  return CDR_COLUMN_SET.has(value);
}

export function isTrafficColumn(value: string): boolean {
  return TRAFFIC_COLUMN_SET.has(value);
}

export function isCdrPrismaField(value: string): boolean {
  return PRISMA_FIELD_SET.has(value);
}

export function headersMatchCanonical(headers: readonly string[]): boolean {
  if (headers.length !== CDR_COLUMNS.length) return false;
  return CDR_COLUMNS.every((col, i) => headers[i] === col);
}
