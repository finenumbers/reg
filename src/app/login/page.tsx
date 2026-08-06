import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="space-y-6">
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Softswitch Ops
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Reg Platform</h1>
        </div>
        <Suspense
          fallback={
            <p className="text-center text-sm text-muted-foreground">Загрузка…</p>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
