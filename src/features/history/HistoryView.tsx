import { useState, useMemo, useEffect } from 'react';
import type { HistoryRecord } from '../../types';
import { useExam } from '../../context/ExamContext';
import {
  loadReports, updateReport, moveToTrash, restoreFromTrash, loadTrash,
  purgeExpiredTrash, deleteReport, type TrashEntry,
} from '../../services/data/reports';
import { getCurrentUserId, supabase } from '../../services/data/supabase';
import { readJson, writeJson, storageKeys } from '../../services/storage';
import { loadPracticeRecords, writePracticeRecords } from '../practice/practiceReport';
import { printReport } from '../report/printReport';
import { UpdateModal } from './UpdateModal';
import { RecordDetail, formatDate } from './RecordDetail';
import { Badge, Card, Caret, ConfirmDeleteModal, EmptyState, Icon } from '../../components/ui';

// ── Tree helpers ──────────────────────────────────────────────────────────────

type Tree = Map<number, Map<string, Map<string, Map<string, HistoryRecord[]>>>>;

function buildTree(records: HistoryRecord[]): Tree {
  const tree: Tree = new Map();
  for (const r of records) {
    const year = new Date(r.savedAt).getFullYear();
    const cls = r.examClass || 'Unclassified';
    const sec = r.studentSection || 'Unclassified';
    const sub = r.subject || 'General';
    if (!tree.has(year)) tree.set(year, new Map());
    const ym = tree.get(year)!;
    if (!ym.has(cls)) ym.set(cls, new Map());
    const cm = ym.get(cls)!;
    if (!cm.has(sec)) cm.set(sec, new Map());
    const sm = cm.get(sec)!;
    if (!sm.has(sub)) sm.set(sub, []);
    sm.get(sub)!.push(r);
  }
  return tree;
}

