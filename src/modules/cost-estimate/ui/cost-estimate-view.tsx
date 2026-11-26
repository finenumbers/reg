"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { runCostEstimateUpload } from "@/modules/cost-estimate/api-client";

type UploadError = { error: string; details: string[] };

export function CostEstimateView() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const [pstnWarning, setPstnWarning] = useState<string | null>(null);

  async function onFileSelected(files: FileList | null) {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    setPstnWarning(null);
    try {
      const result = await runCostEstimateUpload(file);
      if (!result.ok) {
        setError({ error: result.error, details: result.details });
        return;
      }
      if (result.pstnSnapshotEmpty) {
        setPstnWarning(
          "Снимок PSTN пуст — оператор и география не заполнены.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-2">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Расчет затрат
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Загрузите XLSX со столбцами «Дата», «A-номер», «B-номер» (E.164) и
          «Продолжительность» (целые секунды). A-номер может быть пустым.
          Результат — оценка исходящих успешных звонков по текущему тарифу: Тип
          (Местный, Мобильный, Междугородный, Международный), Направление,
          Секунды, Минуты, Стоимость (с итогом), Сеть, Оператор связи и
          География нумерации. Файл на сервере не сохраняется.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => void onFileSelected(event.target.files)}
        />
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Расчёт…" : "Рассчитать"}
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex min-h-0 shrink-0 flex-col rounded-md border px-3 py-2 text-sm"
        >
          <p className="shrink-0 font-medium">{error.error}</p>
          <ul className="mt-1 max-h-[min(40vh,20rem)] list-disc space-y-0.5 overflow-y-auto pl-5">
            {error.details.map((detail, index) => (
              <li key={`${index}-${detail.slice(0, 48)}`}>{detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pstnWarning ? (
        <p
          role="status"
          className="border-border bg-muted/40 text-muted-foreground shrink-0 rounded-md border px-3 py-2 text-sm"
        >
          {pstnWarning}
        </p>
      ) : null}
    </div>
  );
}
