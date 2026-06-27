# PrepWise Supabase Auth Context

This report extends `SUPABASE_CONTEXT.md` with a Supabase Auth and Google OAuth plan. It is planning-only: no app code, package files, or environment files have been changed.

No API keys, OAuth secrets, or `.env` values are included here.

## 1. Current Project Summary

### Current Frontend Setup

- PrepWise is a plain browser JavaScript app with no frontend framework.
- The deployed frontend is served from `public/index.html` and `public/app.js`.
- Root `index.html` and `app.js` currently match the public copies, but Express serves `public/`.
- Frontend dependencies are loaded by CDN:
  - Tailwind
  - Lucide
  - PDF.js
- Browser APIs currently used:
  - `localStorage`
  - `fetch`
  - `FileReader`
  - Web Speech Recognition
  - Speech Synthesis
  - History/hash routing

### Current Backend Setup

- `server.js` is a Node/Express backend.
- It serves static frontend assets from `public/`.
- It exposes AI API routes under `/api/...`.
- It uses the OpenAI SDK server-side only.
- It reads local `.env` through `dotenv`.
- It does not currently connect to a database.

### Current Vercel Setup

- `vercel.json` routes all requests to `server.js`.
- `server.js` is configured for `@vercel/node`.
- `GET /` serves `public/index.html`.
- Static assets are served by `express.static(publicDir)`.

### Current localStorage Usage

- `prepwise_session_v3`
  - Active fake login session.
  - Stores email, profile, sessions, and guest flag.
- `prepwise_users_v3`
  - Fake local user database keyed by email.
  - Stores each profile and session history.
- `prepwise_mouse_logs`
  - Temporary mouse tracking records used by `logging.js`.
- `gemini_api_key`
  - Read by legacy `runAnalysis()` logic.
  - Should not be kept in browser storage long term.

### Current API Routes

- `POST /api/interview-next-question`
  - Generates next interview question.
- `POST /api/interview-clarify`
  - Rephrases/explains the current interview question.
- `POST /api/practice-question`
  - Generates a practice question.
- `POST /api/practice-feedback`
  - Scores a practice answer.
- `POST /api/parse-cv`
  - Parses extracted CV text into structured profile data.
- `POST /api/final-report`
  - Generates or locally builds the final interview report.
- `GET /`
  - Serves the app shell.

## 2. Google Sign Up/Login Plan

### Simplest User Flow

1. User opens PrepWise.
2. App initializes Supabase client in the browser with the Supabase URL and anon key.
3. App checks `supabase.auth.getSession()` on page load.
4. If a valid session exists:
   - Set logged-in user state from `session.user`.
   - Load or create the user's `profiles` row.
   - Load saved history when ready.
   - Show dashboard.
5. If no valid session exists:
   - Show the auth view.
   - Offer "Continue with Google".
   - Optionally keep temporary guest/local mode during migration.
6. User clicks "Continue with Google".
7. Browser calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
8. Supabase redirects to Google.
9. Google redirects back to the configured PrepWise callback URL.
10. Supabase stores the browser auth session.
11. App detects the session, creates/loads the profile, and redirects to dashboard.

### Continue with Google Button

- Add a visible button on the existing auth view.
- The button should call a new auth function, for example `signInWithGoogle()`.
- It should not ask the user for a password.
- It should not use the existing fake email auth path.

### Supabase Auth Google OAuth

- Use Supabase Auth as the OAuth broker.
- The browser should call Supabase Auth directly using the anon key.
- Google client secret should only be entered in the Supabase dashboard, not in this repo.

### Session Detection on Page Load

- Current `checkAuth()` reads `prepwise_session_v3`.
- With Supabase Auth, `checkAuth()` should first check Supabase:
  - `supabase.auth.getSession()`
  - `supabase.auth.onAuthStateChange(...)`
- If a Supabase session exists, it should take priority over local fake users.
- If no Supabase session exists, the app can fall back to guest/local mode temporarily.

### Logout Button

- Existing `signOut()` removes `prepwise_session_v3` and reloads.
- New logout behavior should call:
  - `supabase.auth.signOut()`
  - clear only local app cache that belongs to the previous user
  - redirect to the auth view or root path
- Do not delete the user's Supabase data on normal logout.

