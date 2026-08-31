const LDC_SUFFIX = "_LDC";
const LOCAL_SUFFIX = "_Local";

export type PstnDeviceInput = {
  name: string;
  inCalls: number;
  inMinutes: number;
  outCalls: number;
  outMinutes: number;
  parkingCalls: number;
  parkingMinutes: number;
  phantomCalls: number;
  phantomMinutes: number;
};

export type PstnJoinRow = PstnDeviceInput & {
  ldcCalls: number;
  ldcMinutes: number;
};

export function isPstnLdc(name: string): boolean {
  return name.startsWith("PSTN_") && name.endsWith(LDC_SUFFIX);
}

/** Logical PSTN join key: strip a single trailing `_Local` or `_LDC`. */
export function pstnJoinName(name: string): string | null {
  if (!name.startsWith("PSTN_")) return null;
  if (name.endsWith(LDC_SUFFIX)) return name.slice(0, -LDC_SUFFIX.length);
  if (name.endsWith(LOCAL_SUFFIX)) return name.slice(0, -LOCAL_SUFFIX.length);
  return name;
}

function emptyJoin(name: string): PstnJoinRow {
  return {
    name,
    inCalls: 0,
    inMinutes: 0,
    outCalls: 0,
    outMinutes: 0,
    parkingCalls: 0,
    parkingMinutes: 0,
    phantomCalls: 0,
    phantomMinutes: 0,
    ldcCalls: 0,
    ldcMinutes: 0,
  };
}

/** Merge Local/unsuffixed + `_LDC` device rows onto one join name. */
export function pairPstnRows(rows: PstnDeviceInput[]): PstnJoinRow[] {
  const byKey = new Map<string, PstnJoinRow>();
  for (const row of rows) {
    const key = pstnJoinName(row.name);
    if (!key) continue;
    const current = byKey.get(key) ?? emptyJoin(key);
    if (isPstnLdc(row.name)) {
      current.ldcCalls += row.outCalls;
      current.ldcMinutes += row.outMinutes;
    } else {
      current.inCalls += row.inCalls;
      current.inMinutes += row.inMinutes;
      current.outCalls += row.outCalls;
      current.outMinutes += row.outMinutes;
      current.parkingCalls += row.parkingCalls;
      current.parkingMinutes += row.parkingMinutes;
      current.phantomCalls += row.phantomCalls;
      current.phantomMinutes += row.phantomMinutes;
    }
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}