function daysLeft(deletedAt: string): number {
  const diff = 7 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(deletedAt).getTime());
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function toggleSet<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val); else next.add(val);
  return next;
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function HistoryView({ userId = '', role = 'teacher' }: { userId?: string; role?: 'teacher' | 'student' }) {
  const { hfApiKey, geminiApiKey } = useExam();
  const histKey = storageKeys.history(userId);
  const [records, setRecords] = useState<HistoryRecord[]>(() => readJson<HistoryRecord[]>(histKey, []));
  // Practice attempts live in their own key, so they can never leak into the archive
  const [practiceRecords, setPracticeRecords] = useState<HistoryRecord[]>(() => loadPracticeRecords(userId));
  const [practiceDeleteTarget, setPracticeDeleteTarget] = useState<HistoryRecord | null>(null);
  const [practiceDeleteInput, setPracticeDeleteInput] = useState('');

  // Students only ever see their own practice attempts — no exam archive or trash.
  const [view, setView] = useState<'history' | 'practice' | 'trash'>(role === 'student' ? 'practice' : 'history');
  const [trashRecords, setTrashRecords] = useState<TrashEntry[]>([]);
  const [permDeleteTarget, setPermDeleteTarget] = useState<TrashEntry | null>(null);
  const [permDeleteInput, setPermDeleteInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updateRecord, setUpdateRecord] = useState<HistoryRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryRecord | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());
  const [openClasses, setOpenClasses] = useState<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());

  // Merge Supabase records with localStorage on mount; also load trash
  useEffect(() => {
    if (!supabase) return;
    getCurrentUserId().then(async uid => {
      if (!uid) return;
      await purgeExpiredTrash(uid);
      const [remote, trash] = await Promise.all([loadReports(uid), loadTrash(uid)]);
      setTrashRecords(trash);
      if (remote.length === 0) return;

      // The `reports` table holds both kinds — split them so practice attempts
      // never land in the exam archive.
      const remoteExams = remote.filter(r => r.kind !== 'practice');
      const remotePractice = remote.filter(r => r.kind === 'practice');

      const byDateDesc = (a: HistoryRecord, b: HistoryRecord) =>
        new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();

      if (remoteExams.length > 0) {
        setRecords(prev => {
          const localById = new Map(prev.map(r => [r.id, r]));
          for (const r of remoteExams) localById.set(r.id, r);
          const merged = [...localById.values()].sort(byDateDesc);
          writeJson(histKey, merged);
          return merged;
        });
      }

      if (remotePractice.length > 0) {
        setPracticeRecords(prev => {
          const localById = new Map(prev.map(r => [r.id, r]));
          for (const r of remotePractice) localById.set(r.id, r);
          const merged = [...localById.values()].sort(byDateDesc);
          writePracticeRecords(userId, merged);
          return merged;
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = useMemo(() => buildTree(records), [records]);
  const selected =
    records.find(r => r.id === selectedId) ??
    practiceRecords.find(r => r.id === selectedId) ??
    null;

  function confirmPracticeDelete() {
    if (!practiceDeleteTarget || practiceDeleteInput !== 'DELETE') return;
    const next = practiceRecords.filter(r => r.id !== practiceDeleteTarget.id);
    setPracticeRecords(next);
    writePracticeRecords(userId, next);
    if (selectedId === practiceDeleteTarget.id) setSelectedId(null);
    getCurrentUserId().then(uid => { if (uid) deleteReport(practiceDeleteTarget.id, uid); });
    setPracticeDeleteTarget(null);
    setPracticeDeleteInput('');
  }

  function persist(next: HistoryRecord[]) {
    setRecords(next);
    writeJson(histKey, next);
  }

  function saveUpdated(updated: HistoryRecord) {
    persist(records.map(r => r.id === updated.id ? updated : r));
    setUpdateRecord(null);
    getCurrentUserId().then(uid => { if (uid) updateReport(updated, uid); });
  }

  function confirmDelete() {
    if (!deleteTarget || deleteInput !== 'DELETE') return;
    const trashedEntry: TrashEntry = { record: deleteTarget, deletedAt: new Date().toISOString() };
    persist(records.filter(r => r.id !== deleteTarget.id));
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setTrashRecords(prev => [trashedEntry, ...prev]);
    getCurrentUserId().then(uid => { if (uid) moveToTrash(deleteTarget.id, uid); });
    setDeleteTarget(null);
    setDeleteInput('');
  }

  function handleRestore(entry: TrashEntry) {
    setTrashRecords(prev => prev.filter(t => t.record.id !== entry.record.id));
    const next = [entry.record, ...records].sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
    );
    persist(next);
    getCurrentUserId().then(uid => { if (uid) restoreFromTrash(entry.record.id, uid); });
  }

  function confirmPermDelete() {
    if (!permDeleteTarget || permDeleteInput !== 'DELETE') return;
    setTrashRecords(prev => prev.filter(t => t.record.id !== permDeleteTarget.record.id));
    getCurrentUserId().then(uid => { if (uid) deleteReport(permDeleteTarget.record.id, uid); });
    setPermDeleteTarget(null);
    setPermDeleteInput('');
  }

  if (records.length === 0 && practiceRecords.length === 0 && trashRecords.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="history"
          title="No history yet"
          message="Complete grading a student — reports are saved automatically."
        />
      </Card>
    );
  }

  const sortedYears = [...tree.keys()].sort((a, b) => b - a);

  const treeRowBtn = 'w-full flex items-center gap-2 hover:bg-ink-50 dark:hover:bg-ink-800';

  return (
    <>
      {permDeleteTarget && (
        <ConfirmDeleteModal
          title="Delete Permanently"
          description={<><span className="font-medium text-ink-700 dark:text-ink-300">{permDeleteTarget.record.studentName}</span> — {permDeleteTarget.record.examTitle}</>}
          note="This cannot be undone."
          confirmLabel="Delete Forever"
          input={permDeleteInput}
          onInputChange={setPermDeleteInput}
          onConfirm={confirmPermDelete}
          onCancel={() => { setPermDeleteTarget(null); setPermDeleteInput(''); }}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title="Move to Trash"
          description={<><span className="font-medium text-ink-700 dark:text-ink-300">{deleteTarget.studentName}</span> — {deleteTarget.examTitle}</>}
          note="Report will be permanently deleted after 7 days."
          confirmLabel="Move to Trash"
          input={deleteInput}
          onInputChange={setDeleteInput}
          onConfirm={confirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteInput(''); }}
        />
      )}

      {practiceDeleteTarget && (
        <ConfirmDeleteModal
          title="Delete Practice Attempt"
          description={<><span className="font-medium text-ink-700 dark:text-ink-300">{practiceDeleteTarget.examTitle}</span> — {practiceDeleteTarget.percentage}%</>}
          note="This cannot be undone. Practice attempts do not go to Trash."
          confirmLabel="Delete Forever"
          input={practiceDeleteInput}
          onInputChange={setPracticeDeleteInput}
          onConfirm={confirmPracticeDelete}
          onCancel={() => { setPracticeDeleteTarget(null); setPracticeDeleteInput(''); }}
        />
      )}

      {updateRecord && (
        <UpdateModal
          record={updateRecord}
          hfApiKey={hfApiKey}
          geminiApiKey={geminiApiKey}
          onClose={() => setUpdateRecord(null)}
          onSave={saveUpdated}
        />
      )}

      <div className="max-w-5xl mx-auto animate-fade-in">
        {/* View toggle — students only have Practice, so there's nothing to switch between */}
        {role !== 'student' && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setView('history')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'history' ? 'bg-accent-700 text-white' : 'bg-white dark:bg-ink-900 text-ink-600 dark:text-ink-400 border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800'}`}
            >
              Archive
              {records.length > 0 && <span className="ml-1.5 text-xs opacity-75">({records.length})</span>}
            </button>
            <button
              onClick={() => { setView('practice'); setSelectedId(null); }}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'practice' ? 'bg-accent-700 text-white' : 'bg-white dark:bg-ink-900 text-ink-600 dark:text-ink-400 border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800'}`}
            >
              Practice
              {practiceRecords.length > 0 && <span className="ml-1.5 text-xs opacity-75">({practiceRecords.length})</span>}
            </button>
            <button
              onClick={() => setView('trash')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'trash' ? 'bg-red-600 text-white' : 'bg-white dark:bg-ink-900 text-ink-600 dark:text-ink-400 border border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-800'}`}
            >
              Trash
              {trashRecords.length > 0 && <span className="ml-1.5 text-xs opacity-75">({trashRecords.length})</span>}
            </button>
          </div>
        )}

        {/* ── Practice panel ──────────────────────────────────────────────── */}
        {view === 'practice' && (
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-ink-100 dark:border-ink-800">
                <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">Practice attempts</h3>
                <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">
                  Your own timed practice tests — kept separate from graded exams.
                </p>
              </div>
              {practiceRecords.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-ink-400 dark:text-ink-500">No practice attempts yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-ink-100 dark:divide-ink-800">
                  {practiceRecords.map(r => (
                    <div key={r.id} className="group relative">
                      <button
                        onClick={() => setSelectedId(r.id)}
                        className={`w-full text-left pl-5 pr-20 py-3 transition-colors ${
                          selectedId === r.id
                            ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                            : 'text-ink-600 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800'
                        }`}
                      >
                        <p className="text-sm font-medium truncate text-ink-800 dark:text-ink-200">{r.examTitle}</p>
                        <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">
                          {formatDate(r.savedAt)} · {r.percentage}% · {r.grade}
                          {r.examClass && ` · ${r.examClass}`}
                        </p>
                      </button>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); printReport(r); }}
                          title="Print report"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700"
                        >
                          <Icon name="print" className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setPracticeDeleteTarget(r); setPracticeDeleteInput(''); }}
                          title="Delete attempt"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-ink-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Icon name="trash" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div>
              {selected
                ? <RecordDetail record={selected} />
                : (
                  <Card className="py-20 text-center">
                    <p className="text-sm text-ink-400 dark:text-ink-500">Select an attempt to see the breakdown.</p>
                  </Card>
                )}
            </div>
          </div>
        )}

        {/* ── Trash panel ─────────────────────────────────────────────────── */}
        {view === 'trash' && (
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-ink-100 dark:border-ink-800">
              <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">Trash</h3>
              <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">Reports are permanently deleted 7 days after being trashed.</p>
            </div>
            {trashRecords.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm text-ink-400 dark:text-ink-500">Trash is empty.</p>
              </div>
            ) : (
              <div className="divide-y divide-ink-100 dark:divide-ink-800">
                {trashRecords.map(entry => {
                  const days = daysLeft(entry.deletedAt);
                  return (
                    <div key={entry.record.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-800 dark:text-ink-200 truncate">
                          {entry.record.studentName || 'Unknown'} — {entry.record.examTitle}
                        </p>
                        <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">
                          Deleted {formatDate(entry.deletedAt)} · {entry.record.examClass} {entry.record.studentSection}
                        </p>
                      </div>
                      <Badge className={days <= 1 ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'text-ink-500 dark:text-ink-400 bg-ink-50 dark:bg-ink-800 border-ink-200 dark:border-ink-700'}>
                        {days}d left
                      </Badge>
                      <button
                        onClick={() => handleRestore(entry)}
                        className="shrink-0 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => { setPermDeleteTarget(entry); setPermDeleteInput(''); }}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-ink-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete permanently"
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* ── Archive panel ───────────────────────────────────────────────── */}
        {view === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">
            {/* Tree */}
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-100 dark:border-ink-800">
                <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">Archive</h3>
                <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">{records.length} record{records.length !== 1 ? 's' : ''}</p>
              </div>

              <div className="py-1">
                {sortedYears.map(year => {
                  const classMap = tree.get(year)!;
                  const yearOpen = openYears.has(year);
                  return (
                    <div key={year}>
                      <button onClick={() => setOpenYears(toggleSet(openYears, year))}
                        className={`${treeRowBtn} px-4 py-2 text-sm font-semibold text-ink-700 dark:text-ink-300`}>
                        <Caret open={yearOpen} />
                        {year}
                      </button>

                      {yearOpen && [...classMap.keys()].map(cls => {
                        const sectionMap = classMap.get(cls)!;
                        const clsKey = `${year}-${cls}`;
                        const clsOpen = openClasses.has(clsKey);
                        return (
                          <div key={cls}>
                            <button onClick={() => setOpenClasses(toggleSet(openClasses, clsKey))}
                              className={`${treeRowBtn} pl-8 pr-4 py-1.5 text-sm text-ink-600 dark:text-ink-400`}>
                              <Caret open={clsOpen} />
                              {cls}
                            </button>

                            {clsOpen && [...sectionMap.keys()].map(sec => {
                              const subjectMap = sectionMap.get(sec)!;
                              const secKey = `${year}-${cls}-${sec}`;
                              const secOpen = openSections.has(secKey);
                              const secTotal = [...subjectMap.values()].reduce((n, arr) => n + arr.length, 0);
                              return (
                                <div key={sec}>
                                  <button onClick={() => setOpenSections(toggleSet(openSections, secKey))}
                                    className={`${treeRowBtn} pl-12 pr-4 py-1.5 text-xs text-ink-500 dark:text-ink-400`}>
                                    <Caret open={secOpen} />
                                    Section {sec}
                                    <span className="ml-auto text-ink-400">{secTotal}</span>
                                  </button>

                                  {secOpen && [...subjectMap.keys()].map(sub => {
                                    const subRecords = subjectMap.get(sub)!;
                                    const subKey = `${year}-${cls}-${sec}-${sub}`;
                                    const subOpen = openSubjects.has(subKey);
                                    return (
                                      <div key={sub}>
                                        <button onClick={() => setOpenSubjects(toggleSet(openSubjects, subKey))}
                                          className={`${treeRowBtn} pl-16 pr-4 py-1.5 text-xs text-ink-500 dark:text-ink-400 italic`}>
                                          <Caret open={subOpen} />
                                          <span className="truncate">{sub}</span>
                                          <span className="ml-auto text-ink-400 shrink-0">{subRecords.length}</span>
                                        </button>

                                        {subOpen && subRecords.map(r => (
                                          <div key={r.id} className="group relative">
                                            <button
                                              onClick={() => setSelectedId(r.id)}
                                              className={`w-full text-left pl-20 pr-20 py-2 transition-colors ${
                                                selectedId === r.id
                                                  ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                                                  : 'text-ink-600 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800'
                                              }`}
                                            >
                                              <p className="text-xs font-medium truncate">{r.studentName || 'Unknown'}</p>
                                              <p className="text-xs text-ink-400 dark:text-ink-500">{r.percentage}% · {r.grade}</p>
                                            </button>

                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
                                              <button
                                                onClick={e => { e.stopPropagation(); printReport(r); }}
                                                title="Print report"
                                                className="w-6 h-6 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700"
                                              >
                                                <Icon name="print" className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={e => { e.stopPropagation(); setUpdateRecord(r); }}
                                                title="Update answers"
                                                className="w-6 h-6 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700"
                                              >
                                                <Icon name="edit" className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={e => { e.stopPropagation(); setDeleteTarget(r); setDeleteInput(''); }}
                                                title="Delete report"
                                                className="w-6 h-6 flex items-center justify-center rounded-md text-ink-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                              >
                                                <Icon name="trash" className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Detail */}
            <div>
              {selected
                ? <RecordDetail record={selected} />
                : (
                  <Card className="py-20 text-center">
                    <p className="text-sm text-ink-400 dark:text-ink-500">Select a record from the archive to view details.</p>
                  </Card>
                )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
