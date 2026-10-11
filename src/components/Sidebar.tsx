import React from 'react';
import {
  Plus,
  X,
  Blocks,
  Settings,
  LogOut,
  Sun,
  Moon,
  UserRound,
  Heart,
  GraduationCap,
  CalendarDays,
  Folder,
  Puzzle,
  History,
  ShieldCheck,
} from 'lucide-react';
import { ModelMeshLogo } from './ModelMeshLogo.tsx';
import type { User } from '../types/index.ts';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenModels?: () => void;
  onOpenIntegrations: () => void;
  onOpenFriendMode: () => void;
  onOpenTeacherMode: () => void;
  onOpenProjects: () => void;
  onOpenScheduling: () => void;
  onOpenPlugins: () => void;
  onOpenAdmin?: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onToggleDarkMode: () => void;
  darkMode: boolean;
  user: User | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  onNewChat,
  onOpenHistory,
  onOpenSettings,
  onOpenIntegrations,
  onOpenFriendMode,
  onOpenTeacherMode,
  onOpenProjects,
  onOpenScheduling,
  onOpenPlugins,
  onOpenAdmin,
  onOpenAuth,
  onLogout,
  onToggleDarkMode,
  darkMode,
  user,
}) => {
  const menuAction = (callback: () => void) => () => {
    callback();
    if (window.innerWidth < 768) onClose();
  };

  const isAdmin = user?.role === 'admin' || user?.email === 'sathish1945@gmail.com';

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
        className={`fixed md:static inset-y-0 left-0 z-50 w-[min(85vw,20rem)] md:w-64 bg-zinc-50 dark:bg-zinc-900/90 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-200 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:w-64'
        } ${!isOpen ? 'md:hidden' : ''}`}
      >
        {/* Top Header */}
        <div className="p-3 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center gap-2">
          <ModelMeshLogo className="w-7 h-7 shrink-0" />
          <span className="font-semibold text-sm flex-1 text-zinc-900 dark:text-zinc-100">hello👋</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="md:hidden min-w-11 min-h-11 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Action: New Chat */}
        <div className="p-3 pb-2">
          <button
            onClick={menuAction(onNewChat)}
            className="w-full flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs min-h-10 px-3 rounded-xl transition-all shadow-xs active:scale-[0.99]"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Feature Destinations Only (Strict Requirement: No recent-chat list in sidebar) */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1 text-xs font-medium">
          {/* Friend Mode */}
          <button
            onClick={menuAction(onOpenFriendMode)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
          >
            <img
              src="/assets/friend-mode-icon.png"
              alt=""
              aria-hidden="true"
              className="w-5 h-5 rounded-md object-cover shrink-0 shadow-xs border border-cyan-500/30"
            />
            <span>Friend Mode</span>
          </button>

          {/* History Feature Destination (Conversations + My Memories) */}
          <button
            onClick={menuAction(onOpenHistory)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <History className="w-4 h-4 text-blue-500" />
            <span>History</span>
          </button>

          {/* Teacher Mode — In development */}
          <button
            onClick={menuAction(onOpenTeacherMode)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <GraduationCap className="w-4 h-4 text-indigo-500" />
              <span>Teacher Mode</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-normal border border-amber-500/20">
              In development
            </span>
          </button>

          {/* Projects */}
          <button
            onClick={menuAction(onOpenProjects)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Folder className="w-4 h-4 text-purple-500" />
              <span>Projects</span>
            </div>
            <span className="text-[10px] text-zinc-400 font-normal">Soon</span>
          </button>

          {/* Integrations */}
          <button
            onClick={menuAction(onOpenIntegrations)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          >
            <Blocks className="w-4 h-4 text-emerald-500" />
            <span>Integrations</span>
          </button>

          {/* Scheduling */}
          <button
            onClick={menuAction(onOpenScheduling)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            <CalendarDays className="w-4 h-4 text-amber-500" />
            <span>Scheduling</span>
          </button>

          {/* Plugins */}
          <button
            onClick={menuAction(onOpenPlugins)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <Puzzle className="w-4 h-4 text-purple-500" />
            <span>Plugins</span>
          </button>

          {/* Protected Founder Admin Panel (Sathish) */}
          {isAdmin && onOpenAdmin && (
            <button
              onClick={menuAction(onOpenAdmin)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                <span>Founder Admin</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold">
                Admin
              </span>
            </button>
          )}
        </div>

        {/* Bottom account & settings menu */}
        <div className="p-2 border-t border-zinc-200/80 dark:border-zinc-800 space-y-0.5 text-xs">
          <button
            onClick={menuAction(onOpenSettings)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
          <button
            onClick={menuAction(onToggleDarkMode)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light theme' : 'Dark theme'}</span>
          </button>
          {user ? (
            <button
              onClick={menuAction(onLogout)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="truncate">Sign out ({user.name || user.email})</span>
            </button>
          ) : (
            <button
              onClick={menuAction(onOpenAuth)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <UserRound className="w-3.5 h-3.5" />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
