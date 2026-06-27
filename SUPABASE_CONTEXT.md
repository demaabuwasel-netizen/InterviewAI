# PrepWise Supabase Context

This report is based on inspection of `server.js`, `app.js`, `public/app.js`, `package.json`, `.env.example`, `vercel.json`, `logging.js`, and `public/logging.js`.

No secret values from local `.env` files are included here.

## 1. Current Tech Stack

### Frontend

- No frontend framework.
- Plain HTML/CSS/JavaScript browser app.
- Primary deployed browser bundle is `public/index.html` plus `public/app.js`.
- Root `index.html` and `app.js` currently match the public copies, but Express serves from `public/`.
- UI dependencies are loaded by CDN in HTML:
  - Tailwind CDN
  - Lucide icons CDN
  - PDF.js CDN
- Browser APIs used:
  - `localStorage`
  - `fetch`
  - `FileReader`
  - Web Speech Recognition
  - Speech Synthesis
  - `history.pushState` / hash navigation

### Backend

- Node.js with Express 5.
- `server.js` is both local server and Vercel serverless entrypoint.
- Uses `dotenv` to read `.env` locally.
- Uses `openai` SDK server-side only.
- Static files served from `public/`.
- JSON request body limit is `1mb`.

### Deployment

- `vercel.json` routes all requests to `server.js` through `@vercel/node`.
- `server.js` serves static frontend files from `public/` and sends `public/index.html` for `/`.
- `.env.example` documents server-side `OPENAI_API_KEY`, optional `OPENAI_MODEL`, and `PORT`.

### Current API Routes

- `POST /api/interview-next-question`
- `POST /api/interview-clarify`
- `POST /api/practice-question`
- `POST /api/practice-feedback`
- `POST /api/parse-cv`
- `POST /api/final-report`
- `GET /`
- Static asset handling via `express.static(publicDir)`

### Current Storage Method

- All user/profile/session/report persistence is in browser `localStorage`.
- Guest users are memory-only and are not persisted by `saveUserData()`.
- Mouse analytics are temporarily stored in `localStorage` and sent to a hard-coded Google Apps Script endpoint.
- There is no real backend database yet.

## 2. Current localStorage Usage

### `prepwise_session_v3`

- Read in:
  - `checkAuth()` in `app.js` / `public/app.js`
- Written in:
  - `simulateSocialLogin()`
  - `handleAuth()`
  - `saveUserData()`
- Removed in:
  - `signOut()`
  - `deleteAccount()`
- Data shape:

```json
{
  "email": "student@example.com",
  "profile": {
    "name": "",
    "email": "",
    "field": "Software Engineering",
    "targetRole": "",
    "location": "",
    "phone": "",
    "summary": "",
    "skills": "",
    "courses": "",
    "projects": "",
    "experience": "",
    "linkedin": "",
    "certifications": "",
    "languages": "",
    "cvData": null
  },
  "sessions": [],
  "isGuest": false
}
```

- Notes:
  - `email` at the top level is the fake login identifier.
  - `profile.email` exists but is usually empty unless set through simulated social login or CV extraction.
  - `sessions` contains completed interview reports.
- Move to Supabase:
  - Yes. Replace with Supabase Auth session later.
  - In Phase 1 it can remain as a local cache while data is also backed up to Supabase.

### `prepwise_users_v3`

- Read in:
  - `handleAuth()`
  - `saveUserData()`
  - `deleteAccount()`
- Written in:
  - `handleAuth()`
  - `saveUserData()`
  - `deleteAccount()`
- Data shape:

```json
{
  "student@example.com": {
    "profile": { "...": "same shape as state.user" },
    "sessions": []
  }
}
```

- Notes:
  - This is the app's fake account database.
  - The object is keyed by email.
  - No password or auth verification exists.
- Move to Supabase:
  - Yes. This should become `profiles`, `interviews`, `interview_answers`, and `reports`.

### `prepwise_mouse_logs`

- Read in:
  - `Logger.saveMouseLogs()`
  - `Logger.syncMouseLogs()`
  - `Logger.exportMouseLogs()`
  - `Logger.getMouseLogStats()`
