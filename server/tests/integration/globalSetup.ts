import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";

/**
 * Prepares the dedicated integration-test database:
 * creates it if missing, then applies migrations with `migrate deploy`
 * (non-destructive). Each suite clears its own tables — see resetTestDatabase().
 */
export default async function setup(project: TestProject) {
  const url = new URL(project.config.env.DATABASE_URL as string);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Integration tests only run against a *_test database (got "${dbName}")`);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const rows = await admin.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS "exists"`;
    if (!rows[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url.toString() } });
}
