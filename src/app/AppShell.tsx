/**
 * Application chrome: header, tab navigation, mobile drawer, footer.
 * Pure layout — receives navigation state and callbacks from App.
 * Theme: deep-pine header over warm paper, file-folder tab navigation.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ExamSession } from '../types';
import { Icon, type IconName } from '../components/ui';

type TabId = ExamSession['activeTab'];

export interface NavTab {
  id: TabId;
  label: string;
  icon: IconName;
}

/** Full tool-pill set — teacher accounts get all three; filtered per-role in App.tsx. */
export const TOOL_TABS: NavTab[] = [
  { id: 'practice', label: 'Practice', icon: 'clock' },
  { id: 'question-bank', label: 'Upload Questions', icon: 'upload' },
  { id: 'question-paper', label: 'Question Paper', icon: 'document' },
];

interface AppShellProps {
  tabs: NavTab[];
  toolTabs?: NavTab[];
  activeTab: TabId;
  onNavigate: (tab: TabId) => void;
  onShowInfo: () => void;
  onToggleProfile: () => void;
  profileOpen: boolean;
  dark: boolean;
  setDark: (v: boolean) => void;
  banner?: ReactNode;
  children: ReactNode;
}

export function Logo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <div className={`${className} rounded-lg bg-accent-700 ring-1 ring-accent-500/50 flex items-center justify-center shrink-0`}>
      <Icon name="cap" className="w-[62%] h-[62%] text-ink-50" strokeWidth={1.8} />
    </div>
  );
}

/** Serif wordmark with a red-pen tick — used in header and drawer. */
export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className={`font-display text-lg font-semibold tracking-tight leading-none ${light ? 'text-ink-50' : 'text-ink-900 dark:text-ink-100'}`}>
      Exam<span className="italic">Checker</span>
      <svg viewBox="0 0 24 24" className="inline-block w-4 h-4 ml-0.5 -mt-2 text-red-400" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 13l5 5L20 6" />
      </svg>
    </span>
  );
}

export function AppShell({
  tabs, toolTabs = TOOL_TABS, activeTab, onNavigate, onShowInfo, onToggleProfile, profileOpen, dark, setDark, banner, children,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  function navigate(tab: TabId) {
    onNavigate(tab);
    setMenuOpen(false);
  }

  // Close drawer on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menuOpen]);

  // Prevent body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // Icon buttons on the pine header
  const iconBtn = 'w-9 h-9 flex items-center justify-center rounded-lg text-accent-100/80 hover:text-white hover:bg-white/10 transition-colors';

  const drawerItem = (active: boolean) =>
    `w-full text-left px-5 py-3 text-sm font-medium transition-colors flex items-center gap-3 ${
      active
        ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 border-l-[3px] border-accent-600 pl-[17px]'
        : 'text-ink-700 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800'
    }`;

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950 bg-desk">
      {banner}

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-ink-950/50 sm:hidden" onClick={() => setMenuOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-ink-50 dark:bg-ink-900 shadow-2xl flex flex-col transition-transform duration-200 ease-in-out sm:hidden ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-200 dark:border-ink-800 bg-accent-900">
          <div className="flex items-center gap-2.5">
            <Logo className="w-7 h-7" />
            <Wordmark light />
          </div>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="w-8 h-8 flex items-center justify-center rounded-lg text-accent-100/80 hover:bg-white/10">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => navigate(tab.id)} className={drawerItem(activeTab === tab.id)}>
              <Icon name={tab.icon} className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          ))}

          <div className="mx-4 my-2 border-t border-dashed border-ink-300 dark:border-ink-700" />

          {toolTabs.map(tab => (
            <button key={tab.id} onClick={() => navigate(tab.id)} className={drawerItem(activeTab === tab.id)}>
              <Icon name={tab.icon} className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          ))}

          <button
            onClick={() => { onShowInfo(); setMenuOpen(false); }}
            className="w-full text-left px-5 py-3 text-sm font-medium text-ink-700 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 flex items-center gap-3"
          >
            <Icon name="info" className="w-4 h-4 shrink-0" />
            How it works
          </button>
        </nav>

        <div className="border-t border-ink-200 dark:border-ink-800 px-5 py-4 flex items-center justify-between">
          <button onClick={() => setDark(!dark)} className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
            <Icon name={dark ? 'sun' : 'moon'} className="w-4 h-4" />
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={() => { onToggleProfile(); setMenuOpen(false); }}
            className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400"
          >
            <Icon name="user" className="w-4 h-4" />
            Account
          </button>
        </div>
      </div>

      {/* ── Header — deep pine board ──────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-accent-900 border-b-2 border-accent-950 px-3 sm:px-5 py-2.5 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMenuOpen(true)}
            className="sm:hidden w-9 h-9 flex items-center justify-center rounded-lg text-accent-100/80 hover:bg-white/10"
            aria-label="Open menu"
          >
            <Icon name="menu" className="w-5 h-5" />
          </button>

          <button
            onClick={() => navigate('setup')}
            className="flex items-center gap-2.5 hover:opacity-85 transition-opacity"
          >
            <Logo />
            <Wordmark light />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {toolTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.id)}
              title={tab.label}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white/15 text-white'
                  : 'text-accent-100/80 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon name={tab.icon} className="w-4 h-4" />
              {tab.label}
            </button>
          ))}

          <button onClick={onShowInfo} title="How it works" className={`hidden sm:flex ${iconBtn}`} aria-label="How it works">
            <Icon name="info" className="w-[18px] h-[18px]" />
          </button>

          <button onClick={() => setDark(!dark)} title={dark ? 'Light mode' : 'Dark mode'} className={iconBtn} aria-label="Toggle dark mode">
            <Icon name={dark ? 'sun' : 'moon'} className="w-[18px] h-[18px]" />
          </button>

          <button
            onClick={onToggleProfile}
            title="Account"
            aria-label="Account"
            className={`${iconBtn} ${profileOpen ? 'bg-white/15 text-white' : ''}`}
          >
            <Icon name="user" className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ── Desktop tab bar — file-folder tabs on the paper desk ──────────── */}
      {!profileOpen && (
        <nav className="hidden sm:block px-4 pt-3 border-b border-ink-200 dark:border-ink-800 print:hidden">
          <div className="flex gap-1.5 max-w-4xl mx-auto">
            {tabs.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => navigate(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg -mb-px transition-colors border ${
                    active
                      ? 'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-800 border-b-white dark:border-b-ink-900 text-accent-800 dark:text-accent-200 shadow-[0_-2px_0_0] shadow-accent-600'
                      : 'border-transparent text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-200 hover:bg-ink-100/60 dark:hover:bg-ink-900/60'
                  }`}
                >
                  <Icon name={tab.icon} className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {children}

      <footer className="mt-8 pb-6 text-center print:hidden">
        <div className="flex items-center justify-center gap-3 text-ink-300 dark:text-ink-700 mb-1.5" aria-hidden="true">
          <span className="h-px w-10 bg-current" />
          <Icon name="cap" className="w-3.5 h-3.5" />
          <span className="h-px w-10 bg-current" />
        </div>
        <p className="text-xs text-ink-400 dark:text-ink-600">© {new Date().getFullYear()} Vishal Singh. All rights reserved.</p>
      </footer>
    </div>
  );
}
