import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/server/db.ts';
import { isSensitiveContent } from '../src/server/friend-memories-service.ts';
import { FriendAgent } from '../src/services/friend-mode/FriendAgent.ts';

const userA = 'test-user-a';
const userB = 'test-user-b';

test('Persistent Friend Memories: saves and retrieves memory facts with authenticated ownership', async () => {
  await db.clearMemories(userA);
  await db.clearMemories(userB);

  const saved = await db.saveMemory(userA, 'name', 'Sathish');
  assert.ok(saved);
  assert.equal(saved.memory_key, 'name');
  assert.equal(saved.memory_value, 'Sathish');
  assert.equal(saved.user_id, userA);

  const memoriesA = await db.getMemories(userA);
  assert.equal(memoriesA.length, 1);
  assert.equal(memoriesA[0].memory_value, 'Sathish');

  // Strict account isolation: User B must not see User A's memories
  const memoriesB = await db.getMemories(userB);
  assert.equal(memoriesB.length, 0);
});

test('Persistent Friend Memories: deduplicates facts by key via upsert', async () => {
  await db.clearMemories(userA);

  await db.saveMemory(userA, 'likes', 'cricket');
  const updated = await db.saveMemory(userA, 'likes', 'football');

  const memories = await db.getMemories(userA);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].memory_value, 'football');
});

test('Persistent Friend Memories: updates memory value for owner and rejects unauthorized updates', async () => {
  await db.clearMemories(userA);
  await db.clearMemories(userB);

  const mem = await db.saveMemory(userA, 'city', 'Chennai');
  const updated = await db.updateMemory(userA, mem.id, 'Bangalore');
  assert.ok(updated);
  assert.equal(updated?.memory_value, 'Bangalore');

  // User B cannot update User A's memory
  const unauthorized = await db.updateMemory(userB, mem.id, 'Delhi');
  assert.equal(unauthorized, null);

  const check = await db.getMemoryByKey(userA, 'city');
  assert.equal(check?.memory_value, 'Bangalore');
});

test('Persistent Friend Memories: deletes memory for owner and isolates account deletions', async () => {
  await db.clearMemories(userA);
  await db.clearMemories(userB);

  const memA = await db.saveMemory(userA, 'hobby', 'chess');
  const memB = await db.saveMemory(userB, 'hobby', 'guitar');

  // User A cannot delete User B's memory
  const deletedByOther = await db.deleteMemory(userA, memB.id);
  assert.equal(deletedByOther, false);

  // User B's memory is intact
  const checkB = await db.getMemories(userB);
  assert.equal(checkB.length, 1);

  // User A deletes own memory
  const deletedOwn = await db.deleteMemory(userA, memA.id);
  assert.equal(deletedOwn, true);

  const checkA = await db.getMemories(userA);
  assert.equal(checkA.length, 0);
});

test('Persistent Friend Memories: clears all memories with confirmation and isolates accounts', async () => {
  await db.clearMemories(userA);
  await db.clearMemories(userB);

  await db.saveMemory(userA, 'k1', 'v1');
  await db.saveMemory(userA, 'k2', 'v2');
  await db.saveMemory(userB, 'kb1', 'vb1');

  await db.clearMemories(userA);

  assert.equal((await db.getMemories(userA)).length, 0);
  // User B's memories must not be affected
  assert.equal((await db.getMemories(userB)).length, 1);
});

test('Security Guard: detects and rejects sensitive passwords, keys, and credentials', () => {
  assert.equal(isSensitiveContent('my password is secret123'), true);
  assert.equal(isSensitiveContent('api_key: sk-proj-1234567890abcdef'), true);
  assert.equal(isSensitiveContent('auth_token: bearer eyJhbGciOi...'), true);
  assert.equal(isSensitiveContent('private_key is RSA...'), true);
  assert.equal(isSensitiveContent('my CVV is 123'), true);

  // Harmless facts must not trigger false positives
  assert.equal(isSensitiveContent('my name is Sathish'), false);
  assert.equal(isSensitiveContent('I like playing cricket on weekends'), false);
  assert.equal(isSensitiveContent('I live in Chennai'), false);
});

test('FriendAgent: returns exact greeting once per new session without consuming turn budget', () => {
  const agent = new FriendAgent();
  agent.clearHistory();

  const greeting = agent.getGreeting();
  assert.equal(greeting, "Hello is here, don't fear! Hi da macha!");

  // History remains clean (wake greeting does not consume turn budget)
  assert.equal(agent.getHistory().length, 0);

  // Repeated call in same session returns conversational check
  const secondGreeting = agent.getGreeting();
  assert.equal(secondGreeting, 'Hi da macha, sollu!');
});

test('FriendAgent: clarifies ambiguous "save this to memory"', async () => {
  const agent = new FriendAgent();
  agent.clearHistory();

  const reply1 = await agent.processMessage('Save this to memory');
  assert.ok(reply1.includes('Enna save pannanum nu sollu da macha?'));

  const reply2 = await agent.processMessage('save this');
  assert.ok(reply2.includes('Enna save pannanum nu sollu da macha?'));
});

