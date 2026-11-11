import { AXIS_BASELINE, AXIS_TOP } from "@/modules/dashboard/concurrency";

export type ZabbixScale = {
  min: number;
  max: number;
  ticks: number[];
};

/** 1-2-5 step on a power of ten. A zero span does not collapse the scale. */
export function niceStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const exp = Math.floor(Math.log10(span));
  const base = 10 ** exp;
  const frac = span / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

function snapDown(value: number, step: number): number {
  return Math.floor(value / step + 1e-9) * step;
}

function snapUp(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

function ticksBetween(min: number, max: number): number[] {
  if (!(max > min)) return [min];
  const step = (max - min) / 4;
  return [4, 3, 2, 1, 0].map((part) => min + part * step);
}

/** Reference level on the second home Zabbix graph. The axis prints it as 50M. */
export const ZABBIX_GRAPH2_MARK = 50_000_000;

/**
 * Non-negative series start at zero. A negative sample keeps its sign.
 * The call-chart ceiling truncates to a whole number and is not used here.
 * `level` raises the scale only. It is not a sample on a line.
 */
export function zabbixScale(
  values: readonly (number | null)[],
  level?: number,
): ZabbixScale {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (level != null && Number.isFinite(level)) finite.push(level);
  if (finite.length === 0) return { min: 0, max: 0, ticks: [0] };
  let low = finite[0] ?? 0;
  let high = low;
  for (const value of finite) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (low >= 0) low = 0;
  if (high < low) high = low;
  if (high === low) {
    if (high === 0) return { min: 0, max: 0, ticks: [0] };
    const pad = niceStep(Math.abs(high) || 1);
    const min = low >= 0 ? 0 : high - pad;
    const max = high + pad;
    return { min, max, ticks: ticksBetween(min, max) };
  }
  const step = niceStep((high - low) / 4);
  const min = low >= 0 ? 0 : snapDown(low, step);
  const max = Math.max(min + step, snapUp(high, step));
  return { min, max, ticks: ticksBetween(min, max) };
}

/** CSS `top` percent. Matches the SVG y of the same value. */
export function zabbixTickTop(value: number, scale: ZabbixScale): number {
  if (scale.max <= scale.min) return AXIS_BASELINE;
  const t = (value - scale.min) / (scale.max - scale.min);
  const clamped = Math.min(1, Math.max(0, t));
  return AXIS_BASELINE - clamped * (AXIS_BASELINE - AXIS_TOP);
}

export function zabbixPlotY(value: number, scale: ZabbixScale): number {
  return zabbixTickTop(value, scale);
}

export function formatZabbixNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = [
    { limit: 1e12, suffix: "T" },
    { limit: 1e9, suffix: "G" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "k" },
  ];
  for (const unit of units) {
    if (abs >= unit.limit) {
      return sign + trimZeros((abs / unit.limit).toFixed(1)) + unit.suffix;
    }
  }
  const digits = abs >= 100 ? 0 : 2;
  return sign + trimZeros(abs.toFixed(digits));
}

export function formatZabbixValue(value: number, unit: string): string {
  const text = unit === "%" ? trimZeros(value.toFixed(2)) : formatZabbixNumber(value);
  return unit ? `${text} ${unit}` : text;
}

function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

const STROKE_FALLBACK = "#64748b";

/** Zabbix sends RRGGBB. Anything else is not painted into the SVG. */
export function zabbixStroke(color: string): string {
  const hex = color.trim().replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? `#${hex}` : STROKE_FALLBACK;
}