### Logged-In User State

Current app state:

```json
{
  "currentUser": {
    "email": "",
    "profile": {},
    "sessions": [],
    "isGuest": false
  },
  "user": {},
  "sessions": []
}
```

Recommended auth-aware state:

```json
{
  "currentUser": {
    "id": "auth.users.id",
    "email": "user@example.com",
    "provider": "google",
    "profile": {},
    "sessions": [],
    "isGuest": false
  },
  "supabaseSession": {
    "access_token": "managed by Supabase client",
    "user": {
      "id": "auth.users.id",
      "email": "user@example.com"
    }
  }
}
```

Do not manually store access tokens in custom localStorage keys. Let the Supabase JS client manage the auth session.

### Redirect After Login

- Local development redirect should return to local app origin, for example:
  - `http://127.0.0.1:3000/`
  - `http://localhost:3000/`
- Production redirect should return to the production Vercel domain.
- After the app detects the session, it should navigate to dashboard.
- If using hash routing, avoid relying on OAuth redirecting directly to a hash route. Redirect to `/`, then call `showDashboard()`.

### Redirect After Logout

- Logout should return to:
  - `/` auth view, or
  - a clean root URL with no interview/report hash
- Existing in-progress interview state should be cleared on logout.

### If the User Is Not Logged In

- Short term:
  - Show auth view.
  - Allow guest/local mode if desired.
  - Keep localStorage mode to avoid breaking the current app.
- Long term:
  - Require login to save profiles, reports, CV data, practice history, and interview history.
  - Optionally allow one guest interview with local-only storage.

### Should Guest/Local Mode Still Work Temporarily?

Yes. Keep guest/local mode during migration.

Reason:

- The current AI interview flow works without a database.
- Supabase Auth/OAuth setup often fails first because of redirect URL mismatch.
- Keeping local mode prevents OAuth setup issues from blocking the existing product.

The eventual product decision can be:

- Guests can practice but cannot save history across devices.
- Google users get durable profile, CV, report, interview, and practice history.

## 3. Supabase Configuration Needed

These steps are manual Supabase dashboard configuration. Do not commit any provider secrets.

### Enable Google Provider

In Supabase:

1. Go to Authentication.
2. Go to Providers.
3. Enable Google.
4. Enter the Google OAuth Client ID.
5. Enter the Google OAuth Client Secret.
6. Save provider settings.

### Google OAuth Client ID / Secret

Create these in Google Cloud Console:

- OAuth client type: Web application.
- Authorized JavaScript origins should include local and production origins.
- Authorized redirect URI must include Supabase's OAuth callback URL shown in the Supabase Google provider setup.

Do not put the Google client secret in this repo, frontend code, `.env.example`, or Vercel frontend variables.

### Site URL

In Supabase Auth URL configuration:

- Set Site URL to the primary production URL once production is known.
- For local-only testing before production, Site URL can be the local origin, but production should be updated before deployment.

Example placeholders:

- Local: `http://127.0.0.1:3000`
- Production: `https://YOUR-PRODUCTION-VERCEL-DOMAIN`

Do not use these placeholders as actual secret values; replace only in the Supabase dashboard.

### Redirect URLs for Local Development

Add all local origins you actually use:

- `http://127.0.0.1:3000`
- `http://127.0.0.1:3000/`
- `http://localhost:3000`
- `http://localhost:3000/`

If local dev ever uses another port, add that exact origin too.

### Redirect URLs for Vercel Production

Add the exact production URL:

- `https://YOUR-PRODUCTION-VERCEL-DOMAIN`
- `https://YOUR-PRODUCTION-VERCEL-DOMAIN/`

If a custom domain is used, add the custom domain too:

- `https://YOUR-CUSTOM-DOMAIN`
- `https://YOUR-CUSTOM-DOMAIN/`

### Redirect URLs for Vercel Preview

For preview deployments, either:

- Add exact preview URLs when testing, or
- Use a wildcard pattern if supported/appropriate in Supabase redirect settings.

Preview URLs differ per deployment, so OAuth can fail in preview even when production works. For early implementation, testing OAuth on local and production only is simpler.

## 4. Environment Variables Needed

Do not print actual values in code review, logs, reports, or docs.