- Written in:
  - `Logger.saveMouseLogs()`
- Removed in:
  - `Logger.syncMouseLogs()`
- Data shape:

```json
[
  {
    "timestamp": "2026-06-27T00:00:00.000Z",
    "x": 123,
    "y": 456
  }
]
```

- Move to Supabase:
  - Optional.
  - If retained, use an `analytics_events` table with event metadata instead of raw long-term mouse tracking by default.

### `gemini_api_key`

- Read in:
  - `runAnalysis()`
- Written in:
  - Not written by the inspected app code.
- Data shape:
  - Plain string API key.
- Move to Supabase:
  - No.
  - This should not be in browser `localStorage` or Supabase client-readable data.
  - Any model API key should live only in server-side environment variables.

## 3. Current User/Profile Data Shape

### User Identity

Current fake identity is stored in `currentUser`:

- `email`
- `profile`
- `sessions`
- `isGuest`

Profile identity fields inside `state.user`:

- `name`
- `email`
- `phone`
- `location`
- `linkedin`

### Profile

Fields in `state.user`:

- `name`
- `email`
- `field`
- `targetRole`
- `location`
- `phone`
- `summary`
- `skills`
- `courses`
- `projects`
- `experience`
- `linkedin`
- `certifications`
- `languages`
- `cvData`

### Education

Education is structured inside `cvData.education`:

- `degree`
- `institution`
- `field`
- `startDate`
- `endDate`
- `details`

Profile UI collects education rows and writes them into `cvData.education`.

### Courses

- Free-text profile field: `state.user.courses`
- Structured CV field: `cvData.relevantCourses`, array of strings

### Skills

- Free-text profile field: `state.user.skills`
- Structured CV fields under `cvData.skills`:
  - `programmingLanguages`
  - `frameworks`
  - `tools`
  - `databases`
  - `softSkills`
  - `other`

### Projects

- Free-text profile field: `state.user.projects`
- Structured CV field: `cvData.projects`, array of:
  - `name`
  - `description`
  - `technologies`
  - `role`
  - `impact`

### Experience

- Free-text profile field: `state.user.experience`
- Structured CV field: `cvData.experience`, array of:
  - `title`
  - `organization`
  - `startDate`
  - `endDate`
  - `description`
  - `skillsUsed`

### Languages

- Free-text profile field: `state.user.languages`
- Structured CV field: `cvData.languages`, array of strings

### CV Extracted Data

Normalized `cvData` shape:

```json
{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "targetRole": "",
  "summary": "",
  "education": [],
  "relevantCourses": [],
  "skills": {
    "programmingLanguages": [],
    "frameworks": [],
    "tools": [],
    "databases": [],
    "softSkills": [],
    "other": []
  },
  "experience": [],
  "projects": [],
  "certifications": [],
  "languages": [],
  "missingFields": [],
  "confidence": {
    "name": "low",
    "education": "low",
    "skills": "low",
    "experience": "low",
    "projects": "low"
  }
}
```

## 4. Current Interview Data Flow

### How an Interview Starts

1. User signs in through fake email auth, simulated social login, or continues as guest.
2. User completes profile and optional CV import.
3. User goes through the setup wizard.
4. Wizard stores selections in memory:
   - `state.wizard.goal`
   - `state.wizard.jobDesc`
   - `state.wizard.style`
   - `state.wizard.mood`
   - `state.wizard.length`
   - `state.wizard.method`
5. `startWizardInterview()` copies wizard settings into:
   - `state.interviewMode`
   - `state.interviewerMood`
   - `state.job.description`
6. `startInterview()` resets `state.interview` with counters, arrays, timestamps, and stage metadata.
7. First question is requested from `/api/interview-next-question`.
8. If the API fails, a local fallback question is generated.

### Where Interview Settings Are Stored

Only in browser memory while the interview is active:

- `state.wizard`
- `state.interviewMode`
- `state.interviewerMood`
- `state.job.description`
- `state.interview.length`
- `state.interview.mainTarget`
- `state.interview.maxQuestions`
- `state.interview.maxFollowUps`

