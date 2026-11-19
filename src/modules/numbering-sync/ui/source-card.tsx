"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/modules/numbering-sync/card-numbers";

export const loadButtonClass =
  "w-56 shrink-0 justify-center whitespace-nowrap bg-black text-white hover:bg-neutral-800";
const logButtonClass =
  "w-64 shrink-0 justify-center whitespace-nowrap border-black bg-white text-black hover:bg-neutral-100";

export type SourceLoad = {
  label: string;
  disabled: boolean;
  onClick: () => void;
};

export type SourceLog = {
  label: string;
  href: string;
  hasLog: boolean;
};

function countClass(label: string): string {
  const weight = "text-right font-bold tabular-nums";
  if (label === "Купленные") return `${weight} text-blue-600 dark:text-blue-400`;
  if (label === "Свободные") return `${weight} text-green-600 dark:text-green-400`;
  if (label === "Разобрано") return weight;
  return "text-right tabular-nums";
}

type ButtonRowItem =
  | (SourceLoad & { kind: "load" })
  | (SourceLog & { kind: "log" });

/** One load sits beside its log. A further log starts the next row. */
function buttonRows(loads: SourceLoad[], logs: SourceLog[]): ButtonRowItem[][] {
  const count = Math.max(loads.length, logs.length);
  const rows: ButtonRowItem[][] = [];
  for (let index = 0; index < count; index += 1) {
    const row: ButtonRowItem[] = [];
    const load = loads[index];
    const log = logs[index];
    if (load) row.push({ ...load, kind: "load" });
    if (log) row.push({ ...log, kind: "log" });
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

export function SourceCard({
  name,
  times,
  rows,
  loads,
  logs,
  onKeyDown,
  children,
}: {
  name: string;
  times: { label: string; value: string }[];
  rows: { label: string; value: number | null }[];
  loads: SourceLoad[];
  logs: SourceLog[];
  onKeyDown: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">{name}</h2>
      <div>
        {times.map((time) => (
          <p key={time.label} className="py-0.5 text-sm">
            {time.label}: <span className="font-semibold">{time.value}</span>
          </p>
        ))}
      </div>
      <table className="text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="w-36 py-0.5 pr-8">{row.label}</td>
              <td className={countClass(row.label)}>{formatCount(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-2">
        {buttonRows(loads, logs).map((row) => (
          <div key={row.map((item) => item.label).join("|")} className="flex flex-wrap gap-2">
            {row.map((item) =>
              item.kind === "load" ? (
                <Button
                  key={item.label}
                  type="button"
                  className={loadButtonClass}
                  disabled={item.disabled}
                  onClick={item.onClick}
                >
                  {item.label}
                </Button>
              ) : item.hasLog ? (
                <Button
                  key={item.label}
                  type="button"
                  variant="outline"
                  className={logButtonClass}
                  asChild
                >
                  <a href={item.href}>{item.label}</a>
                </Button>
              ) : (
                <Button
                  key={item.label}
                  type="button"
                  variant="outline"
                  className={logButtonClass}
                  disabled
                >
                  {item.label}
                </Button>
              ),
            )}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
