# Supabase `profiles` Schema Proposal

Generated from the current PrepWise code, not only the older planning notes.

Inspected files:

- `public/app.js`
- `app.js`
- `public/index.html`
- `index.html`
- `SUPABASE_AUTH_CONTEXT.md`
- `server.js`
- `public/logging.js`

`app.js` and `public/app.js` are currently identical. `index.html` and `public/index.html` are also identical.

## Current Profile Fields Found

### Auth/session identity

| JS/state field | Form/input id | Storage recommendation | Required? | Notes |
| --- | --- | --- | --- | --- |
| `state.currentUser.email` | `auth-email` in the old local auth form | SQL column: `email text not null` | Required for Google users | Current local auth stores users by email. With Supabase Auth, this should come from `session.user.email`, not profile form input. |
| `state.user.email` | none in current profile form; simulated social login writes it | SQL column: `email`; also keep full object in `raw_profile` | Required for Google users | CV review has `cv-review-email`, but `applyCVExtracted()` does not copy it into `state.user.email`. |
| Google display name | no current input | SQL column: `google_display_name text` | Optional | Not currently implemented, but needed for Google login. Use `session.user.user_metadata.full_name` / `name` when available. |

### Main editable profile form

| JS/state field | Form/input id | Storage recommendation | Required? | Notes |
| --- | --- | --- | --- | --- |
| `state.user.name` | `prof-name` | SQL column: `name text` | Optional | Used in UI greeting, dashboard, reports, profile completeness, and interview context. |
| `state.user.field` | `prof-field` | SQL column: `field text` | Optional | Defaults to `Software Engineering` in state. Used as fallback role context. |
| `state.user.targetRole` | `prof-target-role` | SQL column: `target_role text` | Optional | Used heavily for interview personalization and report/practice role context. |
| `state.user.location` | `prof-location` | SQL column: `location text` | Optional | Saved into `cvData.location`; sent to backend normalize path. |
| `state.user.summary` | `prof-summary` | SQL column: `summary text` | Optional | Used by server profile evidence and report fit. |
| `state.user.skills` | `prof-skills` | SQL column: `skills_text text` | Optional | Free text list. Also merged into `cvData.skills.other`. |
| `state.user.projects` | `prof-projects` | SQL column: `projects_text text` | Optional | Free text project notes. Server exposes this as `projectNotes`. |
| `state.user.courses` | `prof-courses` | SQL column: `courses_text text` | Optional | Used as relevant courses and fallback education signal. |
| `state.user.experience` | `prof-experience` | SQL column: `experience_text text` | Optional | Free text work history. Used in local questions, report fit, backend evidence. |
| `state.user.languages` | `prof-languages` hidden input; `prof-language-input` selector appends values | SQL column: `languages_text text` | Optional | Stored as newline text in state; also mirrored into `cvData.languages`. |
| `state.user.certifications` | no direct profile input | SQL column: `certifications_text text` | Optional | Derived in `saveProfile()` from education rows where `field === "Certification"`. |
| Manual education rows | generated inside `prof-education-list`; row fields use `data-key` values `degree`, `institution`, `field`, `details` | SQL column: `education jsonb not null default '[]'::jsonb` and also mirrored in `cv_data` | Optional | `collectProfileEducation()` also preserves empty `startDate` and `endDate` keys even though the current manual education UI does not render date inputs. |

### Legacy state fields still present but not current profile columns

| JS/state field | Form/input id | Storage recommendation | Required? | Notes |
| --- | --- | --- | --- | --- |
| `state.user.phone` | none in main profile form | `raw_profile` / `cv_data` only | Optional | Do not create a normal `phone` column. It is in initial state and CV parsing, but the app no longer uses it as an editable profile field or personalization field. |
| `state.user.linkedin` | none in main profile form | `raw_profile` only | Optional | Local fallback CV parser extracts `linkedin`, but the current OpenAI CV schema and profile save flow do not persist it into `cvData` or interview personalization. Do not create a normal `linkedin` column. |

### CV extracted fields

The app still uses CV parsing through `/api/parse-cv`, `normalizeCVData()`, `showCVReviewModal()`, and `applyCVExtracted()`. Keep `cv_data jsonb`.