They are persisted only after completion, inside the saved session/report object.

### How Questions Are Generated

Frontend sends this to `/api/interview-next-question`:

```json
{
  "student_profile": {},
  "job_description": "",
  "interview_type": "hr",
  "interview_length": "short",
  "interviewer_style": "professional",
  "previous_question": "",
  "latest_student_answer": "",
  "full_transcript": [],
  "main_questions_asked": 0,
  "follow_ups_asked": 0,
  "total_questions_asked": 0,
  "current_stage": "opening",
  "asked_questions": [],
  "covered_job_requirements": [],
  "skipped_questions": []
}
```

Backend normalizes the profile/transcript, builds profile evidence, and asks OpenAI for structured JSON.

Response shape:

```json
{
  "next_question": "",
  "reason": "",
  "question_type": "opening",
  "interview_stage": "opening",
  "topic": "",
  "job_requirement": "",
  "is_follow_up": false
}
```

Frontend stores the result in:

- `interview.questions`
- `interview.questionMeta`
- `interview.transcript`
- `interview.askedQuestions`
- current stage/topic/reason/job requirement fields
- question counters

### How Answers Are Saved

When the user submits an answer:

1. `handleNextQuestion()` reads the answer from the text area.
2. It sets:
   - `interview.latestAnswer`
   - `interview.previousQuestion`
3. It appends the answer to `interview.transcript` as `{ role: "user", content: answer }`.
4. It appends a response object to `interview.responses`:

```json
{
  "question": "",
  "answer": "",
  "status": "answered",
  "feedback": "Analyzed",
  "stage": "",
  "topic": "",
  "jobRequirement": "",
  "clarificationRequested": false
}
```

5. If not complete, another question is requested.
6. The active interview is not persisted to `localStorage` until final report generation succeeds and `saveSession()` runs.

### How Skipped Questions Are Handled

When the user skips:

1. `skipQuestion()` sets `latestAnswer` to `[Question skipped]`.
2. It appends a user transcript item with `[Candidate skipped this question. This is not an answer.]`.
3. It creates a skipped record:

```json
{
  "question": "",
  "stage": "",
  "topic": "",
  "jobRequirement": ""
}
```

4. It pushes that record to `interview.skippedQuestions`.
5. It also pushes a response to `interview.responses`:

```json
{
  "question": "",
  "stage": "",
  "topic": "",
  "jobRequirement": "",
  "answer": "",
  "status": "skipped",
  "feedback": "Skipped"
}
```

6. Skipped questions are passed separately to `/api/final-report`.
7. Backend does not score skipped questions.

### How Final Report/Analysis Is Generated

1. `completeInterview()` moves the app to completion stage.
2. `generateFinalReport()` posts to `/api/final-report`:

```json
{
  "full_interview_transcript": [],
  "skipped_questions": [],
  "interview_type": "hr",
  "interview_length": "short",
  "job_description": "",
  "student_profile": {}
}
```

3. Backend always builds a local rubric report.
4. If OpenAI is configured, backend asks OpenAI for a structured final report.
5. Backend merges OpenAI output with the local rubric report, with local scoring taking precedence for many fields.
6. Frontend maps backend fields into `aiReport`.
7. `renderReportView(aiReport)` displays the report.
8. `saveSession(aiReport)` persists the session/report to localStorage through `saveUserData()`.

### Where the Final Report Is Stored

Stored inside the current user's `sessions` array in:

- `prepwise_users_v3[email].sessions`
- `prepwise_session_v3.sessions`

Saved session shape:

```json
{
  "date": "",
  "mode": "hr",
  "score": 0,
  "field": "",
  "jobDescription": "",
  "targetRole": "",
  "strengths": [],
  "weaknesses": [],
  "actionPlan": [],
  "bestAnswer": "",
  "weakestAnswer": "",
  "starExample": "",
  "questionReviews": [],
  "dimensionScores": {},
  "technicalGaps": [],
  "requirementsCovered": [],
  "requirementsToPractice": [],
  "recommendedPracticeQuestions": [],
  "skippedQuestions": [],
  "interviewLength": "short",
  "scoringSummary": "",
  "finalRecommendation": "",
  "responses": []
}
```

