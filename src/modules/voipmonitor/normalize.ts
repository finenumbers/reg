import type { CdrCandidate } from "@/modules/voipmonitor/types";

export function normalizeCallId(value: string): string {
  let next = value.trim().toLowerCase();
  if (!next) return "";
  const at = next.indexOf("@");
  if (at > 0) next = next.slice(0, at);
  return next.trim();
}

export function callIdVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string) => {
    const norm = normalizeCallId(value);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  };
  add(trimmed);
  const at = trimmed.indexOf("@");
  if (at > 0) add(trimmed.slice(0, at));
  return out;
}

export function callIdQueryVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string) => {
    const next = value.trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  };
  add(trimmed);
  add(trimmed.toLowerCase());
  const at = trimmed.indexOf("@");
  if (at > 0) {
    add(trimmed.slice(0, at));
    add(trimmed.slice(0, at).toLowerCase());
  }
  return out;
}

export function digits(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch >= "0" && ch <= "9") out += ch;
  }
  return out;
}

export function numberSuffixes(value: string, primary: number): string[] {
  const d = digits(value);
  if (!d) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (n: number) => {
    if (n <= 0 || d.length < n) return;
    const s = d.slice(d.length - n);
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  add(primary);
  add(primary + 1);
  add(primary + 2);
  if (primary !== 10) add(10);
  if (d.length < primary) add(d.length);
  return out;
}

export function ipEqual(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left !== "" && left === right;
}

export function uniqueNonEmpty(...values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sourceCallIdNorms(cdr: CdrCandidate): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cdr.sipCallIds) {
    for (const norm of callIdVariants(raw)) {
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function cdrCallerNumbers(cdr: CdrCandidate): string[] {
  if (cdr.callerNumbers.length > 0) return cdr.callerNumbers;
  return uniqueNonEmpty(cdr.caller);
}

export function cdrCalledNumbers(cdr: CdrCandidate): string[] {
  if (cdr.calledNumbers.length > 0) return cdr.calledNumbers;
  return uniqueNonEmpty(cdr.called);
}

export function callIdsEqual(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const na = normalizeCallId(a);
  const nb = normalizeCallId(b);
  return na !== "" && na === nb;
}

export function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
