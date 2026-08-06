import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/40 p-6">
      <div className="max-w-md space-y-2 text-center">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Доступ запрещён
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Нет прав</h1>
        <p className="text-sm text-muted-foreground">
          Вы вошли в систему, но у вашей учётной записи нет прав на этот раздел.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link href="/phones">К телефонным номерам</Link>
      </Button>
    </div>
  );
}
