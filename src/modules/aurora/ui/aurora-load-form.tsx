"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuroraLoadView } from "@/modules/aurora/service";

type Format = "short" | "full";

const FORMAT_LABEL: Record<Format, string> = {
  short: "Сокращённый",
  full: "Полный",
};

export function AuroraLoadForm({ initial }: { initial: AuroraLoadView }) {
  const [view, setView] = useState(initial);
  const [format, setFormat] = useState<Format | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const remove = view.files.find((item) => item.id === removeId) ?? null;

  async function send(path: string, body: BodyInit | undefined, json: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: json ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: AuroraLoadView;
        dropped?: number;
        kept?: number;
        ok?: boolean;
      } | null;
      if (payload?.settings) setView(payload.settings);
      if (!response.ok) {
        setError(payload?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(false);
      setRemoveId(null);
      setFile(null);
      setFormat("");
      if (typeof payload?.kept === "number") {
        setNote(
          `Номеров: ${payload.kept}. Повторов будет отброшено: ${payload.dropped ?? 0}.`,
        );
      } else if (typeof payload?.dropped === "number") {
        setNote(`Повторов будет отброшено: ${payload.dropped}.`);
      }
    } catch {
      setError("Не удалось выполнить запрос.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape" && (confirm || removeId)) {
      event.preventDefault();
      setConfirm(false);
      setRemoveId(null);
    }
  }

  return (
    <div className="max-w-xl space-y-4" onKeyDown={onKeyDown}>
      <h2 className="text-base font-semibold">Aurora Telecom</h2>
      <p className="text-muted-foreground text-sm">
        У каждого файла укажите формат. Сохранение не записывает номера. «Загрузить» на
        странице синхронизации читает этот набор и после записи удаляет файлы.
      </p>
      {view.files.length > 0 ? (
        <ul className="space-y-2">
          {view.files.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span>{FORMAT_LABEL[item.format]}</span>
              <Button
                type="button"
                variant="outline"
                disabled={pending || index === 0}
                onClick={() =>
                  void send(
                    "/api/numbering-load/aurora/files/move",
                    JSON.stringify({ id: item.id, direction: "up" }),
                    true,
                  )
                }
              >
                Выше
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || index === view.files.length - 1}
                onClick={() =>
                  void send(
                    "/api/numbering-load/aurora/files/move",
                    JSON.stringify({ id: item.id, direction: "down" }),
                    true,
                  )
                }
              >
                Ниже
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setNote(null);
                  setRemoveId(item.id);
                }}
              >
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">Файлы ещё не указаны.</p>
      )}
      <div className="space-y-2">
        <Label htmlFor="aurora-format">Формат</Label>
        <select
          id="aurora-format"
          className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm"
          value={format}
          onChange={(event) => {
            const value = event.target.value;
            setFormat(value === "full" || value === "short" ? value : "");
          }}
        >
          <option value="">Выберите формат</option>
          <option value="short">Сокращённый</option>
          <option value="full">Полный</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="aurora-file">Файл CSV</Label>
        <Input
          id="aurora-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || !file || format === ""}
          onClick={() => {
            setError(null);
            setNote(null);
            setConfirm(true);
          }}
        >
          Сохранить
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || view.files.length === 0}
          onClick={() => void send("/api/numbering-load/aurora/test", "{}", true)}
        >
          Проверить файлы
        </Button>
      </div>
      {confirm && file && format ? (
        <div role="dialog" aria-label="Подтверждение сохранения" className="space-y-3 rounded-md border p-4">
          <p className="text-sm">
            Aurora Telecom
            <br />
            Файл: {file.name}
            <br />
            Формат: {FORMAT_LABEL[format]}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                const body = new FormData();
                body.set("file", file);
                body.set("format", format);
                void send("/api/numbering-load/aurora/files", body, false);
              }}
            >
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirm(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {remove ? (
        <div role="dialog" aria-label="Подтверждение удаления" className="space-y-3 rounded-md border p-4">
          <p className="text-sm">
            Удалить {remove.name}
            <br />
            Формат: {FORMAT_LABEL[remove.format]}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void send(
                  "/api/numbering-load/aurora/files/remove",
                  JSON.stringify({ id: remove.id }),
                  true,
                )
              }
            >
              Удалить
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setRemoveId(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}
