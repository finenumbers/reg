"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/modules/numbering-sync/card-numbers";

export const loadButtonClass = "bg-black text-white hover:bg-neutral-800";
export const logButtonClass = "border-black bg-white text-black hover:bg-neutral-100";

export function SourceCard({
  name,
  loadedAtLabel,
  rows,
  loadDisabled,
  onLoad,
  hasLog,
  logHref,
  onKeyDown,
  children,
}: {
  name: string;
  loadedAtLabel: string;
  rows: { label: string; value: number | null }[];
  loadDisabled: boolean;
  onLoad: () => void;
  hasLog: boolean;
  logHref: string;
  onKeyDown: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold underline">{name}</h2>
      <p className="text-sm">
        Загрузка: <span className="font-semibold">{loadedAtLabel}</span>
      </p>
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
        <Button
          type="button"
          className={loadButtonClass}
          disabled={loadDisabled}
          onClick={onLoad}
        >
          Загрузить
        </Button>
        {hasLog ? (
          <Button type="button" variant="outline" className={logButtonClass} asChild>
            <a href={logHref}>Скачать лог</a>
          </Button>
        ) : (
          <Button type="button" variant="outline" className={logButtonClass} disabled>
            Скачать лог
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
