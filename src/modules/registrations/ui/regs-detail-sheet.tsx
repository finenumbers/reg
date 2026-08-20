"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useDisplayTimezone } from "@/components/display-timezone-provider";
import type { RegistrationDetailResult } from "@/modules/registrations/service";
import {
  describeHistoryEvent,
  formatEndpoint,
  formatTimestamp,
} from "@/modules/registrations/ui-format";
import { RegStatusBadge } from "@/modules/registrations/ui/reg-status-badge";

type Props = {
  phone: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  detail: RegistrationDetailResult | null;
};

export function RegsDetailSheet({
  phone,
  open,
  onOpenChange,
  loading,
  error,
  detail,
}: Props) {
  const { timeZone } = useDisplayTimezone();
  const current = detail?.current;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-lg tabular-nums">
            {phone ?? "Регистрация"}
          </SheetTitle>
          <SheetDescription>
            Текущее состояние и история изменений из локальной базы.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка деталей…</p>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}

          {!loading && !error && current ? (
            <>
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Статус</dt>
                <dd>
                  <RegStatusBadge status={current.status} />
                </dd>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="text-sm">
                  {formatEndpoint(current.ip, current.port)}
                </dd>
                <dt className="text-muted-foreground">Страна</dt>
                <dd>{current.country ?? "—"}</dd>
                <dt className="text-muted-foreground">Город</dt>
                <dd>{current.city ?? "—"}</dd>
                <dt className="text-muted-foreground">Оператор связи</dt>
                <dd>{current.isp ?? "—"}</dd>
                <dt className="text-muted-foreground">Изменение</dt>
                <dd>{formatTimestamp(current.lastChangedAt, timeZone)}</dd>
                <dt className="text-muted-foreground">Обновление</dt>
                <dd>{formatTimestamp(current.lastSeenAt, timeZone)}</dd>
              </dl>

              <Separator />

              <div className="space-y-3">
                <h3 className="text-sm font-medium">История изменений</h3>
                {detail.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Для этого номера событий изменений пока нет.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {detail.events.map((event) => (
                      <li
                        key={event.id}
                        className="rounded-md border border-border px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <RegStatusBadge
                            status={
                              event.newStatus === "Registered"
                                ? "Registered"
                                : "Unregistered"
                            }
                          />
                          <time className="text-xs text-muted-foreground">
                            {formatTimestamp(event.changedAt, timeZone)}
                          </time>
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {describeHistoryEvent(event)}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
