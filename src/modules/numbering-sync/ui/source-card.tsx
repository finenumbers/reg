"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/modules/numbering-sync/card-numbers";

export const loadButtonClass = "bg-black text-white hover:bg-neutral-800";
const logButtonClass = "border-black bg-white text-black hover:bg-neutral-100";

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
      {times.map((time) => (
        <p key={time.label} className="text-sm">
          {time.label}: <span className="font-semibold">{time.value}</span>
        </p>
      ))}
      <table className="text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="w-36 py-0.5 pr-8">{row.label}</td>
              <td className="text-right tabular-nums">{formatCount(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        {loads.map((load) => (
          <Button
            key={load.label}
            type="button"
            className={loadButtonClass}
            disabled={load.disabled}
            onClick={load.onClick}
          >
            {load.label}
          </Button>
        ))}
        {logs.map((log) =>
          log.hasLog ? (
            <Button key={log.label} type="button" variant="outline" className={logButtonClass} asChild>
              <a href={log.href}>{log.label}</a>
            </Button>
          ) : (
            <Button key={log.label} type="button" variant="outline" className={logButtonClass} disabled>
              {log.label}
            </Button>
          ),
        )}
      </div>
      {children}
    </div>
  );
}