### Frontend-Safe Variables

These can be exposed to browser code:

- `SUPABASE_URL`
  - The Supabase project URL.
- `SUPABASE_ANON_KEY`
  - The public anon key.
  - Safe only when RLS is enabled correctly.

Because this app has no bundler, options are:

- Server injects a safe config endpoint such as `GET /api/config`.
- Or `public/config.js` defines only frontend-safe values.

Avoid putting server-only secrets in `public/config.js`.

### Server-Only Variables

These must stay server-side:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `SUPABASE_SERVICE_ROLE_KEY`, only if backend admin writes are needed
- Any Google OAuth client secret
- Any future model/provider secret

For most browser-side RLS usage, the service role key is not needed in the frontend. If backend routes write data on behalf of users, use the service role only after verifying the user's Supabase JWT.

### Local Environment Location

Locally, server-only variables belong in `.env`.

Frontend-safe variables can be provided through:

- `.env`, then exposed by a backend config route, or
- a local non-secret config file if the team accepts that pattern.

Do not put secrets in `.env.example`; it should contain names/placeholders only.

### Vercel Environment Location

In Vercel Project Settings:

- Add frontend-safe variables for Production, Preview, and Development as needed.
- Add server-only variables for Production, Preview, and Development as needed.
- Confirm production and preview values are present before deploying OAuth changes.

Important:

- Missing `SUPABASE_URL` or anon key breaks login.
- Missing service role key only breaks backend admin persistence, if implemented.
- Missing OpenAI key affects AI endpoints but `/api/final-report` still has local rubric fallback.

## 5. Database Schema Update

Every user-owned table should directly include:

```sql
user_id uuid not null references auth.users(id) on delete cascade
```

This makes RLS simple and avoids having to join through `profiles` for every policy.

### `profiles`

- Purpose:
  - One PrepWise profile per authenticated user.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null unique references auth.users(id) on delete cascade`
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
  - `raw_profile jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

### `interviews`

- Purpose:
  - One interview attempt.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `profile_id uuid references profiles(id) on delete set null`
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

### `interview_answers`

- Purpose:
  - Questions, answers, skipped questions, and review metadata.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
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
- Constraint:
  - Unique index on `(interview_id, question_index)`.

### `reports`

- Purpose:
  - Final generated report per interview.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `profile_id uuid references profiles(id) on delete set null`
  - `interview_id uuid not null unique references interviews(id) on delete cascade`
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

### `cv_extractions`

- Purpose:
  - Optional record of CV parse results.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `profile_id uuid references profiles(id) on delete set null`
  - `source_type text not null check (source_type in ('pdf_text', 'pasted_text', 'manual'))`
  - `file_name text`
  - `raw_text_hash text`
  - `parsed_data jsonb not null default '{}'::jsonb`
  - `missing_fields jsonb not null default '[]'::jsonb`
  - `confidence jsonb not null default '{}'::jsonb`
  - `applied_to_profile boolean not null default false`
  - `created_at timestamptz not null default now()`

Recommendation:

- Do not store raw CV text initially.
- Store parsed JSON and optional hash/metadata only.

### `practice_sessions`

- Purpose:
  - Optional practice question/answer/feedback history.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `profile_id uuid references profiles(id) on delete set null`
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

### `analytics_events`

- Purpose:
  - Optional replacement for Google Sheets logging.
- Columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid references auth.users(id) on delete set null`
  - `profile_id uuid references profiles(id) on delete set null`
  - `interview_id uuid references interviews(id) on delete set null`
  - `event_type text not null`
  - `event_payload jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`

Recommendation:

- Do not store raw mouse movement by default.
- If analytics are kept, store coarse events first.

## 6. Row Level Security Plan

Enable RLS on every user-owned table.

Core rule:

```sql
auth.uid() = user_id
```

### `profiles`

- Select:
  - Users can select only rows where `user_id = auth.uid()`.
- Insert:
  - Users can insert only rows where `user_id = auth.uid()`.
- Update:
  - Users can update only rows where `user_id = auth.uid()`.
- Delete:
  - Usually not needed from the app.
  - If enabled, users can delete only rows where `user_id = auth.uid()`.

Policy idea:

```sql
create policy "profiles_select_own" on profiles
for select using (auth.uid() = user_id);