| CV/state field | CV review input id / source | Storage recommendation | Required? | Notes |
| --- | --- | --- | --- | --- |
| `state.user.cvData.name` | `cv-review-name` | `cv_data`; copied to SQL `name` through `state.user.name` when accepted | Optional | Copied only if non-empty and not skipped for low confidence. |
| `state.user.cvData.email` | `cv-review-email` | `cv_data`; auth email remains SQL `email` | Optional | Not copied into `state.user.email` by `applyCVExtracted()`. |
| `state.user.cvData.phone` | `cv-review-phone` | `cv_data` only | Optional | CV-only. No normal `phone` column recommended. |
| `state.user.cvData.location` | `cv-review-location` | `cv_data`; copied to SQL `location` through `state.user.location` | Optional | Used by backend normalization. |
| `state.user.cvData.targetRole` | `cv-review-role` | `cv_data`; copied to SQL `target_role` through `state.user.targetRole` | Optional | Interview personalization field. |
| `state.user.cvData.summary` | `cv-review-summary` | `cv_data`; copied to SQL `summary` through `state.user.summary` | Optional | Interview personalization field. |
| `state.user.cvData.education[]` | `.cv-education-item` rows with `degree`, `institution`, `field`, `startDate`, `endDate`, `details` | SQL `education jsonb` and `cv_data.education` | Optional | Used in server `normalizeProfile()` and local question/report logic. |
| `state.user.cvData.relevantCourses[]` | `cv-review-courses` | `cv_data`; SQL `courses_text` stores editable text | Optional | `saveProfile()` mirrors `state.user.courses` into `cvData.relevantCourses`. |
| `state.user.cvData.skills.programmingLanguages[]` | `cv-skills-programmingLanguages` | `cv_data` | Optional | Used for structured skills in backend evidence. |
| `state.user.cvData.skills.frameworks[]` | `cv-skills-frameworks` | `cv_data` | Optional | Used for structured skills in backend evidence. |
| `state.user.cvData.skills.tools[]` | `cv-skills-tools` | `cv_data` | Optional | Used for structured skills in backend evidence. |
| `state.user.cvData.skills.databases[]` | `cv-skills-databases` | `cv_data` | Optional | Used for structured skills in backend evidence. |
| `state.user.cvData.skills.softSkills[]` | `cv-skills-softSkills` | `cv_data` | Optional | Used for structured skills in backend evidence. |
| `state.user.cvData.skills.other[]` | `cv-skills-other` plus merged profile skills | `cv_data` | Optional | `saveProfile()` appends free-text `state.user.skills` into this array. |
| `state.user.cvData.experience[]` | `.cv-experience-item` rows with `title`, `organization`, `startDate`, `endDate`, `description`, `skillsUsed[]` | `cv_data` | Optional | Used in server evidence and local/report fit logic. |
| `state.user.cvData.projects[]` | `.cv-project-item` rows with `name`, `description`, `technologies[]`, `role`, `impact` | `cv_data` | Optional | Used in server evidence and local/report fit logic. |
| `state.user.cvData.certifications[]` | `cv-review-certifications` | `cv_data`; SQL `certifications_text` stores derived text | Optional | `applyCVExtracted()` also appends certifications as education rows with `field: "Certification"`. |
| `state.user.cvData.languages[]` | `cv-review-languages` | `cv_data`; SQL `languages_text` stores editable text | Optional | Used in report profile fit and backend evidence. |
| `state.user.cvData.missingFields[]` | generated by parser | `cv_data` only | Optional | CV review helper metadata. |
| `state.user.cvData.confidence` | generated by parser | `cv_data` only | Optional | Used during `applyCVExtracted()` to avoid overwriting existing higher-confidence data. |

### Interview personalization fields

The current app sends `student_profile: this.state.user` to the backend for interview questions, final reports, practice questions, and practice feedback. `server.js` normalizes these fields:

- Top-level text: `name`, `field`, `skills`, `courses`, `projects` as `projectNotes`, `experience`, `targetRole`, `summary`, `location`.
- CV JSON: `cvData.education`, `cvData.relevantCourses`, `cvData.skills`, `cvData.projects`, `cvData.experience`, `cvData.certifications`, `cvData.languages`.

That means the durable Supabase profile must be able to reconstruct the current `state.user` object. The simplest stable design is normal columns for high-use editable profile fields, plus `cv_data` for structured CV fields and `raw_profile` for full compatibility.

## Recommended `profiles` Table

Recommended normal SQL columns:

- Identity: `id`, `user_id`, `email`, `google_display_name`
- Current editable profile fields: `name`, `field`, `target_role`, `location`, `summary`, `skills_text`, `courses_text`, `projects_text`, `experience_text`, `certifications_text`, `languages_text`
- Structured manual/CV education: `education jsonb`
- Compatibility and CV payloads: `cv_data jsonb`, `raw_profile jsonb`
- Timestamps: `created_at`, `updated_at`

Do not create normal columns for `phone` or `linkedin` right now. They no longer exist in the main profile UI and are not used by interview personalization. If present from CV parsing or legacy localStorage, keep them in `cv_data` and/or `raw_profile`.

## RLS Policies

Required policies:

- Users can select only rows where `profiles.user_id = auth.uid()`.
- Users can insert only rows where `profiles.user_id = auth.uid()`.
- Users can update only rows where `profiles.user_id = auth.uid()`.
- Users can delete only rows where `profiles.user_id = auth.uid()`.

## Final Copy-Paste SQL

```sql
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  google_display_name text,

  name text,
  field text,
  target_role text,
  location text,
  summary text,
  skills_text text,
  courses_text text,
  projects_text text,
  experience_text text,
  certifications_text text,
  languages_text text,

  education jsonb not null default '[]'::jsonb,
  cv_data jsonb,
  raw_profile jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles(user_id);
create index if not exists profiles_email_idx on public.profiles(email);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles
for delete
using (auth.uid() = user_id);
```
