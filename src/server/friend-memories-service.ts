import type { Request, Response } from 'express';
import { db } from './db.ts';

const SENSITIVE_KEYWORDS = [
  /\bpassword\b/i,
  /\bpwd\b/i,
  /\bpasscode\b/i,
  /\bapi[_\s-]?key\b/i,
  /\bsecret[_\s-]?key\b/i,
  /\bauth[_\s-]?token\b/i,
  /\bbearer\s+[a-z0-9_\-\.]{10,}/i,
  /\bprivate[_\s-]?key\b/i,
  /\bcvv\b/i,
  /\bcredit[_\s-]?card\b/i,
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/, // Credit card numbers
];

export function isSensitiveContent(text: string): boolean {
  if (!text) return false;
  return SENSITIVE_KEYWORDS.some((regex) => regex.test(text));
}

export async function handleGetMemories(req: Request, res: Response) {
  const user = (req as any).user;
  const memories = await db.getMemories(user.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ memories });
}

export async function handleSaveMemory(req: Request, res: Response) {
  const user = (req as any).user;
  const { memory_key, memory_value } = req.body || {};

  if (typeof memory_key !== 'string' || !memory_key.trim()) {
    return res.status(400).json({ error: 'Memory key is required (1-100 characters)' });
  }
  if (typeof memory_value !== 'string' || !memory_value.trim()) {
    return res.status(400).json({ error: 'Memory value is required (1-500 characters)' });
  }

  const trimmedKey = memory_key.trim();
  const trimmedValue = memory_value.trim();

  if (trimmedKey.length > 100) {
    return res.status(400).json({ error: 'Memory key must not exceed 100 characters' });
  }
  if (trimmedValue.length > 500) {
    return res.status(400).json({ error: 'Memory value must not exceed 500 characters' });
  }

  if (isSensitiveContent(trimmedKey) || isSensitiveContent(trimmedValue)) {
    return res.status(400).json({
      error: 'Security alert: Passwords, tokens, API keys, and sensitive financial data cannot be stored in memories.',
    });
  }

  const memory = await db.saveMemory(user.id, trimmedKey, trimmedValue);
  res.status(201).json({ success: true, memory });
}

export async function handleUpdateMemory(req: Request, res: Response) {
  const user = (req as any).user;
  const { id } = req.params;
  const { memory_value } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'Memory ID is required' });
  }

  if (typeof memory_value !== 'string' || !memory_value.trim()) {
    return res.status(400).json({ error: 'Memory value is required (1-500 characters)' });
  }

  const trimmedValue = memory_value.trim();
  if (trimmedValue.length > 500) {
    return res.status(400).json({ error: 'Memory value must not exceed 500 characters' });
  }

  if (isSensitiveContent(trimmedValue)) {
    return res.status(400).json({
      error: 'Security alert: Passwords, tokens, API keys, and sensitive financial data cannot be stored in memories.',
    });
  }

  const memory = await db.updateMemory(user.id, id, trimmedValue);
  if (!memory) {
    return res.status(404).json({ error: 'Memory not found or unauthorized' });
  }

  res.json({ success: true, memory });
}

export async function handleDeleteMemory(req: Request, res: Response) {
  const user = (req as any).user;
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Memory ID is required' });
  }

  const deleted = await db.deleteMemory(user.id, id);
  if (!deleted) {
    return res.status(404).json({ error: 'Memory not found or unauthorized' });
  }

  res.json({ success: true, message: 'Memory deleted successfully' });
}

export async function handleClearMemories(req: Request, res: Response) {
  const user = (req as any).user;
  const confirmed = req.body?.confirmed === true || req.query?.confirmed === 'true';

  if (!confirmed) {
    return res.status(400).json({
      error: 'Explicit confirmation (confirmed: true) is required to clear all memories',
    });
  }

  await db.clearMemories(user.id);
  res.json({ success: true, message: 'All memories cleared successfully' });
}