create policy "profiles_insert_own" on profiles
for insert with check (auth.uid() = user_id);

create policy "profiles_update_own" on profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "profiles_delete_own" on profiles
for delete using (auth.uid() = user_id);
```

### `interviews`

- Select:
  - Users can select only their own interviews.
- Insert:
  - Users can insert only interviews with their own `user_id`.
- Update:
  - Users can update only their own interviews.
- Delete:
  - Optional. If supported, users can delete only their own interviews.

Policy idea:

```sql
create policy "interviews_select_own" on interviews
for select using (auth.uid() = user_id);

create policy "interviews_insert_own" on interviews
for insert with check (auth.uid() = user_id);

create policy "interviews_update_own" on interviews
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "interviews_delete_own" on interviews
for delete using (auth.uid() = user_id);
```

### `interview_answers`

- Select:
  - Users can select only their own answers.
- Insert:
  - Users can insert only answers with their own `user_id`.
- Update:
  - Users can update only their own answers.
- Delete:
  - Usually only needed when deleting an interview.
  - Cascades can handle deletion through `interviews`.

Policy idea:

```sql
create policy "interview_answers_select_own" on interview_answers
for select using (auth.uid() = user_id);

create policy "interview_answers_insert_own" on interview_answers
for insert with check (auth.uid() = user_id);

create policy "interview_answers_update_own" on interview_answers
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "interview_answers_delete_own" on interview_answers
for delete using (auth.uid() = user_id);
```

### `reports`

- Select:
  - Users can select only their own reports.
- Insert:
  - Users can insert only reports with their own `user_id`.
- Update:
  - Users can update only their own reports.
- Delete:
  - Optional. If history deletion is kept, allow only own rows.

Policy idea:

```sql
create policy "reports_select_own" on reports
for select using (auth.uid() = user_id);

create policy "reports_insert_own" on reports
for insert with check (auth.uid() = user_id);

create policy "reports_update_own" on reports
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "reports_delete_own" on reports
for delete using (auth.uid() = user_id);
```

### `cv_extractions`

- Select:
  - Users can select only their own CV extraction records.
- Insert:
  - Users can insert only records with their own `user_id`.
- Update:
  - Users can update only their own extraction records.
- Delete:
  - Recommended, because CV-derived data can be sensitive.

Policy idea:

```sql
create policy "cv_extractions_select_own" on cv_extractions
for select using (auth.uid() = user_id);

create policy "cv_extractions_insert_own" on cv_extractions
for insert with check (auth.uid() = user_id);

create policy "cv_extractions_update_own" on cv_extractions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cv_extractions_delete_own" on cv_extractions
for delete using (auth.uid() = user_id);
```

### `practice_sessions`

- Select:
  - Users can select only their own practice sessions.
- Insert:
  - Users can insert only rows with their own `user_id`.
- Update:
  - Users can update only their own rows.
- Delete:
  - Optional, but useful for user-controlled history cleanup.

Policy idea:

```sql
create policy "practice_sessions_select_own" on practice_sessions
for select using (auth.uid() = user_id);

create policy "practice_sessions_insert_own" on practice_sessions
for insert with check (auth.uid() = user_id);

create policy "practice_sessions_update_own" on practice_sessions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "practice_sessions_delete_own" on practice_sessions
for delete using (auth.uid() = user_id);
```

### `analytics_events`

- Select:
  - Usually users do not need direct analytics reads.
  - If enabled, users can select only their own rows.
- Insert:
  - Users can insert only events with their own `user_id`.
  - For anonymous/guest analytics, keep it server-side or do not store it.
- Update:
  - Usually not needed.
- Delete:
  - Usually not needed from the app.

Policy idea:

```sql
create policy "analytics_events_select_own" on analytics_events
for select using (auth.uid() = user_id);

create policy "analytics_events_insert_own" on analytics_events
for insert with check (auth.uid() = user_id);

