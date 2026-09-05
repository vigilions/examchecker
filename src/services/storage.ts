/**
 * Safe localStorage access. Every read tolerates corrupted JSON and every
 * write tolerates QuotaExceededError, per project rules.
 */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[storage] write failed for "${key}":`, err);
    return false;
  }
}

export function readString(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeString(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch (err) {
    console.error(`[storage] write failed for "${key}":`, err);
  }
}

/** Per-user localStorage keys, in one place so they never drift. */
export const storageKeys = {
  history: (userId: string) => (userId ? `exam-history-${userId}` : 'exam-history'),
  savedSessions: (userId: string) => (userId ? `saved-session-ids-${userId}` : 'saved-session-ids'),
  subjects: (userId: string) => (userId ? `exam-subjects-${userId}` : 'exam-subjects'),
  suggestions: (userId: string) => (userId ? `exam-suggestions-${userId}` : 'exam-suggestions'),
  questionBank: (userId: string) => (userId ? `question-bank-${userId}` : 'question-bank'),
  /**
   * Finished practice attempts. Deliberately a SEPARATE array from `history` so
   * a practice run can never surface in the teacher's exam archive, even if a
   * filter is missed somewhere.
   */
  practiceHistory: (userId: string) => (userId ? `practice-history-${userId}` : 'practice-history'),
  /** The in-progress practice session, so a refresh mid-test doesn't lose it. */
  practice: (userId: string) => (userId ? `practice-session-${userId}` : 'practice-session'),
  darkMode: 'dark-mode',
  /**
   * Role chosen on the signup form, stashed until the access row is actually
   * created (that happens lazily on first login after email verification —
   * see App.tsx's checkAccess). Cleared once consumed.
   */
  pendingRole: (email: string) => `pending-role-${email.toLowerCase()}`,
};
