import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

function createNeonDb(databaseUrl: string) {
  return drizzleNeon(neon(databaseUrl), { schema });
}

type AppDatabase = ReturnType<typeof createNeonDb>;

let localClient: ReturnType<typeof postgres> | undefined;

export function isLocalDatabaseUrl(databaseUrl: string) {
  try {
    const hostname = new URL(databaseUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function localDatabasePoolSize(value = process.env.LOCAL_DATABASE_POOL_SIZE) {
  const parsed = Number(value ?? 5);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.floor(parsed))) : 5;
}

function createDb(): AppDatabase {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (isLocalDatabaseUrl(databaseUrl)) {
    localClient ??= postgres(databaseUrl, {
      max: localDatabasePoolSize(),
      connect_timeout: 10,
      idle_timeout: 30,
      prepare: false,
    });
    // The application uses the common Drizzle relational/query API. Keeping a
    // single exported type avoids spreading a driver union through repositories.
    return drizzlePostgres(localClient, { schema }) as unknown as AppDatabase;
  }

  return createNeonDb(databaseUrl);
}

let database: ReturnType<typeof createDb> | undefined;

const transientDatabaseCodes = new Set([
  "UNAVAILABLE",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  let current = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return chain;
}

export function isTransientDatabaseError(error: unknown) {
  return errorChain(error).some((entry) => {
    const code = typeof entry === "object" && entry && "code" in entry
      ? String((entry as { code?: unknown }).code ?? "").toUpperCase()
      : "";
    if (transientDatabaseCodes.has(code)) return true;
    const message = entry instanceof Error ? entry.message : String(entry);
    return /fetch failed|connection (?:closed|reset|terminated)|socket hang up|network error|timed? ?out|\b(?:502|503|504)\b|temporarily unavailable/i.test(message);
  });
}

export function isDatabaseQuotaExceededError(error: unknown) {
  return errorChain(error).some((entry) => {
    const message = entry instanceof Error ? entry.message : String(entry);
    return /data transfer quota|exceeded (?:the )?.*quota|server error \(http status 402\)/i.test(message);
  });
}

export class DatabaseUnavailableError extends Error {
  readonly code = "DATABASE_UNAVAILABLE";

  constructor(cause: unknown) {
    super("データベースへ一時的に接続できません。数秒後にもう一度実行してください。", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

export class DatabaseQuotaExceededError extends Error {
  readonly code = "DATABASE_QUOTA_EXCEEDED";

  constructor(cause: unknown) {
    super("データベースのデータ転送量上限に達しています。Neonの上限更新またはDB接続先の変更が必要です。", { cause });
    this.name = "DatabaseQuotaExceededError";
  }
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
) {
  const attempts = Math.max(1, Math.min(5, options.attempts ?? 3));
  const delayMs = Math.max(0, options.delayMs ?? 250);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isDatabaseQuotaExceededError(error)) throw new DatabaseQuotaExceededError(error);
      if (!isTransientDatabaseError(error)) throw error;
      lastError = error;
      if (attempt + 1 < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (2 ** attempt)));
      }
    }
  }
  throw new DatabaseUnavailableError(lastError);
}

export function getDb() {
  database ??= createDb();
  return database;
}

export async function closeDatabase() {
  const client = localClient;
  localClient = undefined;
  database = undefined;
  if (client) await client.end({ timeout: 5 });
}

export function databaseResultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}

export function databaseProviderName() {
  return isLocalDatabaseUrl(process.env.DATABASE_URL ?? "")
    ? "Local PostgreSQL"
    : "Neon Postgres";
}

export { schema };
