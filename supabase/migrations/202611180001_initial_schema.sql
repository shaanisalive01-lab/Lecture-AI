-- Lecture-AI first working schema. Run this migration in a new Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  theme text not null default 'light' check (theme in ('light','dark','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  course_name text not null default 'My course',
  source_type text not null check (source_type in ('pdf','ppt','audio','youtube','topic','demo')),
  source_name text not null,
  source_url text,
  storage_path text,
  status text not null default 'processing' check (status in ('processing','ready','error')),
  materials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  course_name text not null default 'My course',
  exam_date date not null,
  created_at timestamptz not null default now()
);

-- Raw performance signals are private inputs to recommendations, not a student-facing score.
create table if not exists public.study_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid references public.lectures(id) on delete cascade,
  topic text,
  method text not null,
  action text not null,
  correct boolean,
  confidence smallint check (confidence between 0 and 5),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now()
);

create index if not exists lectures_user_created_idx on public.lectures(user_id, created_at desc);
create index if not exists exams_user_date_idx on public.exams(user_id, exam_date);
create index if not exists study_events_user_created_idx on public.study_events(user_id, created_at desc);
create index if not exists study_events_lecture_idx on public.study_events(lecture_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lectures_set_updated_at on public.lectures;
create trigger lectures_set_updated_at before update on public.lectures
for each row execute function public.set_updated_at();
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.lectures enable row level security;
alter table public.exams enable row level security;
alter table public.study_events enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users can create their profile" on public.profiles;
create policy "Users can create their profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users can manage their lectures" on public.lectures;
create policy "Users can manage their lectures" on public.lectures for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can manage their exams" on public.exams;
create policy "Users can manage their exams" on public.exams for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can manage their study events" on public.study_events;
create policy "Users can manage their study events" on public.study_events for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lecture-files', 'lecture-files', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/webm'
])
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "Users can upload their lecture files" on storage.objects;
create policy "Users can upload their lecture files" on storage.objects for insert to authenticated
with check (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can read their lecture files" on storage.objects;
create policy "Users can read their lecture files" on storage.objects for select to authenticated
using (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can delete their lecture files" on storage.objects;
create policy "Users can delete their lecture files" on storage.objects for delete to authenticated
using (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
