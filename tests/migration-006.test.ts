import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Migration 006: Schema migration script validity and security constraints', () => {
  const migrationPath = path.resolve(process.cwd(), 'migrations/006_friend_memories.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration 006 file must exist');

  const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

  // 1. Table creation with correct schema
  assert.match(sqlContent, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+friend_memories/i);
  assert.match(sqlContent, /id\s+TEXT\s+PRIMARY\s+KEY/i);
  assert.match(sqlContent, /user_id\s+TEXT\s+NOT\s+NULL/i);
  assert.match(sqlContent, /memory_key\s+VARCHAR\(100\)\s+NOT\s+NULL/i);
  assert.match(sqlContent, /memory_value\s+VARCHAR\(500\)\s+NOT\s+NULL/i);
  assert.match(sqlContent, /created_at\s+TIMESTAMPTZ/i);
  assert.match(sqlContent, /updated_at\s+TIMESTAMPTZ/i);

  // 2. Foreign Key referencing modelmesh_users with CASCADE delete
  assert.match(sqlContent, /REFERENCES\s+modelmesh_users\(id\)\s+ON\s+DELETE\s+CASCADE/i);

  // 3. Unique constraint for key deduplication per user
  assert.match(sqlContent, /CONSTRAINT\s+uq_friend_memories_user_key\s+UNIQUE\s*\(\s*user_id\s*,\s*memory_key\s*\)/i);

  // 4. Performance Indexes
  assert.match(sqlContent, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_friend_memories_user_id\s+ON\s+friend_memories\s*\(\s*user_id\s*\)/i);
  assert.match(sqlContent, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_friend_memories_updated_at\s+ON\s+friend_memories\s*\(\s*updated_at\s*\)/i);

  // 5. Automatic updated_at trigger definition
  assert.match(sqlContent, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+set_updated_at_timestamp/i);
  assert.match(sqlContent, /CREATE\s+TRIGGER\s+trg_friend_memories_updated_at/i);
  assert.match(sqlContent, /BEFORE\s+UPDATE\s+ON\s+friend_memories/i);

  // 6. Strict RLS and Security Access Control
  assert.match(sqlContent, /ALTER\s+TABLE\s+friend_memories\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.match(sqlContent, /REVOKE\s+ALL\s+ON\s+friend_memories\s+FROM\s+anon\s*,\s*authenticated/i);
  assert.match(sqlContent, /GRANT\s+ALL\s+ON\s+friend_memories\s+TO\s+service_role/i);
});

test('Migration 006: Schema compatibility with Migration 001 modelmesh_users', () => {
  const initMigrationPath = path.resolve(process.cwd(), 'migrations/001_initial_schema.sql');
  assert.ok(fs.existsSync(initMigrationPath), 'Migration 001 must exist');

  const initSql = fs.readFileSync(initMigrationPath, 'utf-8');

  // Verify modelmesh_users primary key is TEXT
  assert.match(initSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+modelmesh_users\s*\(\s*id\s+TEXT\s+PRIMARY\s+KEY/i);
});
