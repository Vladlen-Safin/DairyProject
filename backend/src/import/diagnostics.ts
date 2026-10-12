import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type Details = Record<string, unknown>;
const context = new AsyncLocalStorage<Details>();

export function withImportDiagnostics<T>(fn: () => T): T {
  return context.run({ requestId: randomUUID() }, fn);
}

export function setImportMessage(messageno: string): void {
  const current = context.getStore();
  if (current) current.messageno = messageno;
}

export function importLog(stage: string, details: Details = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), scope: "importxml", ...context.getStore(), stage, ...details }));
}

// Do not dump XML, SQL parameters, credentials, or raw database errors into logs.
export function importError(error: unknown): Details {
  const e = error as { name?: unknown; code?: unknown; stack?: unknown } | null;
  return {
    errorType: typeof e?.name === "string" ? e.name : "UnknownError",
    errorCode: typeof e?.code === "string" || typeof e?.code === "number" ? e.code : undefined,
    stack: typeof e?.stack === "string" ? e.stack.split("\n").filter(line => /^\s+at /.test(line)).slice(0, 8) : undefined,
  };
}

export async function importStep<T>(stage: string, fn: () => T | Promise<T>, details: Details = {}): Promise<T> {
  const started = Date.now();
  importLog(stage, { ...details, status: "START" });
  const timer = setInterval(() => importLog(stage, { ...details, status: "WAIT", elapsedMs: Date.now() - started }), 15000);
  timer.unref();
  try {
    const result = await fn();
    importLog(stage, { ...details, status: "OK", elapsedMs: Date.now() - started });
    return result;
  } catch (error) {
    importLog(stage, { ...details, status: "ERROR", elapsedMs: Date.now() - started, ...importError(error) });
    throw error;
  } finally {
    clearInterval(timer);
  }
}
