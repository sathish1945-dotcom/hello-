import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isAdminUser,
  requireAdmin,
  isValidDestinationUrl,
  handleAdminListTasks,
  handleAdminCreateTask,
  handleAdminUpdateTask,
  handleAdminDeleteTask,
  handleAdminListPromotions,
  handleAdminCreatePromotion,
  handleAdminUpdatePromotion,
  handleAdminDeletePromotion,
  handleAdminGetEmergencySwitch,
  handleAdminToggleEmergencySwitch,
  handleAdminGetAuditLogs,
  handleUserGetActiveTasks,
  handleUserInteractTask,
  handleUserGetActivePromotions,
  handleUserSetSpokenPromotionConsent,
} from '../src/server/admin-service.ts';

// Helper mock request/response factories
function mockReq(user: any = null, body: any = {}, params: any = {}, query: any = {}) {
  return {
    user,
    body,
    params,
    query,
  } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

test('1. Server-side role verification for Sathish / Admin (No hardcoded email bypass)', () => {
  // Admin by explicit server-verified role
  assert.equal(isAdminUser({ id: 'admin-uuid-1', email: 'sathish@example.com', role: 'admin' }), true);

  // Unauthenticated users rejected
  assert.equal(isAdminUser(null), false);
  assert.equal(isAdminUser(undefined), false);

  // Normal users rejected even if email matches a name pattern
  assert.equal(isAdminUser({ id: 'user-uuid-2', email: 'sathish1945@gmail.com', role: 'user' }), false);
  assert.equal(isAdminUser({ id: 'user-uuid-3', email: 'random.user@gmail.com', role: 'user' }), false);

  // Explicitly provisioned admin ID via environment variable
  process.env.ADMIN_USER_IDS = 'provisioned-sathish-id,another-admin-id';
  assert.equal(isAdminUser({ id: 'provisioned-sathish-id', email: 'sathish@custom.com' }), true);
  assert.equal(isAdminUser({ id: 'unprovisioned-id', email: 'attacker@evil.com' }), false);
  delete process.env.ADMIN_USER_IDS;
});

test('2. Attempted role escalation via request body is strictly blocked by requireAdmin', () => {
  let nextCalled = false;
  const res = mockRes();

  // Attacker tries to inject { role: 'admin' } in body while authenticated as normal user
  const reqAttacker = mockReq(
    { id: 'normal-user-1', email: 'normal@hello.app', role: 'user' },
    { role: 'admin', is_admin: true }
  );

  requireAdmin(reqAttacker, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'requireAdmin must not call next() for non-admin');
  assert.equal(res.statusCode, 403, 'Must return HTTP 403 Forbidden');
  assert.equal(res.data.code, 'ADMIN_ACCESS_REQUIRED');
});

test('3. URL safety validation prevents unsafe schemes (javascript:, file:, data:)', () => {
  // Safe HTTP/HTTPS
  assert.equal(isValidDestinationUrl('https://example.com/daily-vocab'), true);
  assert.equal(isValidDestinationUrl('http://my-partner.org/course'), true);
  assert.equal(isValidDestinationUrl(''), true); // Optional URLs allowed empty

  // Malicious / Unsafe schemes
  assert.equal(isValidDestinationUrl('javascript:alert(1)'), false);
  assert.equal(isValidDestinationUrl('file:///etc/passwd'), false);
  assert.equal(isValidDestinationUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isValidDestinationUrl('vbscript:msgbox(1)'), false);
  assert.equal(isValidDestinationUrl('not-a-valid-url'), false);
});

test('4. Daily Tasks lifecycle: create, list, pause, update, delete with audit trail', async () => {
  const admin = { id: 'admin-1', email: 'admin@hello.app', role: 'admin' };

  // Create Task
  const reqCreate = mockReq(admin, {
    title: 'Daily Tamil Proverb Analysis',
    description: 'Learn one Sangam Tamil proverb and its modern meaning.',
    language: 'ta',
    status: 'published',
    link: 'https://tamilliterature.org/proverb/1',
    allow_participation: true,
    allow_dismiss: true,
    allow_reminder: true,
    spoken_reminder_text: 'Macha, ready to review today\'s Tamil proverb?',
  });
  const resCreate = mockRes();
  await handleAdminCreateTask(reqCreate, resCreate, () => {});

  assert.equal(resCreate.statusCode, 201);
  assert.ok(resCreate.data.task);
  const taskId = resCreate.data.task.id;
  assert.equal(resCreate.data.task.title, 'Daily Tamil Proverb Analysis');

  // List Tasks
  const resList = mockRes();
  await handleAdminListTasks(mockReq(admin), resList, () => {});
  assert.equal(resList.statusCode, 200);
  assert.ok(resList.data.tasks.some((t: any) => t.id === taskId));

  // Update Status to Paused
  const reqUpdate = mockReq(admin, { status: 'paused' }, { id: taskId });
  const resUpdate = mockRes();
  await handleAdminUpdateTask(reqUpdate, resUpdate, () => {});
  assert.equal(resUpdate.statusCode, 200);
  assert.equal(resUpdate.data.task.status, 'paused');

  // Verify Audit Log was recorded
  const resAudit = mockRes();
  await handleAdminGetAuditLogs(mockReq(admin), resAudit, () => {});
  assert.equal(resAudit.statusCode, 200);
  assert.ok(resAudit.data.logs.some((l: any) => l.target_id === taskId && l.target_type === 'task'));

  // Delete Task
  const reqDelete = mockReq(admin, {}, { id: taskId });
  const resDelete = mockRes();
  await handleAdminDeleteTask(reqDelete, resDelete, () => {});
  assert.equal(resDelete.statusCode, 200);
  assert.equal(resDelete.data.success, true);
});

test('5. Spoken promotions are DISABLED BY DEFAULT and require explicit opt-in', async () => {
  const admin = { id: 'admin-1', email: 'admin@hello.app', role: 'admin' };
  const user = { id: 'user-consent-tester', email: 'user@example.com' };

  // Create an approved spoken promo
  const resPromo = mockRes();
  await handleAdminCreatePromotion(
    mockReq(admin, {
      title: 'Vocabulary Masterclass',
      destination_url: 'https://vocab.partner.org',
      label: 'Sponsored',
      format: 'both',
      status: 'approved',
      spoken_text: 'Sponsored: Try today\'s 5-minute vocabulary booster.',
    }),
    resPromo,
    () => {}
  );
  const promoId = resPromo.data.promotion.id;

  // 1. DEFAULT STATE: user has not opted in -> spoken_text MUST BE UNDEFINED
  const resActiveDefault = mockRes();
  await handleUserGetActivePromotions(mockReq(user), resActiveDefault, () => {});
  const promoDefault = resActiveDefault.data.promotions.find((p: any) => p.id === promoId);
  assert.equal(promoDefault.spoken_text, undefined, 'Spoken promotions must be DISABLED BY DEFAULT');
  assert.equal(resActiveDefault.data.user_opted_in_spoken, false);

  // 2. EXPLICIT OPT-IN: user explicitly consents to spoken promotions
  const resOptIn = mockRes();
  await handleUserSetSpokenPromotionConsent(mockReq(user, { opt_in: true }), resOptIn, () => {});
  assert.equal(resOptIn.data.user_opted_in_spoken, true);

  // 3. AFTER OPT-IN: spoken_text is delivered
  const resActiveOptedIn = mockRes();
  await handleUserGetActivePromotions(mockReq(user), resActiveOptedIn, () => {});
  const promoOptedIn = resActiveOptedIn.data.promotions.find((p: any) => p.id === promoId);
  assert.equal(promoOptedIn.spoken_text, 'Sponsored: Try today\'s 5-minute vocabulary booster.');

  // 4. REVOCATION: user opts out -> immediately disabled again
  await handleUserSetSpokenPromotionConsent(mockReq(user, { opt_in: false }), mockRes(), () => {});
  const resActiveRevoked = mockRes();
  await handleUserGetActivePromotions(mockReq(user), resActiveRevoked, () => {});
  const promoRevoked = resActiveRevoked.data.promotions.find((p: any) => p.id === promoId);
  assert.equal(promoRevoked.spoken_text, undefined, 'Must immediately revoke spoken promotion audio on opt-out');

  // Clean up
  await handleAdminDeletePromotion(mockReq(admin, {}, { id: promoId }), mockRes(), () => {});
});

test('6. Emergency Killswitch immediately halts active public campaigns', async () => {
  const admin = { id: 'admin-1', email: 'admin@hello.app', role: 'admin' };

  // 1. Create a published task
  const resTask = mockRes();
  await handleAdminCreateTask(
    mockReq(admin, { title: 'Active Killswitch Task', description: 'Desc', status: 'published' }),
    resTask,
    () => {}
  );
  const taskId = resTask.data.task.id;

  // 2. Engage Emergency Killswitch
  const resSwitch = mockRes();
  await handleAdminToggleEmergencySwitch(
    mockReq(admin, { disabled: true, reason: 'Security anomaly detection' }),
    resSwitch,
    () => {}
  );
  assert.equal(resSwitch.data.switch.campaigns_disabled, true);

  // 3. Public endpoints immediately return empty arrays []
  const resPublicTasks = mockRes();
  await handleUserGetActiveTasks(mockReq({ id: 'user-1' }), resPublicTasks, () => {});
  assert.deepEqual(resPublicTasks.data.tasks, []);

  // 4. Disengage switch
  await handleAdminToggleEmergencySwitch(mockReq(admin, { disabled: false }), mockRes(), () => {});

  // Clean up
  await handleAdminDeleteTask(mockReq(admin, {}, { id: taskId }), mockRes(), () => {});
});

test('7. Migration 007 durable storage schema and tamper protection validation', () => {
  const migrationPath = path.resolve(process.cwd(), 'migrations/007_admin_tasks_promotions.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration 007 file must exist');

  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify durable table creation
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS admin_daily_tasks'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS admin_promotions'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS user_task_interactions'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS user_promotion_preferences'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS admin_audit_logs'));

  // Verify mandatory label constraint
  assert.ok(sql.includes("label IN ('Sponsored', 'Advertisement')"));

  // Verify genuine tamper protection: append-only trigger forbidding UPDATE or DELETE
  assert.ok(sql.includes('prevent_audit_log_alteration()'));
  assert.ok(sql.includes('BEFORE UPDATE OR DELETE ON admin_audit_logs'));
  assert.ok(sql.includes("RAISE EXCEPTION 'admin_audit_logs is strictly append-only"));

  // Verify RLS enablement
  assert.ok(sql.includes('ALTER TABLE admin_daily_tasks ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE admin_promotions ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE user_promotion_preferences ENABLE ROW LEVEL SECURITY'));
});

test('8. Restart persistence: tasks, promotions, preferences and audit survive process restart', async () => {
  const { LocalDatabase } = await import('../src/server/db.ts');

  // Instance 1: Create entities
  const db1 = new LocalDatabase();
  const testTaskId = 'restart-task-' + Date.now();
  const testPromoId = 'restart-promo-' + Date.now();
  const testUserId = 'restart-user-' + Date.now();

  await db1.saveAdminTask({
    id: testTaskId,
    created_by: 'admin-restart-test',
    title: 'Persistence Test Task',
    description: 'Verifies data survives simulated backend process restarts',
    language: 'ta',
    status: 'published',
    allow_participation: true,
    allow_dismiss: true,
    allow_reminder: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await db1.saveAdminPromotion({
    id: testPromoId,
    created_by: 'admin-restart-test',
    title: 'Persistence Test Promo',
    description: 'Verifies promo persistence',
    label: 'Sponsored',
    destination_url: 'https://example.com/promo',
    format: 'card',
    status: 'approved',
    max_frequency_per_day: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await db1.setUserPromotionPreference(testUserId, true);
  await db1.setUserTaskInteraction(testUserId, testTaskId, 'completed', true);
  await db1.recordAdminAudit({
    id: 'audit-' + Date.now(),
    actor_id: 'admin-restart-test',
    actor_email: 'admin@hello.app',
    action: 'test_persistence',
    target_id: testTaskId,
    target_type: 'task',
    timestamp: new Date().toISOString(),
  });

  // Instance 2: Simulates brand new process startup reading from durable store
  const db2 = new LocalDatabase();
  const tasksAfterRestart = await db2.getAdminTasks();
  const savedTask = tasksAfterRestart.find((t) => t.id === testTaskId);
  assert.ok(savedTask, 'Task must persist across process restart');
  assert.equal(savedTask.title, 'Persistence Test Task');

  const promosAfterRestart = await db2.getAdminPromotions();
  const savedPromo = promosAfterRestart.find((p) => p.id === testPromoId);
  assert.ok(savedPromo, 'Promotion must persist across process restart');
  assert.equal(savedPromo.label, 'Sponsored');

  const userPref = await db2.getUserPromotionPreference(testUserId);
  assert.equal(userPref, true, 'User opt-in consent must persist across process restart');

  const userInteraction = await db2.getUserTaskInteraction(testUserId, testTaskId);
  assert.ok(userInteraction, 'User interaction must persist across restart');
  assert.equal(userInteraction.status, 'completed');
  assert.equal(userInteraction.reminder_enabled, true);

  const auditLogs = await db2.getAdminAuditLogs();
  assert.ok(auditLogs.some((l) => l.target_id === testTaskId), 'Audit log must persist across restart');

  // Clean up
  await db2.deleteAdminTask(testTaskId);
  await db2.deleteAdminPromotion(testPromoId);
});

test('9. Multi-instance backend statelessness: concurrent instances read identical durable state', async () => {
  const { LocalDatabase } = await import('../src/server/db.ts');

  const instanceA = new LocalDatabase();
  const instanceB = new LocalDatabase();

  const multiTaskId = 'multi-instance-task-' + Date.now();
  await instanceA.saveAdminTask({
    id: multiTaskId,
    created_by: 'admin-multi',
    title: 'Stateless Multi-Instance Task',
    description: 'Written by instance A, read by instance B',
    language: 'all',
    status: 'draft',
    allow_participation: true,
    allow_dismiss: true,
    allow_reminder: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Re-read on instance B by querying durable store
  const freshInstanceB = new LocalDatabase();
  const tasksFromB = await freshInstanceB.getAdminTasks();
  const foundTask = tasksFromB.find((t) => t.id === multiTaskId);
  assert.ok(foundTask, 'Instance B must observe writes committed by Instance A');
  assert.equal(foundTask.title, 'Stateless Multi-Instance Task');

  // Clean up
  await freshInstanceB.deleteAdminTask(multiTaskId);
});
