import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="space-y-6">
        <div className="flex justify-center">
          <img
            src="/brand/logo-full.png"
            alt="fine numbers"
            className="h-12 w-auto max-w-full bg-transparent object-contain"
          />
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
