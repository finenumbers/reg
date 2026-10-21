"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ParkingKeyStatus } from "@/modules/antifraud/key-status";

export function ParkingKeyPanel({ initial }: { initial: ParkingKeyStatus }) {
  const [status, setStatus] = useState(initial);
  const [rawKeyMaterial, setRawKeyMaterial] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function onSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/parking/key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rawKeyMaterial,
          passphrase: passphrase || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        status?: ParkingKeyStatus;
      } | null;
      if (!res.ok || !body?.status) {
        toast.error(body?.error ?? "Не удалось сохранить ключ");
        return;
      }
      setStatus(body.status);
      setRawKeyMaterial("");
      setPassphrase("");
      toast.success("Ключ Parking сохранён");
    } catch {
      toast.error("Не удалось сохранить ключ");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/parking/test", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        detail?: string;
      } | null;
      if (!res.ok) {
        toast.error(body?.detail ?? body?.error ?? "Проверка не удалась");
        return;
      }
      toast.success(body?.detail ?? "Чтение calls.log доступно");
    } catch {
      toast.error("Проверка не удалась");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div>
        <h2 className="text-base font-semibold">АнтиФрод / Parking</h2>
        <p className="text-muted-foreground text-sm">
          Ключ только для чтения calls.log на parking.finenumbers.com. Хост и команда не
          задаются здесь. Пароль ключа не сохраняется.
        </p>
      </div>
      <p className="text-sm">
        {status.configured
          ? `Ключ загружен${status.fingerprint ? `: ${status.fingerprint}` : ""}`
          : "Ключ ещё не загружен. Журнал начнёт читаться с начала файла после сохранения."}
      </p>
      <div className="space-y-2">
        <Label htmlFor="parking-key">Private key</Label>
        <textarea
          id="parking-key"
          value={rawKeyMaterial}
          onChange={(event) => setRawKeyMaterial(event.target.value)}
          rows={4}
          className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="parking-passphrase">Пароль ключа</Label>
        <input
          id="parking-passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="border-input bg-background h-8 w-full max-w-sm rounded-md border px-3 text-sm"
          autoComplete="off"
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={saving || rawKeyMaterial.trim().length === 0}
          onClick={() => void onSave()}
        >
          Заменить ключ
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={testing || !status.configured}
          onClick={() => void onTest()}
        >
          Проверить чтение
        </Button>
      </div>
    </section>
  );
}
