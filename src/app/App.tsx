import { useState, useEffect, lazy, Suspense } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseError } from '../services/data/supabase';
import { getMyAccess, createAccessRequest, type UserRole } from '../services/data/access';
import { env } from '../config/env';
import { readString, storageKeys } from '../services/storage';
import { ExamProvider, useExam, useExamDispatch } from '../context/ExamContext';
import { PracticeProvider, hasPracticeInProgress } from '../context/PracticeContext';
import type { ExamSession } from '../types';
import { AppShell, TOOL_TABS, type NavTab } from './AppShell';
import { PendingScreen, RevokedScreen, ExpiredScreen } from './AccessScreens';
import { useDarkMode } from './useDarkMode';
import { AuthGate } from '../features/auth/AuthGate';
import { PasswordResetScreen } from '../features/auth/PasswordResetScreen';
import { Spinner } from '../components/ui';
import { terminateOCRWorker } from '../services/ai/ocr';

// Route-level code splitting: each view loads on first visit.
const ExamSetup = lazy(() => import('../features/setup/ExamSetup').then(m => ({ default: m.ExamSetup })));
const GradingView = lazy(() => import('../features/grading/GradingView').then(m => ({ default: m.GradingView })));
const ReportView = lazy(() => import('../features/report/ReportView').then(m => ({ default: m.ReportView })));
const HistoryView = lazy(() => import('../features/history/HistoryView').then(m => ({ default: m.HistoryView })));
const AnalyticsView = lazy(() => import('../features/analytics/AnalyticsView').then(m => ({ default: m.AnalyticsView })));
const QuestionBankView = lazy(() => import('../features/bank/QuestionBankView').then(m => ({ default: m.QuestionBankView })));
const QuestionPaperBuilder = lazy(() => import('../features/paper/QuestionPaperBuilder').then(m => ({ default: m.QuestionPaperBuilder })));
const PracticeView = lazy(() => import('../features/practice/PracticeView').then(m => ({ default: m.PracticeView })));
const AdminPanel = lazy(() => import('../features/admin/AdminPanel').then(m => ({ default: m.AdminPanel })));
const LandingPage = lazy(() => import('../features/landing/LandingPage').then(m => ({ default: m.LandingPage })));
const InfoModal = lazy(() => import('../features/info/InfoModal').then(m => ({ default: m.InfoModal })));
const ProfileView = lazy(() => import('../features/auth/ProfileView').then(m => ({ default: m.ProfileView })));

// Free the Tesseract worker thread when the page unloads
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { terminateOCRWorker(); });
}

const BASE_TABS: NavTab[] = [
  { id: 'setup', label: 'Setup', icon: 'edit' },
  { id: 'grade', label: 'Grade', icon: 'circleCheck' },
  { id: 'report', label: 'Report', icon: 'document' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
];

function CenteredLoader({ label }: { label?: string }) {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="flex items-center gap-2 text-ink-400 text-sm">
        <Spinner className="w-4 h-4" />
        {label ?? 'Loading…'}
      </div>
    </div>
  );
}

function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950 bg-desk flex items-center justify-center">
      <div className="flex items-center gap-2 text-ink-400 text-sm">
        <Spinner className="w-4 h-4" />
        {label ?? 'Loading…'}
      </div>
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 text-center print:hidden">
      {children}
    </div>
  );
}

// ── Signed-in application ──────────────────────────────────────────────────────

interface AppInnerProps {
  session: Session | null;
  dark: boolean;
  setDark: (v: boolean) => void;
  isAdmin?: boolean;
  role: UserRole;
  banner?: React.ReactNode;
}

// Student accounts only get the self-practice loop — the exam-grading tools
// (Setup/Grade/Report/Analytics/Bank/Paper Builder) stay teacher-only for now.
const STUDENT_BASE_TABS: NavTab[] = [
  { id: 'history', label: 'History', icon: 'history' },
];
const STUDENT_TOOL_TABS: NavTab[] = [
  { id: 'practice', label: 'Practice', icon: 'clock' },
];

