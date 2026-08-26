import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  return drizzle(neon(databaseUrl), { schema });
}

let database: ReturnType<typeof createDb> | undefined;

export function getDb() {
  database ??= createDb();
  return database;
}

export { schema };
