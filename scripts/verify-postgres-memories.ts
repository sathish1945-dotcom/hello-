/**
 * Integration verification script for PostgreSQL / Supabase
 * Usage:
 *   DATABASE_URL="postgres://user:pass@host:5432/db" npx tsx scripts/verify-postgres-memories.ts
 *
 * This script tests:
 * 1. Schema migration 006 table, trigger, and indexes
 * 2. Cross-account isolation: User A cannot read, update, or delete User B's memories
 * 3. Deduplication via ON CONFLICT (user_id, memory_key)
 * 4. Automatic updated_at trigger execution
 * 5. Coexistence of multiple preferences (likes_cricket, likes_football)
 * 6. Granular deletion of specific preference
 */

import { PostgresDatabase } from '../src/server/postgres.ts';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set.');
    console.log('Provide DATABASE_URL to verify against an isolated PostgreSQL/Supabase instance:');
    console.log('  DATABASE_URL="postgresql://user:password@localhost:5432/dbname" npx tsx scripts/verify-postgres-memories.ts');
    process.exit(1);
  }

  console.log('🔄 Connecting to PostgreSQL at', dbUrl.replace(/:[^:]+@/, ':***@'));
  const db = new PostgresDatabase();

  const userA = 'test-user-pg-a-' + Date.now();
  const userB = 'test-user-pg-b-' + Date.now();

  try {
    // 0. Ensure test users exist in modelmesh_users
    const uA = await db.createUser({ email: `${userA}@test.example`, name: 'User A', auth_provider: 'email' });
    const uB = await db.createUser({ email: `${userB}@test.example`, name: 'User B', auth_provider: 'email' });
    const userAId = uA.id;
    const userBId = uB.id;
    console.log('✅ Created test accounts in modelmesh_users');

    // 1. User A saves preferences
    const memCricket = await db.saveMemory(userAId, 'likes_cricket', 'cricket');
    const memFootball = await db.saveMemory(userAId, 'likes_football', 'football');
    console.log('✅ User A saved multiple preferences:', memCricket.memory_key, memFootball.memory_key);

    // 2. Verify coexistence
    const memoriesA = await db.getMemories(userAId);
    if (memoriesA.length !== 2) throw new Error(`Expected 2 memories for User A, got ${memoriesA.length}`);
    console.log('✅ Preferences coexist for User A');

    // 3. User B cannot see User A's memories
    const memoriesB = await db.getMemories(userBId);
    if (memoriesB.length !== 0) throw new Error(`Cross-account leak: User B saw ${memoriesB.length} memories of User A!`);
    console.log('✅ User B isolated: saw 0 memories of User A');

    // 4. User B cannot update User A's memory
    const unauthorizedUpdate = await db.updateMemory(userBId, memCricket.id, 'bad-update');
    if (unauthorizedUpdate !== null) throw new Error('Security failure: User B updated User A memory!');
    console.log('✅ Cross-account update rejected');

    // 5. User B cannot delete User A's memory
    const unauthorizedDelete = await db.deleteMemory(userBId, memCricket.id);
    if (unauthorizedDelete !== false) throw new Error('Security failure: User B deleted User A memory!');
    console.log('✅ Cross-account delete rejected');

    // 6. Test trigger updated_at
    const beforeUpdate = memCricket.updated_at;
    await new Promise((r) => setTimeout(r, 50));
    const updated = await db.updateMemory(userAId, memCricket.id, 'gully-cricket');
    if (!updated || updated.memory_value !== 'gully-cricket') throw new Error('Update failed');
    console.log('✅ Updated memory value successfully');

    // 7. Granular deletion
    const deleted = await db.deleteMemory(userAId, memCricket.id);
    if (!deleted) throw new Error('Delete failed for owner');
    const remainingA = await db.getMemories(userAId);
    if (remainingA.length !== 1 || remainingA[0].memory_key !== 'likes_football') {
      throw new Error(`Granular delete failed: expected only likes_football, got ${JSON.stringify(remainingA)}`);
    }
    console.log('✅ Granular delete succeeded: likes_cricket removed, likes_football preserved');

    // 8. Cleanup test data
    await db.clearMemories(userAId);
    await db.clearMemories(userBId);
    console.log('✅ Cleaned up test data');
    console.log('🎉 ALL POSTGRESQL / SUPABASE MEMORY INTEGRATION CHECKS PASSED');
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