## 5. Current API Routes

### `POST /api/interview-next-question`

- Purpose:
  - Generate the next interview question.
- Requires OpenAI:
  - Yes.
- Request body:

```json
{
  "student_profile": {},
  "job_description": "",
  "interview_type": "",
  "interview_length": "short",
  "interviewer_style": "",
  "previous_question": "",
  "latest_student_answer": "",
  "full_transcript": [],
  "main_questions_asked": 0,
  "follow_ups_asked": 0,
  "total_questions_asked": 0,
  "current_stage": "",
  "asked_questions": [],
  "covered_job_requirements": [],
  "skipped_questions": []
}
```

- Response body:

```json
{
  "next_question": "",
  "reason": "",
  "question_type": "opening",
  "interview_stage": "opening",
  "topic": "",
  "job_requirement": "",
  "is_follow_up": false
}
```

- Supabase:
  - Phase 1: optionally save generated questions and transcript snapshots after the frontend receives them.
  - Long term: route should create/read `interviews` and `interview_answers` if server-managed sessions are implemented.

### `POST /api/interview-clarify`

- Purpose:
  - Rephrase the current question and explain what it checks.
- Requires OpenAI:
  - Yes.
- Request body:

```json
{
  "current_question": "",
  "interview_stage": "",
  "interview_type": "",
  "question_reason": "",
  "job_description": "",
  "student_profile": {}
}
```

- Response body:

```json
{
  "rephrased_question": "",
  "what_interviewer_checks": "",
  "answer_hint": ""
}
```

- Supabase:
  - Optional. Could store in `interview_answers.clarification` or `interview_events`.

### `POST /api/practice-question`

- Purpose:
  - Generate one practice question from a category/report weakness.
- Requires OpenAI:
  - Yes.
- Request body:

```json
{
  "focus": {
    "title": "",
    "type": "",
    "key": "",
    "role": "",
    "interviewMode": "",
    "score": null,
    "question": "",
    "answer": "",
    "improvement": "",
    "requirement": ""
  },
  "student_profile": {},
  "job_description": "",
  "recent_questions": []
}
```

- Response body:

```json
{
  "focus_title": "",
  "practice_question": "",
  "target_fix": "",
  "source": ""
}
```

- Supabase:
  - Optional now.
  - If practice history matters, create `practice_sessions`.

### `POST /api/practice-feedback`

- Purpose:
  - Score one practice answer and return short coaching feedback.
- Requires OpenAI:
  - Yes.
- Request body:

```json
{
  "focus": {
    "title": "",
    "improvement": "",
    "score": null
  },
  "practice_question": "",
  "answer": "",
  "student_profile": {},
  "job_description": ""
}
```

- Response body:

```json
{
  "score": 0,
  "strength": "",
  "fix": "",
  "next_try": ""
}
```

- Supabase:
  - Optional now.
  - Save if the product should show practice progress over time.

### `POST /api/parse-cv`

- Purpose:
  - Convert extracted CV text into structured profile data.
- Requires OpenAI:
  - Yes.
- Request body:

```json
{
  "cv_text": ""
}
```

- Response body:
  - Same as `cvData` shape:

```json
{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "targetRole": "",
  "summary": "",
  "education": [],
  "relevantCourses": [],
  "skills": {
    "programmingLanguages": [],
    "frameworks": [],
    "tools": [],
    "databases": [],
    "softSkills": [],
    "other": []
  },
  "experience": [],
  "projects": [],
  "certifications": [],
  "languages": [],
  "missingFields": [],
  "confidence": {
    "name": "low",
    "education": "low",
    "skills": "low",
    "experience": "low",
    "projects": "low"
  }
}
```

- Supabase:
  - Yes, if CV extraction should be recoverable.
  - Store extraction metadata and parsed JSON in `cv_extractions`.
  - Avoid storing raw CV text unless there is a clear privacy need and retention policy.

### `POST /api/final-report`

- Purpose:
  - Produce final interview assessment.
- Requires OpenAI:
  - No. It returns local rubric report if OpenAI is missing or fails.
- Request body:

