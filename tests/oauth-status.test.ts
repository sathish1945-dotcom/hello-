import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasNewOAuthConnection } from '../src/lib/oauth-status.ts';

test('polling ignores old connections, disconnected accounts and missing attempts', () => {
  const updatedAt = '2026-10-11T10:00:00Z';
  assert.equal(hasNewOAuthConnection({ connected: true, updatedAt }, null), false);
  assert.equal(hasNewOAuthConnection({ connected: true, updatedAt }, { previousUpdatedAt: updatedAt, createdAt: 0 }), false);
  assert.equal(hasNewOAuthConnection({ connected: false, updatedAt }, { previousUpdatedAt: null, createdAt: 0 }), false);
  assert.equal(hasNewOAuthConnection({ connected: true }, { previousUpdatedAt: null, createdAt: 0 }), false);
});

test('polling accepts newly persisted credentials and handles older attempts conservatively', () => {
  const updatedAt = '2026-10-11T10:00:00Z';
  assert.equal(hasNewOAuthConnection({ connected: true, updatedAt }, { previousUpdatedAt: null, createdAt: 0 }), true);
  assert.equal(hasNewOAuthConnection({ connected: true, updatedAt }, { previousUpdatedAt: 'old', createdAt: 0 }), true);
  assert.equal(hasNewOAuthConnection({ connected: true, updatedAt }, { createdAt: Date.parse(updatedAt) + 1 }), false);
  assert.equal(hasNewOAuthConnection({ connected: true, updatedAt }, { createdAt: Date.parse(updatedAt) - 1 }), true);
});
