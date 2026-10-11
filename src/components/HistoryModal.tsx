import React, { useState, useEffect } from 'react';
import {
  X,
  History as HistoryIcon,
  MessageSquare,
  Brain,
  Trash2,
  Download,
  Search,
  Plus,
  Edit2,
  Check,
  AlertTriangle,
  RefreshCw,
  Lock,
  Info,
} from 'lucide-react';
import { getApiUrl, getStoredAuthToken } from '../lib/api.ts';
import type { Chat, FriendMemory, User } from '../types/index.ts';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onExportChat?: (chatId: string) => void;
  user: User | null;
  defaultTab?: 'conversations' | 'memories';
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  chats,
  activeChatId,
  onSelectChat,
  onDeleteChat,
  onExportChat,
  user,
  defaultTab = 'conversations',
}) => {
  const [activeTab, setActiveTab] = useState<'conversations' | 'memories'>(defaultTab);
  const [search, setSearch] = useState('');

  // Memories State
  const [memories, setMemories] = useState<FriendMemory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memorySuccessMsg, setMemorySuccessMsg] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  useEffect(() => {
    if (isOpen && user && activeTab === 'memories') {
      loadMemories();
    }
  }, [isOpen, user, activeTab]);

  if (!isOpen) return null;

  const filteredChats = chats.filter((chat) =>
    (chat.title || '').toLowerCase().includes(search.toLowerCase())
  );

  const loadMemories = async () => {
    const token = getStoredAuthToken();
    if (!token) return;

    setLoadingMemories(true);
    setMemoryError(null);
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
      setMemoryError(err?.message || 'Error loading memories');
    } finally {
      setLoadingMemories(false);
    }
  };

  const handleSaveNewMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getStoredAuthToken();
    if (!token) return;

    const trimmedKey = newKey.trim();
    const trimmedVal = newValue.trim();

    if (!trimmedKey || !trimmedVal) {
      setMemoryError('Key and value are both required.');
      return;
    }

    setLoadingMemories(true);
    setMemoryError(null);
    setMemorySuccessMsg(null);

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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save memory');
      }

      setNewKey('');
      setNewValue('');
      setIsAddingMemory(false);
      setMemorySuccessMsg(`Saved fact for "${trimmedKey}".`);
      await loadMemories();
    } catch (err: any) {
      setMemoryError(err.message || 'Error saving memory');
    } finally {
      setLoadingMemories(false);
    }
  };

  const handleUpdateMemory = async (id: string) => {
    const token = getStoredAuthToken();
    if (!token) return;

    const trimmedVal = editValue.trim();
    if (!trimmedVal) return;

    setLoadingMemories(true);
    setMemoryError(null);
    setMemorySuccessMsg(null);

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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update memory');
      }

      setEditingId(null);
      setEditValue('');
      setMemorySuccessMsg('Memory updated.');
      await loadMemories();
    } catch (err: any) {
      setMemoryError(err.message || 'Error updating memory');
    } finally {
      setLoadingMemories(false);
    }
  };

  const handleDeleteMemory = async (id: string, keyName: string) => {
    const token = getStoredAuthToken();
    if (!token) return;

    setLoadingMemories(true);
    setMemoryError(null);
    setMemorySuccessMsg(null);

    try {
      const res = await fetch(getApiUrl(`/api/friend/memories/${id}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to delete memory');
      }

      setMemorySuccessMsg(`Removed "${keyName}" from memory.`);
      await loadMemories();
    } catch (err: any) {
      setMemoryError(err.message || 'Error deleting memory');
    } finally {
      setLoadingMemories(false);
    }
  };

  const handleClearAllMemories = async () => {
    const token = getStoredAuthToken();
    if (!token) return;

    setLoadingMemories(true);
    setMemoryError(null);
    setMemorySuccessMsg(null);

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
        throw new Error('Failed to clear memories');
      }

      setShowClearConfirm(false);
      setMemorySuccessMsg('All saved memories have been cleared.');
      await loadMemories();
    } catch (err: any) {
      setMemoryError(err.message || 'Error clearing memories');
    } finally {
      setLoadingMemories(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-center items-center p-2 sm:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="History and Memories"
        className="w-full max-w-2xl max-h-[92dvh] flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <HistoryIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                History & Memories
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                View past conversations and manage persistent saved facts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 pt-2 gap-2 bg-zinc-50/50 dark:bg-zinc-950/30">
          <button
            onClick={() => setActiveTab('conversations')}
            className={`pb-2.5 px-3 font-semibold text-xs transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'conversations'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Conversations ({chats.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('memories')}
            className={`pb-2.5 px-3 font-semibold text-xs transition-colors flex items-center gap-2 border-b-2 ${
              activeTab === 'memories'
                ? 'border-amber-600 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>My Memories ({memories.length})</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 text-xs">
          {activeTab === 'conversations' && (
            <div className="space-y-3">
              {/* Retention Policy Notice */}
              <div className="p-3 rounded-xl bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 flex items-start gap-2.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-xs">
                  <span className="font-semibold">Conversation Retention Policy:</span>
                  <p className="text-[11px] opacity-90">
                    Friend Mode keeps your 10 most recent voice conversation exchanges. Persistent saved memories in “My Memories” are stored separately with explicit consent and are never automatically deleted.
                  </p>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search past conversations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-blue-500"
                />
              </div>

              {/* Conversation List */}
              {filteredChats.length === 0 ? (
                <div className="text-center py-10 text-zinc-400 text-xs">
                  {search ? 'No conversations matching search.' : 'No conversations recorded yet. Start a new chat anytime!'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredChats.map((chat) => {
                    const isActive = chat.id === activeChatId;
                    return (
                      <div
                        key={chat.id}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                          isActive
                            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800'
                            : 'bg-zinc-50/50 dark:bg-zinc-950/30 border-zinc-200/80 dark:border-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectChat(chat.id);
                            onClose();
                          }}
                          className="flex items-center gap-2.5 text-left flex-1 min-w-0"
                        >
                          <MessageSquare className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-zinc-400'}`} />
                          <div className="min-w-0">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate block">
                              {chat.title || 'Untitled Chat'}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {new Date(chat.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {onExportChat && (
                            <button
                              type="button"
                              onClick={() => onExportChat(chat.id)}
                              title="Export as Markdown (.md)"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteChat(chat.id)}
                            title="Delete conversation"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'memories' && (
            <div className="space-y-4">
              {/* Security & Consent Notice */}
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-zinc-800 dark:text-zinc-200 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                  <Lock className="w-4 h-4" />
                  <span>Privacy & Explicit Consent</span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Persistent memories are saved only with your explicit voice or text instruction (e.g. "Remember my name is Sathish"). Passwords, API keys, and sensitive tokens are strictly rejected and never saved.
                </p>
              </div>

              {memoryError && (
                <div className="p-3 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 text-xs">
                  {memoryError}
                </div>
              )}

              {memorySuccessMsg && (
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-xs">
                  {memorySuccessMsg}
                </div>
              )}

              {/* Action Toolbar */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingMemory(!isAddingMemory)}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAddingMemory ? 'Cancel' : 'Add Memory Fact'}</span>
                </button>

                {memories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 font-medium text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All Memories</span>
                  </button>
                )}
              </div>

              {/* Add Memory Form */}
              {isAddingMemory && (
                <form
                  onSubmit={handleSaveNewMemory}
                  className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                        Fact Key (e.g. name, location, likes_cricket)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. name"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                        Fact Value (e.g. Sathish, Chennai, true)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Sathish"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddingMemory(false)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loadingMemories}
                      className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs"
                    >
                      Save Memory
                    </button>
                  </div>
                </form>
              )}

              {/* Clear Confirmation */}
              {showClearConfirm && (
                <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/5 space-y-2">
                  <div className="flex items-center gap-2 text-red-600 font-semibold text-xs">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Are you sure you want to delete all saved memories?</span>
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    This permanently removes all persistent facts. Active chat context is preserved.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(false)}
                      className="px-3 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAllMemories}
                      disabled={loadingMemories}
                      className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-xs"
                    >
                      Yes, Clear All
                    </button>
                  </div>
                </div>
              )}

              {/* Memory Fact Cards */}
              {loadingMemories && memories.length === 0 ? (
                <div className="text-center py-8 text-zinc-400">Loading memories...</div>
              ) : memories.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 space-y-1">
                  <p className="font-medium">No persistent memories saved yet.</p>
                  <p className="text-[11px]">Say "Remember my name is..." in Friend Mode or click "Add Memory Fact" above.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {memories.map((m) => (
                    <div
                      key={m.id}
                      className="p-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/30 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono text-[11px] block">
                          {m.memory_key}
                        </span>
                        {editingId === m.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs flex-1"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateMemory(m.id)}
                              className="p-1 rounded bg-amber-600 text-white"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="p-1 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-zinc-800 dark:text-zinc-200 block text-xs mt-0.5">
                            {m.memory_value}
                          </span>
                        )}
                      </div>

                      {editingId !== m.id && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditValue(m.memory_value);
                            }}
                            title="Edit memory fact"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMemory(m.id, m.memory_key)}
                            title="Forget / Delete fact"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
