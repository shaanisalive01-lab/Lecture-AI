# Lecture-AI

A calm, responsive lecture study workspace. Upload lecture files, generate source-aware notes and practice sets, learn a topic from its foundations, and plan around manually entered exams.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Without environment variables, the app opens in **local demo mode**. Demo lecture names, exam dates, theme choices, and practice signals are stored in this browser only. A demo upload does not process the actual file and uses clearly labeled sample learning material.

## Connect Supabase for accounts and cross-device data

1. Create a Supabase project.
2. Open the SQL editor and run [`supabase/migrations/202611180001_initial_schema.sql`](supabase/migrations/202611180001_initial_schema.sql). This creates the profile, lecture, exam, private study-event, and private file-storage schema with row-level security.
3. Copy `.env.example` to `.env.local`, then set the Supabase project URL and **anon/public** key. Never put a service-role key in a `VITE_` variable or browser code.
4. In Supabase Authentication settings, set the local site URL to `http://localhost:5173` and enable email/password sign-in. Configure your production URL when you deploy.
5. Restart `npm run dev`. Create an account in Lecture-AI; sign in on another device with the same account to access the same Supabase-backed library.

The free Supabase plan has limited database and file storage, and inactive free projects can pause. Check the current plan limits before inviting other students.

## Enable real AI generation

Real PDF, audio, PowerPoint-text, and transcript processing requires a Gemini API key configured as a **server-side Supabase Edge Function secret**. A free-tier Gemini key must never be exposed in the frontend.

1. Install the Supabase CLI and sign in: `supabase login`.
2. Link the project: `supabase link --project-ref YOUR_PROJECT_REF`.
3. Set the Gemini API key: `supabase secrets set GEMINI_API_KEY=YOUR_KEY`.
4. Deploy the function: `supabase functions deploy generate-study-materials`.
The function accepts files up to 15 MB for AI processing. The browser limits upload files to 25 MB; larger files may upload to storage but will be rejected by the AI function. Modern `.pptx` slide text is extracted in the browser before generation; legacy binary `.ppt` files are not supported. PDF pages and audio are sent to Gemini from a private, short-lived Supabase file URL.

**Free-tier privacy note:** Google’s current Gemini API pricing documentation says free-tier input and output may be used to improve its products. During this practice build, use sample or non-sensitive materials, tell any testers about the data flow, and do not upload private course content without reviewing the provider terms and getting appropriate permission. Quotas and model availability may change. The default model is `gemini-3.8-flash`; set the optional Supabase secret `GEMINI_MODEL` to another supported model if needed.

## YouTube links

The prototype requires a student-provided transcript or notes before it generates study tools from a YouTube link. It embeds the original video for viewing and labels the text as student-provided. It does not claim to watch a video or verify arbitrary public captions.

## Data model

- `profiles`: user preferences and account profile.
- `lectures`: uploaded source metadata and generated study material.
- `exams`: manually added assessment dates.
- `study_events`: private practice signals used to improve recommendations; the UI does not display an overall performance score.
- `storage.objects`: source files in the private `lecture-files` bucket, scoped to the owning user.

The study planner currently builds a small, flexible plan from the nearest exam and available lectures. Study suggestions use a few transparent rules based on the latest confidence check or quiz response; a deeper adaptive model and persistent task scheduling are follow-up work. Individual task completion lives in the active browser session.

## Build for deployment

```bash
npm run build
npm run preview
```

Deploy the `dist` output to a static host, add the two `VITE_SUPABASE_*` public configuration values as build environment variables, and set the production auth redirect URL in Supabase. Keep provider and service-role secrets only in Supabase Edge Function secrets.

## GitHub handoff

Create a GitHub repository, then from this folder run:

```bash
git init
git add .
git commit -m "Build Lecture-AI study app"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

Do not commit `.env.local`, API keys, service-role keys, real lecture uploads, or student data.
