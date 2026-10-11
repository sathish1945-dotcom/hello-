/**
 * Test the live running matching backend (http://127.0.0.1:3000)
 * Validates:
 * 1. Health & Config endpoint
 * 2. User A registration & authentication
 * 3. Saving multiple preferences (likes_cricket, likes_football)
 * 4. User B registration & authentication
 * 5. Strict account isolation (User B sees 0 memories)
 * 6. Cross-account update & delete rejections
 * 7. Granular update and deletion
 * 8. Confirmed Clear All
 */

const BASE_URL = process.env.TEST_BACKEND_URL || 'http://127.0.0.1:3000';

async function run() {
  console.log(`🔍 Testing matching backend at ${BASE_URL}...`);

  // 1. Config check
  const configRes = await fetch(`${BASE_URL}/api/config`);
  if (!configRes.ok) throw new Error(`Config failed: ${configRes.status}`);
  const config = await configRes.json();
  console.log('✅ Live backend responded with config:', config.appName);

  // 2. Register User A
  const emailA = `test-a-${Date.now()}@example.com`;
  const regARes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailA, password: 'password123', name: 'User A' }),
  });
  if (!regARes.ok) throw new Error(`User A registration failed: ${regARes.status}`);
  const cookieA = regARes.headers.get('set-cookie')!.split(';')[0];
  const userA = (await regARes.json()).user;
  console.log('✅ Registered User A:', userA.email);

  // 3. User A saves preferences
  const save1Res = await fetch(`${BASE_URL}/api/friend/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ memory_key: 'likes_cricket', memory_value: 'cricket' }),
  });
  if (save1Res.status !== 201) throw new Error(`Save 1 failed: ${save1Res.status}`);
  const mem1 = (await save1Res.json()).memory;
  console.log('✅ Saved preference 1:', mem1.memory_key, 'id:', mem1.id);

  const save2Res = await fetch(`${BASE_URL}/api/friend/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ memory_key: 'likes_football', memory_value: 'football' }),
  });
  if (save2Res.status !== 201) throw new Error(`Save 2 failed: ${save2Res.status}`);
  const mem2 = (await save2Res.json()).memory;
  console.log('✅ Saved preference 2:', mem2.memory_key, 'id:', mem2.id);

  // 4. Verify User A has 2 memories
  const listARes = await fetch(`${BASE_URL}/api/friend/memories`, {
    headers: { Cookie: cookieA },
  });
  const listA = await listARes.json();
  if (listA.memories?.length !== 2) throw new Error(`Expected 2 memories for User A, got ${listA.memories?.length}`);
  console.log('✅ User A has 2 coexisting memories');

  // 5. Register User B
  const emailB = `test-b-${Date.now()}@example.com`;
  const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailB, password: 'password123', name: 'User B' }),
  });
  if (!regBRes.ok) throw new Error(`User B registration failed: ${regBRes.status}`);
  const cookieB = regBRes.headers.get('set-cookie')!.split(';')[0];
  console.log('✅ Registered User B');

  // 6. User B sees 0 memories (Strict account isolation)
  const listBRes = await fetch(`${BASE_URL}/api/friend/memories`, {
    headers: { Cookie: cookieB },
  });
  const listB = await listBRes.json();
  if (listB.memories?.length !== 0) throw new Error(`Cross-account leak: User B saw ${listB.memories?.length} memories!`);
  console.log('✅ Account isolation verified: User B sees 0 memories');

  // 7. User B cannot update User A's memory
  const unauthorizedUpdateRes = await fetch(`${BASE_URL}/api/friend/memories/${mem1.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieB },
    body: JSON.stringify({ memory_value: 'hacked' }),
  });
  if (unauthorizedUpdateRes.status !== 404 && unauthorizedUpdateRes.status !== 403) {
    throw new Error(`Security failure: User B update status was ${unauthorizedUpdateRes.status}`);
  }
  console.log('✅ Unauthorized update correctly rejected');

  // 8. User B cannot delete User A's memory
  const unauthorizedDeleteRes = await fetch(`${BASE_URL}/api/friend/memories/${mem1.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieB },
  });
  if (unauthorizedDeleteRes.status !== 404 && unauthorizedDeleteRes.status !== 403) {
    throw new Error(`Security failure: User B delete status was ${unauthorizedDeleteRes.status}`);
  }
  console.log('✅ Unauthorized delete correctly rejected');

  // 9. User A updates memory
  const updateARes = await fetch(`${BASE_URL}/api/friend/memories/${mem1.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ memory_value: 'gully_cricket' }),
  });
  if (!updateARes.ok) throw new Error(`Update failed: ${updateARes.status}`);
  console.log('✅ User A updated memory successfully');

  // 10. User A granularly deletes one preference
  const deleteARes = await fetch(`${BASE_URL}/api/friend/memories/${mem1.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieA },
  });
  if (!deleteARes.ok) throw new Error(`Delete failed: ${deleteARes.status}`);
  const listAfterDel = await (await fetch(`${BASE_URL}/api/friend/memories`, { headers: { Cookie: cookieA } })).json();
  if (listAfterDel.memories?.length !== 1 || listAfterDel.memories[0].memory_key !== 'likes_football') {
    throw new Error('Granular delete failed');
  }
  console.log('✅ Granular delete succeeded: likes_cricket removed, likes_football preserved');

  // 11. User A confirmed Clear All
  const clearRes = await fetch(`${BASE_URL}/api/friend/memories`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ confirmed: true }),
  });
  if (!clearRes.ok) throw new Error(`Clear failed: ${clearRes.status}`);
  const listAfterClear = await (await fetch(`${BASE_URL}/api/friend/memories`, { headers: { Cookie: cookieA } })).json();
  if (listAfterClear.memories?.length !== 0) throw new Error('Clear all failed');
  console.log('✅ Confirmed Clear All succeeded');

  console.log('\n🎉 ALL LIVE MATCHING BACKEND INTEGRATION CHECKS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
