"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addException,
  deleteException,
  fetchExceptions,
  type DialExceptionItem,
} from "@/modules/exceptions/api-client";

export function ExceptionsView({ initial }: { initial: DialExceptionItem[] }) {
  const [items, setItems] = useState(initial);
  const [abc, setAbc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function reload() {
    const result = await fetchExceptions();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setItems(result.items);
  }

  async function onAdd() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await addException(abc);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setAbc("");
    toast.success("ABC добавлен. Пересчёт звонков поставлен в очередь.");
    await reload();
  }

  async function onDelete(code: string) {
    if (pending) return;
    const confirmed = window.confirm(
      `Удалить ABC ${code}? Звонки на этот код вернутся к обычной проверке длины. Пересчёт будет поставлен в очередь.`,
    );
    if (!confirmed) return;
    setPending(true);
    setError(null);
    const result = await deleteException(code);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success("ABC удалён. Пересчёт звонков поставлен в очередь.");
    await reload();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Исключения
        </h1>
        <p className="text-muted-foreground text-sm">
          ABC в начале B-номера — «Ошибка» / «Проверить», пока в тарифе нет своего ABC на
          этот код. Самый длинный код важнее. Более короткий ABC тарифа его не закрывает:
          добавленный 79 перестаёт оцениваться по ABC 7.
        </p>
      </div>

      <form
        className="flex shrink-0 flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onAdd();
        }}
      >
        <label className="flex w-48 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">ABC</span>
          <Input
            value={abc}
            onChange={(event) => setAbc(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            disabled={pending}
            aria-label="ABC"
          />
        </label>
        <Button type="submit" className="mt-6" disabled={pending}>
          {pending ? "Сохранение…" : "Добавить"}
        </Button>
      </form>

      {error ? <p className="text-destructive shrink-0 text-sm">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ABC</TableHead>
              <TableHead className="w-28">Удалить</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground h-24">
                  Нет кодов.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.abc}>
                  <TableCell>{item.abc}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => void onDelete(item.abc)}
                    >
                      Удалить
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
