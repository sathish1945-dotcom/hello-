import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateBackupCommands, validateMigrationsIntegrity } from '../scripts/test-backup-restore-postgres.ts';

test('1. PostgreSQL Backup & Restore: commands contain transaction safety and custom archive flags', () => {
  const config = {
    databaseUrl: 'postgresql://postgres:secret@127.0.0.1:5432/hello_ai',
    backupDir: path.resolve(process.cwd(), 'backups'),
    timestamp: '20261011_test',
  };

  const commands = generateBackupCommands(config);
  assert.ok(commands.dumpCommand.includes('--format=custom'), 'Must use custom archive format for compressed portable dump');
  assert.ok(commands.schemaDumpCommand.includes('--schema-only'), 'Must support schema-only extraction for migration audit');
  assert.ok(commands.restoreCommand.includes('--clean'), 'Must clean existing objects prior to restore');
  assert.ok(commands.restoreCommand.includes('--single-transaction'), 'Restore must execute in a single transaction to prevent partial state on failure');
});

test('2. Reviewed Migrations: all required database migrations 001 through 007 exist and are non-empty', () => {
  const { migrationCount, migrations } = validateMigrationsIntegrity();
  assert.ok(migrationCount >= 7);
  assert.ok(migrations.includes('006_friend_memories.sql'));
  assert.ok(migrations.includes('007_admin_tasks_promotions.sql'));
});
