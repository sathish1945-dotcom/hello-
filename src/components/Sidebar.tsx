import React, { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Trash2,
  X,
  Download,
  Blocks,
  Settings,
  LogOut,
  Sun,
  Moon,
  UserRound,
  Layers3,
  Heart,
  GraduationCap,
  CalendarDays,
  Folder,
  HandHeart,
  Puzzle,
} from 'lucide-react';
import { ModelMeshLogo } from './ModelMeshLogo.tsx';
import type { Chat, User } from '../types/index.ts';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onExportChat?: (chatId: string) => void;
  onOpenSettings: () => void;
  onOpenModels: () => void;
  onOpenIntegrations: () => void;
  onOpenFriendMode: () => void;
  onOpenTeacherMode: () => void;
  onOpenRelationshipSupport: () => void;
  onOpenProjects: () => void;
  onOpenScheduling: () => void;
  onOpenPlugins: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onToggleDarkMode: () => void;
  darkMode: boolean;
  user: User | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onExportChat,
  onOpenSettings,
  onOpenModels,
  onOpenIntegrations,
  onOpenFriendMode,
  onOpenTeacherMode,
  onOpenRelationshipSupport,
  onOpenProjects,
  onOpenScheduling,
  onOpenPlugins,
  onOpenAuth,
  onLogout,
  onToggleDarkMode,
  darkMode,
  user,
}) => {
  const [search, setSearch] = useState('');
  const filteredChats = chats.filter((chat) =>
    (chat.title || '').toLowerCase().includes(search.toLowerCase())
  );

  const menuAction = (callback: () => void) => () => {
    callback();
    if (window.innerWidth < 768) onClose();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-xs transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Sidebar container */}
      <aside
        inert={!isOpen}
        aria-hidden={!isOpen}
        className={`fixed md:static inset-y-0 left-0 z-50 w-[min(85vw,20rem)] md:w-72 bg-zinc-50 dark:bg-zinc-900/90 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-200 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-72'
        } ${!isOpen ? 'md:hidden' : ''}`}
      >
        {/* Top header */}
        <div className="p-3 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center gap-2">
          <ModelMeshLogo className="w-7 h-7 shrink-0" />
          <span className="font-semibold text-sm flex-1">hello👋</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="md:hidden min-w-11 min-h-11 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Action: New Chat */}
        <div className="p-3 pb-1.5 flex items-center justify-between">
          <button
            onClick={menuAction(onNewChat)}
            className="flex-1 flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs min-h-10 px-3 rounded-xl transition-all shadow-xs active:scale-[0.99]"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Core Modes & Sections (Items 2-9) */}
        <div className="px-2 py-1.5 space-y-0.5 text-xs font-medium border-b border-zinc-200/60 dark:border-zinc-800/60">
          <button
            onClick={menuAction(onOpenFriendMode)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-orange-500/10 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
          >
            <Heart className="w-3.5 h-3.5 text-orange-500" />
            <span>Friend Mode</span>
          </button>

          <button
            onClick={menuAction(onOpenTeacherMode)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <GraduationCap className="w-3.5 h-3.5 text-blue-500" />
            <span>Teacher Mode</span>
          </button>

          <button
            onClick={menuAction(onOpenRelationshipSupport)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-pink-500/10 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <HandHeart className="w-3.5 h-3.5 text-pink-500" />
              <span>Relationship Support</span>
            </div>
            <span className="text-[10px] text-zinc-400 font-normal">Soon</span>
          </button>

          <button
            onClick={menuAction(onOpenProjects)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Folder className="w-3.5 h-3.5 text-purple-500" />
              <span>Projects</span>
            </div>
            <span className="text-[10px] text-zinc-400 font-normal">Soon</span>
          </button>

          <button
            onClick={menuAction(onOpenScheduling)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            <CalendarDays className="w-3.5 h-3.5 text-amber-500" />
            <span>Scheduling</span>
          </button>

          <button
            onClick={menuAction(onOpenModels)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <Layers3 className="w-3.5 h-3.5 text-indigo-500" />
            <span>Models & Allowance</span>
          </button>

          <button
            onClick={menuAction(onOpenIntegrations)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <Blocks className="w-3.5 h-3.5 text-emerald-500" />
            <span>Integrations</span>
          </button>

          <button
            onClick={menuAction(onOpenPlugins)}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <Puzzle className="w-3.5 h-3.5 text-purple-500" />
            <span>Plugins</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-2.5">
          <input
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full min-h-9 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/50 dark:bg-zinc-950/40 px-3 text-xs outline-hidden focus:border-blue-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </div>

        {/* Chat History List (Item 10) */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          <div className="px-2 pb-1 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
            Conversations
          </div>

          {filteredChats.length === 0 ? (
            <div className="text-center py-6 px-4 text-zinc-400 dark:text-zinc-500 text-xs">
              {search ? 'No matching conversations.' : 'No conversations yet. Start a new chat.'}
            </div>
          ) : (
            filteredChats.map((chat) => {
              const isActive = chat.id === activeChatId;
              return (
                <div
                  key={chat.id}
                  className={`group relative flex items-center justify-between pl-1 pr-1.5 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectChat(chat.id);
                      if (window.innerWidth < 768) onClose();
                    }}
                    className="flex flex-1 min-w-0 min-h-9 items-center gap-2 truncate px-2 text-left"
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <MessageSquare
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'
                      }`}
                    />
                    <span className="truncate">{chat.title || 'Untitled Chat'}</span>
                  </button>

                  {/* Actions: Export & Delete */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onExportChat && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onExportChat(chat.id);
                        }}
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 rounded transition-all"
                        title="Export as Markdown (.md)"
                        aria-label="Export chat as Markdown"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat.id);
                      }}
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-all"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom account / settings menu */}
        <div className="p-2 border-t border-zinc-200/80 dark:border-zinc-800 space-y-0.5 text-xs">
          <button onClick={menuAction(onOpenSettings)} className="mobile-menu-item">
            <Settings className="w-3.5 h-3.5" /> OpenRouter settings
          </button>
          <button onClick={menuAction(onToggleDarkMode)} className="mobile-menu-item">
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}{' '}
            {darkMode ? 'Light theme' : 'Dark theme'}
          </button>
          {user ? (
            <button onClick={menuAction(onLogout)} className="mobile-menu-item">
              <LogOut className="w-3.5 h-3.5" /> Sign out ({user.name || user.email})
            </button>
          ) : (
            <button onClick={menuAction(onOpenAuth)} className="mobile-menu-item">
              <UserRound className="w-3.5 h-3.5" /> Sign in
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