```json
{
  "full_interview_transcript": [
    {
      "question": "",
      "answer": "",
      "status": "answered",
      "stage": "",
      "topic": "",
      "jobRequirement": ""
    }
  ],
  "skipped_questions": [],
  "interview_type": "",
  "interview_length": "short",
  "job_description": "",
  "student_profile": {}
}
```

- Response body:

```json
{
  "overall_score": 0,
  "top_strength": "",
  "main_improvement": "",
  "strengths": [],
  "improvements": [],
  "dimension_scores": {
    "communication_clarity": 0,
    "answer_structure": 0,
    "role_relevance": 0,
    "evidence_and_impact": 0,
    "technical_depth": 0
  },
  "technical_gaps": [],
  "job_requirements_covered": [],
  "job_requirements_to_practice": [],
  "recommended_practice_questions": [],
  "scoring_summary": "",
  "final_recommendation": "",
  "question_reviews": [],
  "action_plan": []
}
```

- Supabase:
  - Yes.
  - Best saved as `reports` plus normalized `interview_answers`.

### `GET /`

- Purpose:
  - Serve `public/index.html`.
- Supabase:
  - No.

### Static Files

- Purpose:
  - Serve assets from `public/`.
- Supabase:
  - No, unless later using Supabase Storage for uploaded CVs.

## 6. Recommended Supabase Tables

Use `uuid` primary keys, `timestamptz` timestamps, and JSONB for fast migration compatibility.

### `profiles`

- Purpose:
  - Store one application profile per auth user or anonymous app user.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `auth_user_id uuid unique null references auth.users(id) on delete cascade`
  - `email text`
  - `name text`
  - `phone text`
  - `location text`
  - `linkedin text`
  - `field text`
  - `target_role text`
  - `summary text`
  - `skills_text text`
  - `courses_text text`
  - `projects_text text`
  - `experience_text text`
  - `certifications_text text`
  - `languages_text text`
  - `education jsonb not null default '[]'::jsonb`
  - `structured_skills jsonb not null default '{}'::jsonb`
  - `structured_experience jsonb not null default '[]'::jsonb`
  - `structured_projects jsonb not null default '[]'::jsonb`
  - `cv_data jsonb`
  - `is_guest boolean not null default false`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Foreign keys:
  - `auth_user_id -> auth.users.id`, nullable until real auth.
- Notes:
  - `cv_data` keeps exact current app compatibility.
  - The normalized columns make querying easier later.

### `interviews`

- Purpose:
  - Store an interview attempt/session.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `profile_id uuid not null references profiles(id) on delete cascade`
  - `mode text not null`
  - `interviewer_style text`
  - `length text not null check (length in ('short', 'full'))`
  - `status text not null default 'started'`
  - `job_description text`
  - `target_role text`
  - `field text`
  - `settings jsonb not null default '{}'::jsonb`
  - `transcript jsonb not null default '[]'::jsonb`
  - `asked_questions jsonb not null default '[]'::jsonb`
  - `covered_job_requirements jsonb not null default '[]'::jsonb`
  - `started_at timestamptz not null default now()`
  - `completed_at timestamptz`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Foreign keys:
  - `profile_id -> profiles.id`
- JSONB:
  - `settings` can store wizard settings and counters.
  - `transcript` preserves the current assistant/user transcript format.

### `interview_answers`

- Purpose:
  - Store each question and answer, including skipped questions.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `interview_id uuid not null references interviews(id) on delete cascade`
  - `question_index integer not null`
  - `question text not null`
  - `answer text`
  - `status text not null check (status in ('answered', 'skipped'))`
  - `stage text`
  - `topic text`
  - `job_requirement text`
  - `question_type text`
  - `is_follow_up boolean not null default false`
  - `reason text`
  - `clarification_requested boolean not null default false`
  - `clarification jsonb`
  - `duration_seconds integer`
  - `review jsonb`
  - `score numeric(4,1)`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Foreign keys:
  - `interview_id -> interviews.id`
- Constraints:
  - Unique index on `(interview_id, question_index)`.

### `reports`

