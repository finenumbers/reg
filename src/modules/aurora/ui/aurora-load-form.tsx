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
  const [url, setUrl] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const remove = view.files.find((item) => item.id === removeId) ?? null;
  const trimmed = url.trim();

  async function send(path: string, body: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: AuroraLoadView;
        dropped?: number;
        kept?: number;
      } | null;
      if (payload?.settings) setView(payload.settings);
      if (!response.ok) {
        setError(payload?.error ?? "Не удалось выполнить запрос.");
        return;
      }
      setConfirm(false);
      setRemoveId(null);
      setUrl("");
      setFormat("");
      if (typeof payload?.kept === "number") {
        setNote(
          `Номеров: ${payload.kept}. Повторов будет отброшено: ${payload.dropped ?? 0}.`,
        );
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
        У каждой ссылки свой формат. Сохраните ссылку, затем введите следующую и снова
        выберите формат. В списке не больше 20. Сохранение ничего не скачивает.
        «Загрузить» на странице синхронизации каждый раз скачивает этот список заново.
      </p>
      {view.files.length > 0 ? (
        <ul className="space-y-2">
          {view.files.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="min-w-0 flex-1 truncate"
                title={item.unreadable ? undefined : item.url}
              >
                {item.unreadable ? "Ссылка не читается" : item.url}
              </span>
              <span>{item.unreadable ? "" : FORMAT_LABEL[item.format]}</span>
              <Button
                type="button"
                variant="outline"
                disabled={pending || index === 0}
                onClick={() =>
                  void send(
                    "/api/numbering-load/aurora/files/move",
                    JSON.stringify({ id: item.id, direction: "up" }),
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
        <p className="text-sm">Ссылки ещё не указаны.</p>
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
        <Label htmlFor="aurora-url">Ссылка</Label>
        <Input
          id="aurora-url"
          type="url"
          value={url}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || trimmed === "" || format === ""}
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
          onClick={() => void send("/api/numbering-load/aurora/test", "{}")}
        >
          Проверить
        </Button>
      </div>
      {confirm && trimmed && format ? (
        <div
          role="dialog"
          aria-label="Подтверждение сохранения"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm break-all">
            Aurora Telecom
            <br />
            Ссылка: {trimmed}
            <br />
            Формат: {FORMAT_LABEL[format]}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void send(
                  "/api/numbering-load/aurora/files",
                  JSON.stringify({ url: trimmed, format }),
                )
              }
            >
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {remove ? (
        <div
          role="dialog"
          aria-label="Подтверждение удаления"
          className="space-y-3 rounded-md border p-4"
        >
          <p className="text-sm break-all">
            Удалить {remove.unreadable ? "нечитаемую ссылку" : remove.url}
            <br />
            {remove.unreadable ? null : <>Формат: {FORMAT_LABEL[remove.format]}</>}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void send(
                  "/api/numbering-load/aurora/files/remove",
                  JSON.stringify({ id: remove.id }),
                )
              }
            >
              Удалить
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setRemoveId(null)}
            >
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
