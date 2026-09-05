# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # dev server at localhost:5173
npm run build      # tsc type-check + vite production build
npm run preview    # serve the production build locally
```

There are no tests or linting scripts configured.

After every set of changes: run `npm run build` to confirm TypeScript and the Vite build both pass before committing.

## Git workflow

Commit and push to GitHub after every meaningful unit of work. Never leave work uncommitted at the end of a session. This project has no staging environment; GitHub is the source of truth and Vercel redeploys on every push to `main`.

Always run locally and get approval from the user before pushing to GitHub.

Commit message format:
- `feat:` — new feature or behaviour
- `fix:` — bug fix
- `chore:` — config, deps, tooling
- `docs:` — documentation only

Keep messages concise and specific about *what changed and why*. Always end commits with:
```
Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>
```

## Deployment

Hosted on Vercel, linked to GitHub. Every `git push` to `main` triggers an automatic redeploy. Live URL: **https://exam-checker-virid.vercel.app**

To deploy manually: `vercel --prod`

Environment variables (set in Vercel dashboard, never committed):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase auth
- `VITE_GEMINI_API_KEY` — AI API key (build-time default; users can also enter their own key in Setup)
- `VITE_HF_API_KEY` — HuggingFace API key (optional fallback for similarity)
- `VITE_ADMIN_EMAIL` — email address that gets admin panel access

## Architecture

**Pure frontend SPA** — no backend of our own. React 18 + Vite + TypeScript + Tailwind CSS (class-based dark mode, zinc + purple design tokens). Supabase for auth and cloud sync; Gemini for all AI.

### Folder structure

```
src/
├── app/            App root, shell, error boundary, access screens, dark mode
│   ├── App.tsx         Auth/session orchestration, lazy view routing
│   ├── AppShell.tsx    Header, tab nav, mobile drawer, footer, Logo
│   ├── ErrorBoundary.tsx
│   ├── AccessScreens.tsx
│   └── useDarkMode.ts
├── components/
│   ├── ui/         Design-system primitives shared by every feature
│   │   ├── index.tsx   Button, Card, Modal, Alert, Badge, inputs, Spinner,
│   │   │               EmptyState, ProgressBar, ConfirmDeleteModal
│   │   └── Icon.tsx    Named SVG icon set (PATHS map) + Caret
│   └── PageUploader.tsx  Answer-sheet thumbnails, reorder, lightbox
│                         (shared by Grade and Practice)
├── config/
│   ├── env.ts          Single source for import.meta.env + resolveGeminiKey()
│   └── constants.ts    CLASS_OPTIONS, CHECKING_MODES, grade/status colors
├── context/
│   ├── ExamContext.tsx      Global exam session state
│   └── PracticeContext.tsx  Practice-test state machine + persistence
├── features/       One folder per screen/domain
│   ├── auth/           AuthGate, PasswordResetScreen, ProfileView
│   ├── landing/        LandingPage + videos
│   ├── setup/          ExamSetup, QuestionEditorCard (shared with bank), SubPartsEditor
│   ├── grading/        GradingView, InfoModal
│   ├── report/         ReportView, printReport.ts (shared print/PDF builder)
│   ├── history/        HistoryView, RecordDetail, UpdateModal
│   ├── analytics/      AnalyticsView, StudentChart
│   ├── bank/           QuestionBankView
│   ├── paper/          QuestionPaperBuilder
│   ├── practice/       PracticeView (phase router), SourceStep, BlueprintEditor,
│   │                   PaperPreview, TestRunner, PracticeReportView,
│   │                   useCountdown.ts, practiceReport.ts
│   └── admin/          AdminPanel
├── services/
│   ├── ai/             All Gemini calls
│   │   ├── client.ts       GEMINI_MODEL, geminiUrl, callGemini, filePart, extractJson
│   │   ├── grading.ts      segmentAndGradeAll, gradeExtractedText
│   │   ├── authoring.ts    generateModelAnswer, refineAnswer, extractQuestionsFromFile
│   │   ├── practice.ts     extractChapterText (chapter → prose),
│   │   │                   generatePracticePaper (prose + blueprint → Q + A)
│   │   ├── ocr.ts          Gemini OCR + lazy Tesseract fallback
│   │   └── similarity.ts   Gemini → HuggingFace → keyword Jaccard
│   ├── data/           Supabase + persistence
│   │   ├── supabase.ts     Client init (try/catch), getCurrentUserId
│   │   ├── access.ts       User access checks (throws on network error)
│   │   ├── reports.ts / stats.ts / questionBank.ts / demo.ts
│   ├── media/videoExtractor.ts   Video → page JPEGs (luminance MAD stability)
│   └── storage.ts      readJson/writeJson (safe localStorage) + storageKeys
├── types/          Shared domain types
└── utils/scoring.ts    calculateMarksByMode
```

Views are code-split: every feature view is loaded via `React.lazy` in `App.tsx`; `vite.config.ts` splits `react` and `supabase` vendor chunks. tesseract.js is dynamically imported only on the OCR fallback path.

### Tabs / Pages

| Tab | Component | Purpose |
|---|---|---|
| Setup | `ExamSetup` | Configure exam, select/create questions, set checking mode, enter student info |
| Grade | `GradingView` | Upload answer sheet pages or video, AI grades all questions in one call |
| Report | `ReportView` | Totals, grade, per-question breakdown, print/PDF export |
| History | `HistoryView` | All past reports, organised by year → class → section → subject |
| Analytics | `AnalyticsView` | Performance trends across exams and subjects |
| Question Bank | `QuestionBankView` | Save/load questions by subject and chapter for reuse |
| Paper Builder | `QuestionPaperBuilder` | Assemble a printable question paper from the bank |
| Practice | `PracticeView` | Upload a chapter → generate a paper → sit a timed test → get a report |
| Admin | `AdminPanel` | Manage user access (admin only) |

Setup/Grade/Report/History/Analytics are the main tab row (`BASE_TABS` in `App.tsx`).
Practice, Question Bank and Paper Builder are header tools (`TOOL_TABS` in `AppShell.tsx`),
rendered as pills top-right and in the mobile drawer's tool group.

### Data flow

1. **Setup** (`ExamSetup`): Teacher enters exam term, class, student info, and selects questions from the bank or creates new ones. Sets checking mode. Dispatches `SET_ANSWER_KEY` + supporting actions to global context, then navigates to Grade.

2. **Grade** (`GradingView`): Teacher uploads answer sheet as images OR a video. Two upload modes:
   - **Images**: select one or more photos in page order; reorder with ▲▼.
   - **Video**: record a slow flip-through video; `services/media/videoExtractor.ts` detects stable frames via luminance MAD and extracts one JPEG per page automatically.
   - Tapping **Evaluate** calls `segmentAndGradeAll()` — a single Gemini API call that reads all page images, finds each answer by student-written labels (Q1, 1., Ans 1 …), and grades every question at once.
   - Each result card shows extracted text (editable). Editing and tapping **Re-evaluate** calls `gradeExtractedText()` (text-only re-grade, no image).
   - Unanswered questions can be skipped via the "Mark unanswered" panel (receives 0, no API call).
   - Tapping **Generate Report** dispatches `UPDATE_QUESTION_RESULT` for each question then navigates to Report.

3. **Report** (`ReportView`): Reads results from context, auto-saves to localStorage + Supabase once per `sessionId`, shows totals and per-question table; print/PDF via the shared `printReport()` helper (also used by HistoryView).

### Practice tests (`src/features/practice/`, `src/context/PracticeContext.tsx`)

A self-practice loop that reuses the whole grading/report engine unchanged:

1. **Source** — upload a chapter PDF/image/txt (≤ 15 MB). `extractChapterText()` transcribes it to plain prose in one call and the result is **cached in state**, so regenerating never re-uploads the file. PDFs use a hardcoded `application/pdf` mime (mobile pickers return an empty `file.type`).
2. **Blueprint** — repeatable `[N] questions × [M] marks` rows with live totals. Capped at `PRACTICE_MAX_QUESTIONS` (25) and `PRACTICE_MAX_TOTAL_MARKS` (150).
3. **Generate** — `generatePracticePaper()` expands the blueprint into an enumerated **slot list** (small models drift on "5 questions of 2 marks" but follow a numbered table). Marks are re-stamped **positionally from the slots**, never read from the model, so totals are arithmetically guaranteed.
4. **Preview** — save to the Question Bank via the existing `saveChapter()`, or start the test.
5. **Test** — `useCountdown` is **deadline-timestamp based**, recomputing from `Date.now()` each tick so a throttled tab and a page reload both stay correct. Auto-submits once via a `firedRef` guard.
6. **Grade** — typed answers go through `gradeExtractedText` (blank ones are excluded from the request); photos go through `segmentAndGradeAll`. Both converge on `finalizeResults()`, producing the same `QuestionResult[]` GradingView dispatches.

**Critical invariant — generated keywords must be filtered to verbatim substrings of their own `expectedAnswer`.** `GRADING_RULES` in `services/ai/grading.ts` caps a score at 0.5 when any listed keyword is missing from the student's answer, so a hallucinated keyword would silently halve every score. `coerceGenerated()` in `services/ai/practice.ts` enforces this — do not remove it.

**Practice reports are stored separately** from graded exams:

| Layer | Graded exams | Practice attempts |
|---|---|---|
| localStorage | `storageKeys.history` | `storageKeys.practiceHistory` |
| Supabase | `reports` table, no `kind` | same table, `kind: 'practice'` |
| History tab | Archive tree | Practice section (flat) |
| Analytics | included | filtered out |
| `incrementUserStats` | fires | skipped |

Because both kinds share the `reports` table, **every `loadReports()` caller must filter on `kind`** — HistoryView splits the result into two lists, AnalyticsView drops practice entirely.

### Global state (`src/context/ExamContext.tsx`)

`useReducer`-based context split into two contexts (state + dispatch) to avoid unnecessary re-renders. Access via `useExam()` and `useExamDispatch()`. All session data lives here and is reset by `RESET_SESSION`.

Key state fields: `answerKey`, `results`, `activeTab`, `geminiApiKey`, `hfApiKey`, `checkingMode`, `examTerm`, `examClass`, `studentName`, `studentSection`, `studentId`, `sessionId`.

**Important**: `geminiApiKey` is never persisted to `localStorage` — it lives in memory only for the session (security). It is initialised from `VITE_GEMINI_API_KEY` at build time; the user can override it in Setup → Advanced Settings for that session only. Always resolve the key with `resolveGeminiKey(contextKey)` from `config/env.ts`.

### AI services (`src/services/ai/`)

- **`client.ts`** — Single source of truth for the model ID (`GEMINI_MODEL = 'gemini-3.1-flash-lite-preview'` — do NOT change it; this model is confirmed working), `geminiUrl(apiKey)`, `callGemini(apiKey, parts, config, signal)` (one fetch wrapper used by every AI call), `fileToBase64`/`filePart`, and `extractJson(raw, 'object' | 'array')` (depth-based JSON extraction from model output).
- **`grading.ts`** — `segmentAndGradeAll(pages, questions, apiKey, signal)` (primary batch path) and `gradeExtractedText(inputs, apiKey, signal)` (text-only re-grade).
- **`authoring.ts`** — model-answer generation, answer refinement (shorten/define), question extraction from image/PDF/txt files.
- **`ocr.ts`** — `extractTextFromImage` (Gemini primary, Tesseract lazy-imported fallback), `terminateOCRWorker()` (called on `beforeunload`).
- **`similarity.ts`** — `getSemanticSimilarity`: Gemini → HuggingFace → keyword-weighted Jaccard.

All fetch calls accept an `AbortSignal` so in-flight requests are cancelled on navigation.

### Scoring logic (`src/utils/scoring.ts`)

`calculateMarksByMode(similarity, mode, maxMarks)`

```
Easy:    ratio = max(0, 1 − (2/3)(1−s))     — dampened penalty
Medium:  ratio = s                            — exact linear
Firm:    ratio = max(0, 1.5s − 0.5)          — midpoint of medium and strict
Strict:  ratio = max(0, 2s − 1)              — doubled penalty
```

All modes round to the nearest 0.5-mark increment: `Math.round(ratio × maxMarks × 2) / 2`

**Firm** is the practice-test default — a little harder than a real exam without
Strict's cliff (Strict awards zero at 50% similarity; Firm not until 33%). It is
offered only in the Practice screen's selector (`PRACTICE_MODES`); Setup's
teacher-facing selector stays at `CHECKING_MODES` (easy/medium/strict).
`MODE_LABELS` is typed `Record<CheckingMode, …>`, so adding a mode is a compile
error until its label exists — keep it that way.

### Auth (`src/services/data/supabase.ts`, `src/features/auth/AuthGate.tsx`, `src/app/App.tsx`)

Supabase client is initialized at module load inside a try/catch. If env vars are missing or placeholder values, `supabase` is exported as `null` and the app skips auth (shows a yellow banner). `AuthGate` has five views: `login`, `signup`, `forgot`, `verify-sent`, `reset-sent`.

**Network resilience**: `App.tsx` wraps `getSession()` in a `.catch` plus an 8-second timeout (`AUTH_TIMEOUT_MS`) so an unreachable Supabase project can never hang the app on "Loading…". When auth is unreachable the app degrades to authless mode with a warning banner, and the access check fails open. Keep this behaviour when touching startup code.

### Dark mode (`src/app/useDarkMode.ts`)

`useDarkMode` hook lives at the top-level `App` component (not inside the session-scoped tree) so it survives session-driven remounts. Applies `dark` class to `document.documentElement` synchronously in the `useState` initializer to avoid flash. Preference persisted in `localStorage`.

### Key patterns to preserve

- **Never persist API keys to `localStorage`** — store in context (memory) only.
- **All localStorage access goes through `src/services/storage.ts`** (`readJson`/`writeJson`/`readString`/`writeString` + `storageKeys`) — these already handle try/catch, corrupted JSON, and `QuotaExceededError`. Never call `localStorage` directly in features.
- **Object URLs must be revoked**: use a `ref` pattern in cleanup `useEffect`s so the cleanup always sees the latest URL even with an empty dependency array.
- **Long-running fetch calls must accept `AbortSignal`** — pass it from an `AbortController` stored in a ref.
- **Model ID lives only in `services/ai/client.ts`** — never hardcode the model string elsewhere, and never change it.
- **UI primitives live in `components/ui`** — use `Button`, `Card`, `Modal`, `Alert`, `Badge`, `TextInput`, etc. instead of hand-rolling Tailwind for common patterns; icons come from `components/ui/Icon.tsx`.
- **New Gemini calls go through `callGemini` in `services/ai/client.ts`** — never write a raw fetch to the Gemini endpoint.
- **Practice state never writes `ExamContext`** — it only reads `geminiApiKey`. `RESET_SESSION` (the Report tab's "New Exam" button) must never be able to destroy a test in progress.
- **`PracticeProvider` sits above the `activeTab` conditional in `App.tsx`** — views mount behind `{activeTab === … && …}`, so component-local state dies on every tab switch.
- **AI-generated keywords are filtered against their own model answer** — see the grading-cap invariant above.