test('FriendAgent: strictly rejects passwords and API keys in voice commands', async () => {
  const agent = new FriendAgent();
  agent.clearHistory();

  const reply = await agent.processMessage('Remember my password is superSecretPassword123');
  assert.ok(reply.includes('security reasons-kaga passwords or sensitive keys save panna maaten'));
  assert.equal(agent.getHistory().length, 0);
});

test('FriendAgent: handles "What is my name?" truthfully without inventing missing facts', async () => {
  const agent = new FriendAgent();
  agent.clearHistory();

  const reply = await agent.processMessage('What is my name?');
  assert.ok(reply.includes('Adhu enaku innum theriyadhu da macha'));
});

test('FriendAgent: enforces rolling maximum of 10 completed exchanges (20 messages) and char budget', async () => {
  const agent = new FriendAgent();
  agent.clearHistory();

  // Fill with 12 completed exchanges via ambiguous save (which records completed turns)
  for (let i = 1; i <= 12; i++) {
    await agent.processMessage('save this');
  }

  const history = agent.getHistory();
  // Maximum 10 exchanges = 20 messages
  assert.ok(history.length <= FriendAgent.MAX_EXCHANGES * 2);

  const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
  assert.ok(totalChars <= FriendAgent.MAX_CHAR_BUDGET);
});

test('Persistent Friend Memories: supports coexistence of multiple distinct preferences', async () => {
  await db.clearMemories(userA);

  await db.saveMemory(userA, 'likes_cricket', 'cricket');
  await db.saveMemory(userA, 'likes_football', 'football');

  const memories = await db.getMemories(userA);
  assert.equal(memories.length, 2);
  const keys = memories.map((m) => m.memory_key);
  assert.ok(keys.includes('likes_cricket'));
  assert.ok(keys.includes('likes_football'));
});

test('FriendAgent: handles saving multiple distinct preferences via voice commands', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  const mockStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: string) => mockStore.set(k, v),
    removeItem: (k: string) => mockStore.delete(k),
  };
  (globalThis as any).window = { localStorage: mockStorage };
  (globalThis as any).localStorage = mockStorage;
  mockStore.set('hello_auth_token', 'mock-token');

  const inMemorySaved: any[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes('/api/friend/memories') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      const newMem = {
        id: `mem-${inMemorySaved.length + 1}`,
        user_id: 'user-mock',
        memory_key: body.memory_key || body.key,
        memory_value: body.memory_value || body.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemorySaved.push(newMem);
      return new Response(JSON.stringify(newMem), { status: 201 });
    }
    if (url.includes('/api/friend/memories') && (!init || init.method === 'GET')) {
      return new Response(JSON.stringify({ memories: inMemorySaved }), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const agent = new FriendAgent();
    agent.clearHistory();

    const reply1 = await agent.processMessage('Remember that I like cricket');
    assert.ok(reply1.includes('You like cricket nu save pannitaen'));

    const reply2 = await agent.processMessage('Remember that I like football');
    assert.ok(reply2.includes('You like football nu save pannitaen'));

    assert.equal(inMemorySaved.length, 2);
    assert.equal(inMemorySaved[0].memory_key, 'likes_cricket');
    assert.equal(inMemorySaved[1].memory_key, 'likes_football');
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalLocalStorage;
  }
});

test('FriendAgent: granularly deletes specific preference without removing others', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  const mockStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: string) => mockStore.set(k, v),
    removeItem: (k: string) => mockStore.delete(k),
  };
  (globalThis as any).window = { localStorage: mockStorage };
  (globalThis as any).localStorage = mockStorage;
  mockStore.set('hello_auth_token', 'mock-token');

  let inMemorySaved = [
    { id: 'mem-1', user_id: 'user-mock', memory_key: 'likes_cricket', memory_value: 'cricket' },
    { id: 'mem-2', user_id: 'user-mock', memory_key: 'likes_football', memory_value: 'football' },
  ];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes('/api/friend/memories/mem-1') && init?.method === 'DELETE') {
      inMemorySaved = inMemorySaved.filter((m) => m.id !== 'mem-1');
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes('/api/friend/memories') && (!init || init.method === 'GET' || !init.method)) {
      return new Response(JSON.stringify({ memories: inMemorySaved }), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const agent = new FriendAgent();
    agent.clearHistory();

    const reply = await agent.processMessage('Forget that I like cricket');
    assert.ok(reply.includes("I've removed 'cricket' from memory"));

    assert.equal(inMemorySaved.length, 1);
    assert.equal(inMemorySaved[0].memory_key, 'likes_football');
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalLocalStorage;
  }
});

test('FriendAgent: reports failure without false confirmation when network save fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  const mockStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: string) => mockStore.set(k, v),
    removeItem: (k: string) => mockStore.delete(k),
  };
  (globalThis as any).window = { localStorage: mockStorage };
  (globalThis as any).localStorage = mockStorage;
  mockStore.set('hello_auth_token', 'mock-token');

  // Simulate network rejection / 500 error
  globalThis.fetch = async () => {
    return new Response('Internal Server Error', { status: 500 });
  };

  try {
    const agent = new FriendAgent();
    agent.clearHistory();

    const reply = await agent.processMessage('Remember that I like cricket');
    assert.ok(reply.includes('Sorry da macha, memory save panna mudiyala'));
    assert.equal(reply.includes('save pannitaen'), false);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalLocalStorage;
  }
});
