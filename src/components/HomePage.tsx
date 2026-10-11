import React from "react";
import {
  MessageCircle,
  Users,
  Mic,
  Phone,
  Heart,
  GraduationCap,
  Folder,
  Link,
  CalendarDays,
  Puzzle,
  History,
  ChartNoAxesColumnIncreasing,
  Settings,
  ChevronRight,
  Mail,
  HardDrive,
  Github,
  Triangle,
  Zap,
} from "lucide-react";
import type { Chat } from "../types/index.ts";
import type { FeatureNoticeConfig } from "./FeatureNoticeModal.tsx";

interface HomePageProps {
  conversations: Chat[];
  onSelectConversation: (id: string) => void;
  onNewChat: (prompt?: string) => void;
  onOpenSetup: () => void;
  onOpenHistory: () => void;
  onOpenFriendMode?: () => void;
  onOpenTeacherMode?: () => void;
  onOpenScheduling?: () => void;
  onOpenFeatureNotice?: (feature: FeatureNoticeConfig) => void;
}

export function HelloOrb({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`hello-orb ${small ? "hello-orb-small" : ""}`}
      aria-hidden="true"
    >
      <span className="orb-face">
        <i />
        <i />
        <b />
      </span>
    </span>
  );
}

export function HomePage({
  conversations,
  onSelectConversation,
  onNewChat,
  onOpenSetup,
  onOpenHistory,
  onOpenFriendMode,
  onOpenTeacherMode,
  onOpenScheduling,
  onOpenFeatureNotice,
}: HomePageProps) {
  const recent = [...conversations]
    .sort(
      (a, b) =>
        Date.parse(b.updated_at || b.created_at) -
        Date.parse(a.updated_at || a.created_at),
    )
    .slice(0, 3);
  const openNotice = (feature: FeatureNoticeConfig) => {
    if (onOpenFeatureNotice) {
      onOpenFeatureNotice(feature);
    }
  };

  const features = [
    {
      label: "New Chat",
      Icon: MessageCircle,
      color: "blue",
      action: () => onNewChat(),
    },
    {
      label: "Group Chat",
      Icon: Users,
      color: "purple",
      action: () =>
        openNotice({
          title: "Group Chat",
          tagline: "Collaborative rooms with people + AI",
          description:
            "Invite friends, classmates, or teammates into shared conversation spaces where hello👋 assists with research, action items, and group consensus.",
          highlights: [
            "Shared link invitations for teammates",
            "Multi-agent collaborative answers",
            "Live meeting notes and action item drafting",
          ],
          status: "In Development",
        }),
    },
    {
      label: "Voice Chat",
      Icon: Mic,
      color: "pink",
      action: () =>
        openNotice({
          title: "Voice Chat",
          tagline: "Fluid, low-latency spoken conversations",
          description:
            "Speak naturally with hello👋 using real-time bidirectional streaming, natural interruptibility, and expressive response tones.",
          highlights: [
            "Ultra-low latency audio processing",
            "Interruption-aware fluid speech",
            "Hands-free conversational mode",
          ],
          status: "In Development",
        }),
    },
    {
      label: "Calls",
      Icon: Phone,
      color: "green",
      action: () =>
        openNotice({
          title: "AI Voice Calls",
          tagline: "Scheduled audio briefings & interview practice",
          description:
            "Receive scheduled morning phone briefings, mindful daily reflections, or simulated technical & behavioral interview practice.",
          highlights: [
            "Scheduled morning wake-up check-ins",
            "Realistic mock job interview simulations",
            "Language speaking practice drills",
          ],
          status: "Planned",
        }),
    },
    {
      label: "Friend Mode",
      Icon: Heart,
      color: "orange",
      action: onOpenFriendMode || (() =>
        onNewChat("Let's have a friendly conversation. Ask me how my day is going.")),
    },
    {
      label: "Teacher Mode",
      Icon: GraduationCap,
      color: "blue",
      action: onOpenTeacherMode || (() =>
        openNotice({
          title: "Teacher Mode",
          tagline: "Interactive learning & step-by-step guidance",
          description: "Structured lessons, practice drills, and adaptive explanations across subjects.",
          highlights: ["Concept breakdowns", "Practice questions", "Step-by-step review"],
          status: "In Development",
        })),
    },
    {
      label: "Projects",
      Icon: Folder,
      color: "purple",
      action: () =>
        openNotice({
          title: "Projects & Knowledge Hub",
          tagline: "Multi-document context & dedicated project spaces",
          description:
            "Group your research, documents, repositories, and custom prompt directives into organized project folders with dedicated memory.",
          highlights: [
            "Document ingestion & vector retrieval",
            "Custom system instructions per project",
            "Cross-document synthesis and code analysis",
          ],
          status: "In Development",
        }),

    },
    { label: "Integrations", Icon: Link, color: "cyan", action: onOpenSetup },
    {
      label: "Scheduling",
      Icon: CalendarDays,
      color: "orange",
      action: onOpenScheduling || (() => openNotice({
        title: "Daily Scheduling",
        tagline: "Automated check-ins and reflection routines",
        description: "Configure daily morning intentions, midday focus checks, and evening reflections.",
        highlights: ["Automated browser check-in notifications", "Routine tracking"],
        status: "In Development",
      })),
    },
    { label: "Plugins", Icon: Puzzle, color: "purple", action: onOpenSetup },
    { label: "History", Icon: History, color: "blue", action: onOpenHistory },
  ];
  const roles = [
    {
      name: "Friend",
      detail: "Chat, ideas, entertainment",
      Icon: Heart,
      color: "pink",
      updatePending: true,
    },
    {
      name: "Teacher",
      detail: "Study help, explanations",
      Icon: GraduationCap,
      color: "blue",
      updatePending: true,
    },
    {
      name: "Business",
      detail: "Analysis, strategy",
      Icon: ChartNoAxesColumnIncreasing,
      color: "green",
      prompt:
        "Help me critically evaluate a business idea. Ask me about the customer and problem first.",
    },
    {
      name: "Project",
      detail: "Planning, tasks",
      Icon: Folder,
      color: "purple",
      prompt:
        "Help me plan a project. Ask me about the goal and deadline first.",
    },
    {
      name: "Custom",
      detail: "Your own AI role",
      Icon: Settings,
      color: "slate",
      prompt: "I want you to take on this role: ",
    },
  ];
  const tools = [
    { name: "Gmail", Icon: Mail, color: "pink" },
    { name: "Drive", Icon: HardDrive, color: "green" },
    { name: "Calendar", Icon: CalendarDays, color: "blue" },
    { name: "GitHub", Icon: Github, color: "slate" },
    { name: "Vercel", Icon: Triangle, color: "slate" },
    { name: "Supabase", Icon: Zap, color: "green" },
    { name: "Plugins", Icon: Puzzle, color: "purple" },
  ];
  return (
    <div className="hello-home">
      <section className="hello-hero" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <h1 id="welcome-title">hello👋</h1>
          <p>
            People and AI, together
            <br />
            in one conversation.
          </p>
        </div>
        <div className="hero-universe">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <HelloOrb />
        </div>
      </section>
      <nav className="hello-features" aria-label="Quick actions">
        {features.map(({ label, Icon, color, action }) => (
          <button
            key={label}
            className={`hello-tile tone-${color}`}
            onClick={action}
            disabled={!action}
            title={!action ? `${label} — coming soon` : label}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {!action && <small>Coming soon</small>}
          </button>
        ))}
      </nav>
      <section className="hello-recent" aria-labelledby="recent-title">
        <div className="hello-section-heading">
          <h2 id="recent-title">Continue your conversation</h2>
          <button onClick={onOpenHistory}>
            See all <ChevronRight size={16} />
          </button>
        </div>
        {recent.length ? (
          recent.map((c) => (
            <button
              className="hello-conversation"
              key={c.id}
              onClick={() => onSelectConversation(c.id)}
            >
              <HelloOrb small />
              <span className="conversation-copy">
                <strong>{c.title}</strong>
                <span>Continue your conversation</span>
              </span>
              <span className="conversation-meta">
                <time
                  dateTime={new Date(
                    c.updated_at || c.created_at,
                  ).toISOString()}
                >
                  {new Date(c.updated_at || c.created_at).toLocaleDateString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                    },
                  )}
                </time>
              </span>
            </button>
          ))
        ) : (
          <div className="hello-empty">
            <MessageCircle size={24} />
            <p>Your conversations will appear here.</p>
            <button onClick={() => onNewChat()}>
              Start your first chat <ChevronRight size={15} />
            </button>
          </div>
        )}
      </section>
      <section aria-labelledby="roles-title">
        <div className="hello-section-heading">
          <h2 id="roles-title">AI Roles</h2>
          <span className="section-note">Choose a conversation style</span>
        </div>
        <div className="hello-roles">
          {roles.map(({ name, detail, Icon, color, prompt }) => {
            const handleClick = () => {
              if (name === "Friend" && onOpenFriendMode) {
                onOpenFriendMode();
              } else if (name === "Teacher" && onOpenTeacherMode) {
                onOpenTeacherMode();
              } else {
                onNewChat(prompt);
              }
            };
            return (
              <button
                key={name}
                className={`hello-role tone-${color}`}
                onClick={handleClick}
              >
                <Icon aria-hidden="true" />
                <strong>{name}</strong>
                <span>{detail}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="tools-title">
        <div className="hello-section-heading">
          <h2 id="tools-title">Connected Tools</h2>
          <button onClick={onOpenSetup}>
            Manage <ChevronRight size={16} />
          </button>
        </div>
        <div className="hello-tools">
          {tools.map(({ name, Icon, color }) => (
            <button
              className={`hello-tool tone-${color}`}
              key={name}
              onClick={onOpenSetup}
              disabled={!["Drive", "Plugins"].includes(name)}
              title={
                ["Drive", "Plugins"].includes(name)
                  ? `Manage ${name} integration`
                  : `${name} — coming soon`
              }
            >
              <span>
                <Icon aria-hidden="true" />
              </span>
              {name}
              {!["Drive", "Plugins"].includes(name) && (
                <small>Coming soon</small>
              )}
            </button>
          ))}
        </div>
        <p className="hello-tools-note">
          Manage connections and check availability in settings.
        </p>
      </section>
      <section aria-labelledby="schedule-title">
        <div className="hello-section-heading">
          <h2 id="schedule-title">Today’s Schedule</h2>
          {onOpenScheduling && (
            <button onClick={onOpenScheduling}>
              Configure <ChevronRight size={16} />
            </button>
          )}
        </div>
        <div
          className="hello-schedule cursor-pointer hover:border-amber-500/40 transition-colors"
          onClick={onOpenScheduling}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onOpenScheduling?.();
            }
          }}
        >
          <CalendarDays aria-hidden="true" />
          <div>
            <strong>A little space for your day</strong>
            <p>Scheduled morning, midday, and evening check-ins. Click to configure.</p>
          </div>
        </div>
      </section>
      <footer className="hello-footer">People + AI + Communication</footer>
    </div>
  );
}