create policy "analytics_events_delete_own" on analytics_events
for delete using (auth.uid() = user_id);
```

## 7. App Integration Plan

### Files That Will Need Changes Later

- `public/index.html`
  - Add Supabase JS client script if using CDN.
  - Add or wire the "Continue with Google" button if not already present.
  - Add any frontend-safe config loading if needed.
- `public/app.js`
  - Add Supabase client initialization.
  - Replace or layer auth checks over `checkAuth()`.
  - Add `signInWithGoogle()`.
  - Update `signOut()`.
  - Update `saveUserData()`.
  - Add Supabase profile/history load/save functions.
- `app.js`
  - Root copy mirrors `public/app.js`; keep it in sync if it remains part of the repo workflow.
- `server.js`
  - Optional for auth verification and server-side persistence endpoints.
  - Required if backend routes will write to Supabase with a service role.
- `public/logging.js`
  - Optional if analytics move from Google Sheets/localStorage to Supabase.

### Current Profile Saving Functions

- `saveProfile(continueToSetup = false)`
  - Reads profile form fields.
  - Updates `state.user`.
  - Normalizes and updates `state.user.cvData`.
  - Calls `saveUserData()`.
- `applyCVExtracted()`
  - Applies parsed CV data into profile fields/state.
  - Updates `state.user.cvData`.
  - Calls `saveUserData()`.
- `saveUserData()`
  - Current persistence function.
  - Writes `prepwise_users_v3` and `prepwise_session_v3`.
  - Skips saving for guests.

Recommended auth insertion:

- Keep `saveProfile()` as the main UI/state collector.
- Change `saveUserData()` to:
  - Continue updating local cache.
  - If Supabase session exists, upsert `profiles` for `auth.uid()`.

### Current Interview/Report Saving Functions

- `startInterview()`
  - Initializes in-memory `state.interview`.
  - Requests first question.
- `appendGeneratedQuestion(result)`
  - Stores question and metadata in memory.
- `handleNextQuestion()`
  - Stores answered response in `state.interview.responses`.
- `skipQuestion()`
  - Stores skipped response in `state.interview.responses` and `state.interview.skippedQuestions`.
- `generateFinalReport()`
  - Calls `/api/final-report`.
  - Builds `aiReport`.
  - Calls `saveSession(aiReport)`.
- `saveSession(aiReport)`
  - Inserts completed report object at the front of `state.sessions`.
  - Calls `saveUserData()`.
- `loadSessionReport(index)`
  - Reads report from `state.sessions`.
- `showHistory()`
  - Renders `state.sessions`.
- `deleteSession(index)` / `confirmDeleteSession()`
  - Deletes local session history.

Recommended auth insertion:

- Phase 1:
  - Keep these functions' current local behavior.
  - Add Supabase backup calls after successful local save.
- Later:
  - Create `interviews` at `startInterview()`.
  - Insert/update `interview_answers` in `handleNextQuestion()` and `skipQuestion()`.
  - Insert `reports` in `generateFinalReport()` or `saveSession()`.
  - Load `state.sessions` from Supabase in `checkAuth()` after profile load.

### How `user_id` Should Be Passed to Backend Routes

Do not trust a raw `user_id` sent in JSON by the browser for secure writes.

For backend routes that need authenticated user context:

1. Frontend gets the current Supabase session.
2. Frontend sends the access token in the `Authorization` header:

```http
Authorization: Bearer <supabase_access_token>
```

3. Backend verifies the token with Supabase.
4. Backend derives `user_id` from the verified user.
5. Backend writes rows using that verified `user_id`.

The request body can still include profile/interview payloads, but ownership must come from the verified session, not from client-provided `user_id`.

### How Backend Should Verify User/Session

If using backend persistence:

- Add a Supabase server client in `server.js`.
- Read the `Authorization` header.
- Validate the JWT/session through Supabase.
- Reject protected save/load routes with `401` when missing or invalid.
- Use the verified `user.id` as `user_id`.

For AI-only routes:

- They can remain public during the transition to avoid breaking current flow.
- Later, rate limiting or auth checks can be added if needed.

Recommended split:

- Browser direct Supabase writes for simple tables under RLS.
- Backend writes only when:
  - service role is required,
  - multiple table writes must be transactional,
  - server-generated data must be trusted,
  - secret keys are involved.

## 8. Migration Plan

### Phase 1: Add Google Login UI + Supabase Session Detection

- Add Supabase frontend client.
- Add "Continue with Google" button.
- Implement Google OAuth redirect flow.
- On load, check Supabase session before fake localStorage auth.
- Keep existing fake/local/guest mode working.
- Do not change interview AI routes yet.

### Phase 2: Create/Update Profile Row After Login

- After successful Google login, upsert `profiles` with:
  - `user_id = session.user.id`
  - `email = session.user.email`
  - basic display name if available
- If local `prepwise_session_v3.profile` exists, offer or automatically copy it into the Supabase profile.
- Keep localStorage as fallback cache.

### Phase 3: Save Profile Data to Supabase

- Update `saveUserData()` or a new `saveProfileToSupabase()` helper.
- On profile save, upsert `profiles`.
- Store both normalized columns and `raw_profile`.
- Store `cv_data` JSONB for compatibility.
- Keep localStorage writes in place.

### Phase 4: Save Interviews, Answers, and Reports to Supabase

- Create `interviews` row when interview starts or when report is generated.
- Save answers to `interview_answers`.
- Save final report to `reports`.
- At first, saving at report completion is simplest:
  - One `interviews` row with `status = completed`.
  - Multiple `interview_answers` rows from `state.interview.responses`.
  - One `reports` row from `aiReport`.
- Later, add partial-progress saves during the interview.

### Phase 5: Load History/Reports From Supabase

- After auth session detection, fetch:
  - profile row
  - latest reports
  - related interviews/answers as needed
- Populate `state.user` and `state.sessions` from Supabase.
- Update `showHistory()` and `loadSessionReport()` to work from Supabase-loaded data.
- Keep localStorage fallback if Supabase fetch fails.

### Phase 6: Reduce localStorage to Temporary Cache Only

- Stop treating `prepwise_users_v3` as source of truth.
- Keep only:
  - short-lived UI cache
  - in-progress interview backup if needed
  - Supabase-managed auth session
- Remove or ignore `gemini_api_key`.
- Consider replacing mouse logs with explicit analytics events or removing them.

## 9. Risks / Things That Can Break

- OAuth redirect mismatch:
  - Google/Supabase redirects must exactly match local, production, and preview URLs.
  - A missing trailing slash variant can cause confusing failures.

- RLS blocking inserts:
  - If `user_id` is missing or does not equal `auth.uid()`, inserts will fail.
  - This is expected and should be handled with clear UI/log errors during development.

- Missing `user_id`:
  - Current local code has email but no trusted auth user ID.
  - Supabase-owned rows must use `session.user.id`.

- Vercel env variables missing:
  - Missing Supabase URL/anon key breaks login.
  - Missing service role breaks backend persistence if used.
  - Missing OpenAI key affects AI generation routes.

- Frontend using old localStorage user:
  - `checkAuth()` currently trusts `prepwise_session_v3`.
  - Supabase session must take priority over stale local fake users.
  - Logout must clear or isolate stale local profile/session cache.

- Server routes not receiving session:
  - Existing `postJSON()` does not send Authorization headers.
  - Protected backend persistence routes will need token-aware fetch logic.

- Preview vs production URL differences:
  - Vercel preview domains change.
  - OAuth can work locally and production but fail in preview.
  - Start with local and production OAuth testing unless preview login is required.

- AI interview flow regression:
  - The working AI interview flow depends on current state objects.
  - Auth changes should not rewrite interview state during Phase 1.

- Guest/local migration:
  - Users may have existing localStorage reports under fake email accounts.
  - Decide whether to auto-migrate, prompt migration, or leave old local data local-only.

- CV privacy:
  - Google login makes user identity real.
  - CV-derived data should be protected by RLS and should avoid raw CV text storage by default.

## 10. Final Recommendation

The safest simple path is:

1. Add Google OAuth first, without changing the AI interview flow.
2. Let Supabase Auth own the login session.
3. Keep localStorage working as a fallback during the first auth release.
4. Create one `profiles` row per `auth.users.id` after login.
5. Save profile data to Supabase before changing interview/report history.
6. Save completed reports to Supabase next, because final reports are already assembled in one place: `saveSession(aiReport)`.
7. Only after reports are saving reliably, move history reads from localStorage to Supabase.

This avoids breaking the current interview generation and report flow while adding real Google sign up/login and a clean ownership model for each user's profile, interviews, answers, reports, CV data, and practice history.