function AppInner({ session, dark, setDark, isAdmin, role, banner }: AppInnerProps) {
  const userId = session?.user?.id ?? '';
  // Seeds the student name on practice reports so printouts carry a real name
  const userName = session?.user?.email?.split('@')[0] ?? 'Me';
  const { activeTab } = useExam();
  const dispatch = useExamDispatch();
  const [showInfo, setShowInfo] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const isStudent = role === 'student';

  const tabs: NavTab[] = isStudent
    ? STUDENT_BASE_TABS
    : [
        ...BASE_TABS,
        ...(isAdmin ? [{ id: 'admin' as const, label: 'Admin', icon: 'users' as const }] : []),
      ];
  const toolTabs: NavTab[] = isStudent ? STUDENT_TOOL_TABS : TOOL_TABS;

  function navigate(tabId: ExamSession['activeTab']) {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tabId });
    setShowProfile(false);
  }

  const wideTab = activeTab === 'analytics' || activeTab === 'admin' || activeTab === 'question-paper';

  return (
    <AppShell
      tabs={tabs}
      toolTabs={toolTabs}
      activeTab={activeTab}
      onNavigate={navigate}
      onShowInfo={() => setShowInfo(true)}
      onToggleProfile={() => setShowProfile(p => !p)}
      profileOpen={showProfile}
      dark={dark}
      setDark={setDark}
      banner={banner}
    >
      <Suspense fallback={null}>
        {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
      </Suspense>

      <main className={`p-3 sm:p-4 mx-auto ${wideTab ? 'max-w-6xl' : 'max-w-4xl'}`}>
        <Suspense fallback={<CenteredLoader />}>
          {showProfile && session ? (
            <ProfileView user={session.user} onBack={() => setShowProfile(false)} />
          ) : isStudent ? (
            <>
              {activeTab === 'history' && <HistoryView userId={userId} role="student" />}
              {activeTab === 'practice' && <PracticeView userId={userId} userName={userName} />}
            </>
          ) : (
            <>
              {activeTab === 'setup' && <ExamSetup userId={userId} />}
              {activeTab === 'grade' && <GradingView />}
              {activeTab === 'report' && <ReportView userId={userId} />}
              {activeTab === 'history' && <HistoryView userId={userId} role="teacher" />}
              {activeTab === 'analytics' && <AnalyticsView userId={userId} />}
              {activeTab === 'admin' && isAdmin && <AdminPanel adminEmail={env.adminEmail} />}
              {activeTab === 'question-bank' && <QuestionBankView userId={userId} onBack={() => navigate('setup')} />}
              {activeTab === 'question-paper' && <QuestionPaperBuilder userId={userId} />}
              {activeTab === 'practice' && <PracticeView userId={userId} userName={userName} />}
            </>
          )}
        </Suspense>
      </main>
    </AppShell>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

const AUTH_TIMEOUT_MS = 8000;

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authUnreachable, setAuthUnreachable] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [accessStatus, setAccessStatus] = useState<'loading' | 'ok' | 'pending' | 'revoked' | 'expired'>('loading');
  // Landing page only on wide screens; phones go straight to login
  const [showAuth, setShowAuth] = useState(() => window.innerWidth < 1024);
  // Portal picked on the login/signup form — used to file new access requests
  // under the right role and to catch someone signing in on the wrong portal.
  const [role, setRole] = useState<UserRole>('teacher');
  // The account's actual role once access has been checked (drives which tabs AppInner shows)
  const [resolvedRole, setResolvedRole] = useState<UserRole>('teacher');
  const [roleError, setRoleError] = useState('');

  useEffect(() => {
    if (!supabase) { setSession(null); return; }

    let done = false;
    // Never hang on "Loading…": if the auth server is unreachable (e.g. the
    // Supabase project is paused), fall through to the login screen.
    const timeout = setTimeout(() => {
      if (!done) {
        setAuthUnreachable(true);
        setSession(null);
      }
    }, AUTH_TIMEOUT_MS);

    supabase.auth.getSession()
      .then(({ data }) => {
        done = true;
        clearTimeout(timeout);
        setSession(data.session ?? null);
      })
      .catch(() => {
        done = true;
        clearTimeout(timeout);
        setAuthUnreachable(true);
        setSession(null);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      done = true;
      clearTimeout(timeout);
      setPasswordRecovery(event === 'PASSWORD_RECOVERY');
      setSession(s ?? null);
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  // Access check whenever a valid session appears
  useEffect(() => {
    if (!session) return;

    async function checkAccess(s: Session) {
      const isAdmin = env.adminEmail && s.user.email === env.adminEmail;
      if (isAdmin) { setResolvedRole('teacher'); setAccessStatus('ok'); return; }

      try {
        const access = await getMyAccess(s.user.id);
        if (!access) {
          // First login after signup — the role chosen on the signup form was
          // stashed under the email since no access row existed yet to hold it.
          const pending = (readString(storageKeys.pendingRole(s.user.email ?? '')) as UserRole | null) ?? role;
          await createAccessRequest(s.user.id, s.user.email ?? '', pending);
          setResolvedRole(pending);
          setAccessStatus('pending');
          return;
        }

        // Caught the wrong portal: the account is registered under a different
        // role than the one selected on the login screen.
        if (access.role !== role) {
          await supabase!.auth.signOut();
          setRoleError(`This account is registered as a ${access.role}. Please use the ${access.role} login.`);
          return;
        }

        setResolvedRole(access.role);
        if (access.status === 'revoked') { setAccessStatus('revoked'); return; }
        if (access.status === 'pending') { setAccessStatus('pending'); return; }
        const expired = access.trial_ends_at ? new Date(access.trial_ends_at) < new Date() : false;
        setAccessStatus(expired ? 'expired' : 'ok');
      } catch {
        // Access table unreachable — don't lock a signed-in user out of local data
        setAuthUnreachable(true);
        setResolvedRole(role);
        setAccessStatus('ok');
      }
    }

    checkAccess(session);
  }, [session, role]);

  if (session === undefined) {
    return <FullScreenLoader />;
  }

  if (passwordRecovery) {
    return <PasswordResetScreen />;
  }

  const banner = supabaseError ? (
    <WarningBanner>Auth disabled: {supabaseError}</WarningBanner>
  ) : authUnreachable ? (
    <WarningBanner>
      Could not reach the server — sign-in and cloud sync are unavailable. Your data is stored locally.
    </WarningBanner>
  ) : undefined;

  // No Supabase configured → run without auth
  if (!supabase) {
    return (
      <ExamProvider initialTab={hasPracticeInProgress('') ? 'practice' : undefined}>
        <PracticeProvider userId="">
          <AppInner session={null} dark={dark} setDark={setDark} role="teacher" banner={banner} />
        </PracticeProvider>
      </ExamProvider>
    );
  }

  if (session) {
    if (accessStatus === 'loading') {
      return <FullScreenLoader label="Checking access…" />;
    }
    if (accessStatus === 'pending') return <PendingScreen userEmail={session.user.email} />;
    if (accessStatus === 'revoked') return <RevokedScreen userEmail={session.user.email} />;
    if (accessStatus === 'expired') return <ExpiredScreen userEmail={session.user.email} />;

    const isAdmin = !!(env.adminEmail && session.user.email === env.adminEmail);
    // A discarded/reloaded tab must return to a running test, not to Setup;
    // students land on Practice by default since Setup isn't available to them.
    const resumeTab = hasPracticeInProgress(session.user.id)
      ? 'practice' as const
      : resolvedRole === 'student' ? 'practice' as const : undefined;
    return (
      <ExamProvider initialTab={resumeTab}>
        {/* keyed so a different account starts from a clean practice session */}
        <PracticeProvider userId={session.user.id} key={session.user.id}>
          <AppInner session={session} dark={dark} setDark={setDark} isAdmin={isAdmin} role={resolvedRole} banner={banner} />
        </PracticeProvider>
      </ExamProvider>
    );
  }

  if (!showAuth) {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <LandingPage onGetStarted={() => setShowAuth(true)} />
      </Suspense>
    );
  }
  return (
    <AuthGate
      banner={banner}
      role={role}
      onRoleChange={(r) => { setRole(r); setRoleError(''); }}
      roleError={roleError}
    />
  );
}