- Purpose:
  - Store final report generated from an interview.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `interview_id uuid not null unique references interviews(id) on delete cascade`
  - `profile_id uuid not null references profiles(id) on delete cascade`
  - `overall_score numeric(4,1) not null default 0`
  - `score_label text`
  - `top_strength text`
  - `main_improvement text`
  - `strengths jsonb not null default '[]'::jsonb`
  - `improvements jsonb not null default '[]'::jsonb`
  - `action_plan jsonb not null default '[]'::jsonb`
  - `best_answer text`
  - `weakest_answer text`
  - `star_example text`
  - `dimension_scores jsonb not null default '{}'::jsonb`
  - `technical_gaps jsonb not null default '[]'::jsonb`
  - `requirements_covered jsonb not null default '[]'::jsonb`
  - `requirements_to_practice jsonb not null default '[]'::jsonb`
  - `recommended_practice_questions jsonb not null default '[]'::jsonb`
  - `question_reviews jsonb not null default '[]'::jsonb`
  - `skipped_questions jsonb not null default '[]'::jsonb`
  - `responses jsonb not null default '[]'::jsonb`
  - `scoring_summary text`
  - `final_recommendation text`
  - `raw_report jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Foreign keys:
  - `interview_id -> interviews.id`
  - `profile_id -> profiles.id`
- Notes:
  - `raw_report` lets Phase 1 save the app's existing `aiReport` shape without losing fields.

### `practice_sessions`

- Purpose:
  - Optional storage for practice questions and feedback.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `profile_id uuid not null references profiles(id) on delete cascade`
  - `source_report_id uuid references reports(id) on delete set null`
  - `focus jsonb not null default '{}'::jsonb`
  - `practice_question text not null`
  - `answer text`
  - `score numeric(4,1)`
  - `strength text`
  - `fix text`
  - `next_try text`
  - `job_description text`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Foreign keys:
  - `profile_id -> profiles.id`
  - `source_report_id -> reports.id`

### `cv_extractions`

- Purpose:
  - Store CV parsing results and optional metadata.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `profile_id uuid not null references profiles(id) on delete cascade`
  - `source_type text not null check (source_type in ('pdf_text', 'pasted_text', 'manual'))`
  - `file_name text`
  - `raw_text_hash text`
  - `parsed_data jsonb not null default '{}'::jsonb`
  - `missing_fields jsonb not null default '[]'::jsonb`
  - `confidence jsonb not null default '{}'::jsonb`
  - `applied_to_profile boolean not null default false`
  - `created_at timestamptz not null default now()`
- Foreign keys:
  - `profile_id -> profiles.id`
- Notes:
  - Prefer storing `raw_text_hash`, not raw CV text.
  - Store raw CV files/text only if product requirements justify it.

### `analytics_events`

- Purpose:
  - Optional replacement for Google Sheets logging.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `profile_id uuid references profiles(id) on delete set null`
  - `interview_id uuid references interviews(id) on delete set null`
  - `event_type text not null`
  - `event_payload jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`
- Foreign keys:
  - `profile_id -> profiles.id`
  - `interview_id -> interviews.id`
- Notes:
  - Avoid storing raw mouse movements unless truly needed.

## 7. Security Plan

### Frontend Key

- If using Supabase directly in the browser, the frontend may use:
  - Supabase project URL
  - Supabase anon publishable key
- The anon key is designed to be public, but it must be protected by Row Level Security.

### Server-Side Only Keys

Keep these only in server-side environment variables:

- `OPENAI_API_KEY`
- Supabase `service_role` key, if used
- Any Gemini/Ollama/cloud model API key
- Any admin or migration credentials

### Row Level Security

RLS is needed for all user-owned tables:

- `profiles`
- `interviews`
- `interview_answers`
- `reports`
- `practice_sessions`
- `cv_extractions`
- `analytics_events`

Policies should restrict rows by `auth.uid() = profiles.auth_user_id`.

For the pre-auth phase, do not expose broad write access from the browser. Prefer server-side save endpoints using a temporary user identifier, or keep writes local until real auth is ready.

### Avoiding Secret Exposure

- Do not put OpenAI or service-role keys in frontend JS, `config.js`, HTML, localStorage, or Supabase tables readable by clients.
- Do not send `.env` values to the browser.
- Validate and trim all request bodies server-side, as `server.js` already does.
- If adding Supabase writes through `server.js`, use the service role only inside backend routes.
- Do not store raw CV text unless needed. Parsed profile JSON is usually enough.

## 8. Migration Plan

### Phase 1: Keep localStorage, Add Supabase Backup Saving

- Keep existing app behavior unchanged.
- Add backend Supabase client in `server.js`.
- Add save endpoints such as:
  - `POST /api/profile-backup`
  - `POST /api/interview-backup`
  - `POST /api/report-backup`
- After `saveUserData()` and `saveSession()`, call backup endpoints.
- Continue reading from localStorage.
- Use an app-generated `profile_id` or email mapping only as a temporary bridge.
- Preserve full current JSON shapes in JSONB columns to reduce migration risk.

### Phase 2: Read History/Reports From Supabase

- On login/session load, fetch profile and reports from Supabase through backend routes.
- Fall back to localStorage if Supabase is unavailable.
- Make history page read from Supabase-backed reports.
- Keep localStorage as a cache.
- Add reconciliation logic:
  - If localStorage has sessions not in Supabase, upload them.
  - If Supabase has newer reports, use Supabase as source of truth.

### Phase 3: Optional Auth / Real User Accounts

- Replace fake email login with Supabase Auth.
- Use `auth.users.id` as the owner for `profiles`.
- Enable RLS policies.
- Migrate fake `prepwise_users_v3` records by email into real accounts when users sign in.
- Remove any browser-stored API key logic.

## 9. Risks

- Vercel routes:
  - `vercel.json` sends all requests to `server.js`; adding routes must not break static serving from `public/`.
  - Serverless functions have execution time limits, relevant for OpenAI report generation and CV parsing.

- Frontend API calls:
  - Current code assumes same-origin `/api/...` endpoints and JSON responses.
  - Any Supabase route failures should not block existing localStorage flow in Phase 1.

- localStorage fallback:
  - Current active interview state is memory-only until report save.
  - If Supabase writes happen during the interview, partial/interrupted sessions need clear `status` handling.

- OpenAI report generation:
  - `/api/final-report` can return local rubric output without OpenAI.
  - Supabase save logic should store whichever report path succeeds.
  - Do not make report saving depend on OpenAI-specific fields only.

- Missing user ID/auth:
  - Current fake auth only has email and guest state.
  - Without real auth, user identity is not trustworthy.
  - Do not rely on client-provided email for secure multi-user access.

- CV privacy:
  - CVs can contain sensitive personal data.
  - Avoid storing raw CV text/files until privacy rules and retention are defined.

- Existing analytics:
  - `logging.js` sends data to Google Apps Script and stores mouse logs in localStorage.
  - Moving this to Supabase without consent/retention rules may increase privacy risk.

- Legacy AI path:
  - `runAnalysis()` still checks `window.PREPWISE_CONFIG?.GEMINI_API_KEY` or `localStorage.gemini_api_key` while most AI routes now use server-side OpenAI.
  - This should be cleaned up before relying on production secrets, but not as part of the database migration.

## 10. Final Recommendation

The simplest Supabase setup that works without overengineering:

1. Start with four tables:
   - `profiles`
   - `interviews`
   - `interview_answers`
   - `reports`

2. Use JSONB generously at first:
   - Store current `state.user.cvData` in `profiles.cv_data`.
   - Store the current saved session/report object in `reports.raw_report`.
   - Store transcript snapshots in `interviews.transcript`.

3. Keep localStorage as the primary read source during Phase 1:
   - Supabase should be backup-only until the data model proves stable.

4. Add real Supabase Auth only after report backup/history works:
   - The current fake auth is useful for development but not secure identity.

5. Keep all AI and service keys server-side:
   - Frontend can eventually use only the Supabase anon key with RLS.
   - OpenAI and Supabase service role must stay in backend environment variables.

This gives PrepWise durable reports and profile backup quickly while avoiding a full auth rewrite or UI redesign.
