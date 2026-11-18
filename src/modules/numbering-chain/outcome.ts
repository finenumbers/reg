export const CHAIN_BUSY_RETRY = "Уже выполняется.";
export const CHAIN_VACUUM = "Идёт сжатие базы. Повторите, когда оно закончится.";
export const CHAIN_STOPPING = "Сервер останавливается. Каталог не изменён.";
export const CHAIN_CANCELLED = "Загрузка отменена. Каталог не изменён.";

const SKIP = new Set([
  "Ключ ещё не задан.",
  "Ключ не читается.",
  "Пароль ещё не задан.",
  "Email ещё не задан.",
  "Пароль не читается.",
  "Ссылки ещё не указаны.",
  "Ссылка не читается.",
]);

type StartClass = "retry" | "skip" | "stop" | "next";

export function classifyStart(error: string): StartClass {
  if (error === CHAIN_BUSY_RETRY || error === CHAIN_VACUUM) return "retry";
  if (error === CHAIN_STOPPING) return "stop";
  if (SKIP.has(error)) return "skip";
  return "next";
}

type FinishClass = "ok" | "next" | "stop";

export function classifyFinish(input: {
  beforeFinishedAt: number | null;
  afterFinishedAt: number | null;
  lastError: string | null;
  stopping: boolean;
}): FinishClass {
  if (input.stopping) return "stop";
  if (input.beforeFinishedAt === input.afterFinishedAt) return "next";
  if (input.lastError === CHAIN_CANCELLED) return "stop";
  if (input.lastError) return "next";
  return "ok";
}
