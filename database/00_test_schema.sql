-- =====================================================================
-- مخطط المشروع التجريبي فقط
-- أنشئ مشروع Supabase ثانيًا مجانيًا باسم مثل al-matarid-test، وشغّل فيه:
--   00_test_schema.sql  ثم  01_setup.sql  ثم  02_tests.sql
-- لا تشغّل هذا الملف على مشروعك الحقيقي (جداوله موجودة فيه أصلًا).
-- رمز المالك في المشروع التجريبي: OWNER-TEST-1
-- =====================================================================
-- حارس أمان: يرفض العمل على أي مشروع فيه بيانات (أي مشروعك الحقيقي)
do $$
begin
  if to_regclass('public.members') is not null then
    if (select count(*) from public.members) > 0 then
      raise exception 'توقّف! هذا ليس المشروع التجريبي: فيه بيانات. لا تشغّل هذا الملف هنا (كان سيغيّر رمز المالك).';
    end if;
  end if;
end $$;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'gender') then
    create type public.gender as enum ('male', 'female');
  end if;
end $$;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  gender public.gender,
  father_id uuid references public.members(id),
  mother_id uuid,
  birth_date date,
  death_date date,
  is_alive boolean default true,
  phone text,
  photo_url text,
  bio text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  biography_story text,
  wife_mother_id uuid,
  nickname text,
  birth_year_text text,
  death_year_text text,
  birth_order integer,
  city text,
  audio_url text,
  achievement_badge text
);

create table if not exists public.wives (
  id uuid primary key default gen_random_uuid(),
  husband_id uuid references public.members(id),
  full_name text not null,
  family_name text,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_wife_mother_fk') then
    alter table public.members add constraint members_wife_mother_fk
      foreign key (wife_mother_id) references public.wives(id);
  end if;
end $$;

create table if not exists public.family_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date timestamptz not null,
  location_name text,
  location_url text,
  description text,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid,
  target_member_id uuid,
  request_type text,
  proposed_data jsonb,
  status text default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.feature_flags (
  feature_key text primary key,
  title text,
  description text,
  is_enabled boolean default false,
  config jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.system_settings (
  id integer primary key,
  passcode_hash text
);

insert into public.system_settings (id, passcode_hash)
values (1, extensions.crypt('OWNER-TEST-1', extensions.gen_salt('bf')))
on conflict (id) do update set passcode_hash = excluded.passcode_hash;
