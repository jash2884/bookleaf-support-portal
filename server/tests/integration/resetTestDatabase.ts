import type { PrismaClient } from "@prisma/client";

/** Empties every application table in the *_test database so each run starts clean. */
export async function resetTestDatabase(prisma: PrismaClient) {
  const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to clear non-test database "${dbName}"`);

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
