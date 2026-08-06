import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/modules/auth/guards";
import { getRegistrationDetail } from "@/modules/registrations/service";
import {
  describeHistoryEvent,
  formatEndpoint,
  formatTimestamp,
} from "@/modules/registrations/ui-format";
import { RegStatusBadge } from "@/modules/registrations/ui/reg-status-badge";

type Props = { params: Promise<{ phone: string }> };

export default async function RegistrationDetailPage({ params }: Props) {
  await requirePagePermission("regs:read");
  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "").trim();
  const detail = phone ? await getRegistrationDetail(phone) : null;

  if (!detail) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {phone || "Регистрация"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Регистрация не найдена в локальной базе.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/regs">К списку регистраций</Link>
        </Button>
      </div>
    );
  }

  const { current, events } = detail;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {current.phone}
          </h1>
          <p className="text-sm text-muted-foreground">
            Детали регистрации и история изменений.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/regs">К списку</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Текущее состояние</CardTitle>
          <CardDescription>
            Последние значения после успешных опросов регистраций.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Статус</dt>
              <dd className="mt-1">
                <RegStatusBadge status={current.status} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Endpoint</dt>
              <dd className="mt-1 font-mono">
                {formatEndpoint(current.ip, current.port)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Последнее изменение</dt>
              <dd className="mt-1">{formatTimestamp(current.lastChangedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Обновление</dt>
              <dd className="mt-1">{formatTimestamp(current.lastSeenAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">История изменений</CardTitle>
          <CardDescription>
            События записываются только при изменении статуса или endpoint
            (сначала новые).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Событий пока нет.</p>
          ) : (
            <ol className="space-y-3">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <RegStatusBadge
                      status={
                        event.newStatus === "Registered"
                          ? "Registered"
                          : "Unregistered"
                      }
                    />
                    <time className="text-xs text-muted-foreground">
                      {formatTimestamp(event.changedAt)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {describeHistoryEvent(event)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
