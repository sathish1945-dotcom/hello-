import React, { useState, useEffect } from 'react';
import {
  X,
  Brain,
  Trash2,
  Edit2,
  Plus,
  Check,
  AlertTriangle,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { getApiUrl, getStoredAuthToken } from '../lib/api.ts';
import type { FriendMemory, User } from '../types/index.ts';

interface MemoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

export const MemoriesModal: React.FC<MemoriesModalProps> = ({ isOpen, onClose, user }) => {
  const [memories, setMemories] = useState<FriendMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New memory form state
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Clear all confirmation
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      loadMemories();
    }
  }, [isOpen, user]);

  const loadMemories = async () => {
    const token = getStoredAuthToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/friend/memories'), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to load memories');
      }
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (err: any) {
      setError(err?.message || 'Error loading memories');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getStoredAuthToken();
    if (!token) return;

    const trimmedKey = newKey.trim();
    const trimmedVal = newValue.trim();

    if (!trimmedKey || !trimmedVal) {
      setError('Key and value are both required.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(getApiUrl('/api/friend/memories'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          memory_key: trimmedKey,
          memory_value: trimmedVal,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save memory');
      }

      setNewKey('');
      setNewValue('');
      setIsAdding(false);
      setSuccessMsg(`Saved memory for "${trimmedKey}"!`);
      await loadMemories();
    } catch (err: any) {
      setError(err?.message || 'Failed to save memory');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (id: string) => {
    const token = getStoredAuthToken();
    if (!token) return;

    const trimmedVal = editValue.trim();
    if (!trimmedVal) {
      setError('Value cannot be empty');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/friend/memories/${id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          memory_value: trimmedVal,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update memory');
      }

      setEditingId(null);
      setEditValue('');
      setSuccessMsg('Memory updated successfully!');
      await loadMemories();
    } catch (err: any) {
      setError(err?.message || 'Failed to update memory');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, keyName: string) => {
    const token = getStoredAuthToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/friend/memories/${id}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete memory');
      }

      setSuccessMsg(`Deleted "${keyName}" from memory.`);
      await loadMemories();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete memory');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    const token = getStoredAuthToken();
    if (!token) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/friend/memories'), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ confirmed: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to clear memories');
      }

      setShowClearConfirm(false);
      setMemories([]);
      setSuccessMsg('All memories have been permanently cleared.');
    } catch (err: any) {
      setError(err?.message || 'Failed to clear memories');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memories-modal-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-950/50 flex items-center justify-center text-orange-600 dark:text-orange-400">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 id="memories-modal-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                History → My Memories
              </h2>
              <p className="text-[11px] text-zinc-500">
                Private memories saved in Friend Mode. Never shares passwords or keys.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-w-9 min-h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {!user ? (
            <div className="text-center py-8 text-xs text-zinc-500 space-y-2">
              <Lock className="w-6 h-6 mx-auto text-zinc-400" />
              <p>Please log in to Hello to access and manage your private memories.</p>
            </div>
          ) : (
            <>
              {/* Action Toolbar */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setIsAdding(!isAdding)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAdding ? 'Cancel' : 'Add Memory'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={loadMemories}
                    disabled={loading}
                    className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>

                  {memories.length > 0 && (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Add Memory Form */}
              {isAdding && (
                <form onSubmit={handleSaveNew} className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2.5">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Add New Memory Fact
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Fact Key (e.g., name, likes, city)"
                      value={newKey}
                      maxLength={100}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-hidden focus:border-orange-500"
                    />
                    <textarea
                      placeholder="Fact Value (e.g., Sathish, cricket, Chennai)"
                      value={newValue}
                      maxLength={500}
                      rows={2}
                      onChange={(e) => setNewValue(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-hidden focus:border-orange-500 resize-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAdding(false)}
                      className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !newKey.trim() || !newValue.trim()}
                      className="px-3 py-1 bg-orange-600 text-white rounded-lg text-xs font-medium hover:bg-orange-700 disabled:opacity-50"
                    >
                      Save Fact
                    </button>
                  </div>
                </form>
              )}

              {/* Clear All Confirmation Alert */}
              {showClearConfirm && (
                <div className="p-3.5 bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-900 rounded-xl space-y-2 text-xs">
                  <div className="font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Confirm Clear All Memories</span>
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Are you sure you want to permanently delete all {memories.length} saved memories? This cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="px-2.5 py-1 text-zinc-600 dark:text-zinc-300 hover:underline"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleClearAll}
                      disabled={loading}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-xs"
                    >
                      Yes, Clear All
                    </button>
                  </div>
                </div>
              )}

              {/* Memory List */}
              {memories.length === 0 ? (
                <div className="text-center py-10 px-4 text-zinc-400 dark:text-zinc-500 text-xs space-y-1">
                  <p>No memories saved yet.</p>
                  <p className="text-[11px]">
                    Tell Friend Mode: <span className="italic">"Remember my name is Sathish"</span> or add facts above!
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {memories.map((mem) => {
                    const isEditing = editingId === mem.id;
                    return (
                      <div
                        key={mem.id}
                        className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800/30 flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
                            {mem.memory_key}
                          </span>
                          <div className="flex items-center gap-1">
                            {!isEditing ? (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingId(mem.id);
                                    setEditValue(mem.memory_value);
                                  }}
                                  className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                                  title="Edit"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDelete(mem.id, mem.memory_key)}
                                  className="p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-[11px] text-zinc-400 hover:underline px-1"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="space-y-2 pt-1">
                            <input
                              type="text"
                              value={editValue}
                              maxLength={500}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-hidden focus:border-orange-500"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => handleUpdate(mem.id)}
                                disabled={loading || !editValue.trim()}
                                className="px-2.5 py-1 bg-orange-600 text-white rounded text-xs font-medium hover:bg-orange-700"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-zinc-800 dark:text-zinc-200 break-words">
                            {mem.memory_value}
                          </div>
                        )}

                        <div className="text-[10px] text-zinc-400">
                          Updated: {new Date(mem.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
