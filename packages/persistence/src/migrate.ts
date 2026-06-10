import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Applies SQL migrations in filename order. Idempotent (files use IF NOT EXISTS). */
export async function applyMigrations(pool: Pool): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }
}
