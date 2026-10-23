-- =====================================================================
-- أسرة آل مطارد: الإعداد الكامل لقاعدة البيانات (ملف واحد يحلّ محل 01 و02 و04 و05 القديمة)
--
-- يتضمن:
--   * أدوار: زائر، فرد عائلة، مسؤول فرع، محرر، مالك
--   * مسؤول لكل فرع (يضيف ويعدّل داخل فرعه فقط، والحدود تُفرض هنا)
--   * وضعا الوصول: رابط مفتوح / رمز العائلة
--   * تقييد ما يُرجَع لكل دور (قائمة أعمدة صريحة، والزوجات والمناسبات للعائلة فصاعدًا)
--   * حدّ لمحاولات الرموز الخاطئة (8 محاولات / 15 دقيقة لكل عنوان)
--   * سجل تغييرات (من عدّل، وماذا، ومتى)
--   * لقطات احتياطية داخل القاعدة + استعادة من SQL Editor فقط
--   * إغلاق القراءة والكتابة المباشرة على الجداول
--
-- قبل التشغيل: يجب أن يكون لرمز المالك قيمة في system_settings (انظر README).
-- الملف كله في معاملة واحدة: إن حدث خطأ لا يتغيّر شيء، فأرسل لي رسالة الخطأ.
-- =====================================================================
begin;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from public.system_settings where id = 1 and passcode_hash is not null) then
    raise exception 'لا يوجد رمز مالك في system_settings. اضبطه أولًا: update system_settings set passcode_hash = crypt(''رمزك'', gen_salt(''bf'')) where id = 1;';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) تنظيف دوال قديمة (بأي توقيع) قبل إعادة إنشائها
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('verify_owner','verify_editor','verify_family','verify_role','get_bundle','get_access_mode',
         'submit_suggestion','list_suggestions','secure_delete_suggestion','secure_save_member','secure_update_member_extras',
         'secure_save_wife','secure_delete_wife','secure_delete_member','secure_save_event','secure_delete_event',
         'secure_set_access_mode','secure_set_family_code','secure_set_editor_code','secure_set_branch_editor',
         'secure_clear_branch_editor','list_changes','secure_snapshot','secure_toggle_feature',
         '_branch_of','_in_branch','_branch_members','_role_of','_authenticate','_who','_fail','_deny','_actor',
         '_client_ip','_audit','_take_snapshot','admin_restore','admin_restore_snapshot')
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1) أعمدة الإعدادات
-- ---------------------------------------------------------------------
alter table public.system_settings
  add column if not exists editor_passcode_hash text,
  add column if not exists family_code_hash text,
  add column if not exists access_mode text not null default 'family_code';
alter table public.system_settings drop constraint if exists system_settings_access_mode_check;
alter table public.system_settings
  add constraint system_settings_access_mode_check check (access_mode in ('open_link', 'family_code'));

-- ---------------------------------------------------------------------
-- 2) جداول جديدة (مغلقة تمامًا أمام المتصفح، والدوال وحدها تصل إليها)
-- ---------------------------------------------------------------------
create table if not exists public.branch_editors (
  id                 uuid primary key default gen_random_uuid(),
  branch_root_id     uuid not null unique references public.members(id) on delete cascade,
  delegate_member_id uuid references public.members(id) on delete set null,
  label              text not null,
  passcode_hash      text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.branch_editors add column if not exists delegate_member_id uuid references public.members(id) on delete set null;

create table if not exists public.auth_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_ip_time on public.auth_attempts (ip, created_at);

create table if not exists public.change_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor      text not null,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  label      text,
  changes    jsonb
);
create index if not exists change_log_time on public.change_log (created_at desc);

create table if not exists public.snapshots (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  label      text,
  data       jsonb not null
);

alter table public.branch_editors enable row level security;
alter table public.auth_attempts  enable row level security;
alter table public.change_log     enable row level security;
alter table public.snapshots      enable row level security;
revoke all on public.branch_editors, public.auth_attempts, public.change_log, public.snapshots from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) التحقق من الرموز (داخلي: لا يُستدعى من المتصفح حتى لا يصير أداة تخمين)
-- ---------------------------------------------------------------------
create function public.verify_owner(passcode text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select passcode_hash into v_hash from public.system_settings where id = 1;
  if v_hash is null or passcode is null or length(passcode) = 0 then return false; end if;
  return coalesce(v_hash = crypt(passcode, v_hash), false);
end $$;

create function public.verify_editor(passcode text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select editor_passcode_hash into v_hash from public.system_settings where id = 1;
  if v_hash is null or passcode is null or length(passcode) = 0 then return false; end if;
  return coalesce(v_hash = crypt(passcode, v_hash), false);
end $$;

create function public.verify_family(passcode text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select family_code_hash into v_hash from public.system_settings where id = 1;
  if v_hash is null or passcode is null or length(passcode) = 0 then return false; end if;
  return coalesce(v_hash = crypt(passcode, v_hash), false);
end $$;

create function public._branch_of(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if p_code is null or length(p_code) = 0 then return null; end if;
  for r in select branch_root_id, passcode_hash from public.branch_editors loop
    if r.passcode_hash = crypt(p_code, r.passcode_hash) then return r.branch_root_id; end if;
  end loop;
  for r in select branch_root_id, code_hash from public.branch_access_codes loop
    if r.code_hash = crypt(p_code, r.code_hash) then return r.branch_root_id; end if;
  end loop;
  return null;
end $$;

-- هل p_member داخل فرع p_root (هو نفسه أو أحد ذريته)؟
create function public._in_branch(p_root uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, father_id, 0 as d from public.members where id = p_member
    union all
    select m.id, m.father_id, up.d + 1 from public.members m join up on m.id = up.father_id where up.d < 60
  )
  select coalesce(bool_or(id = p_root), false) from up;
$$;

create function public._branch_members(p_root uuid) returns table(id uuid)
language sql stable security definer set search_path = public as $$
  with recursive sub as (
    select m.id from public.members m where m.id = p_root
    union
    select c.id from public.members c join sub on c.father_id = sub.id
  )
  select sub.id from sub;
$$;

create function public._role_of(p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if public.verify_owner(p_code)  then return 'owner';  end if;
  if public.verify_editor(p_code) then return 'editor'; end if;
  if p_code is not null and length(p_code) > 0 then
    for r in select passcode_hash from public.branch_editors loop
      if r.passcode_hash = crypt(p_code, r.passcode_hash) then return 'branch'; end if;
    end loop;
    for r in select code_hash from public.branch_access_codes loop
      if r.code_hash = crypt(p_code, r.code_hash) then return 'reader'; end if;
    end loop;
  end if;
  if public.verify_family(p_code) then return 'family'; end if;
  return null;
end $$;

create function public._client_ip() returns text
language plpgsql stable set search_path = public as $$
declare h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  return coalesce(nullif(trim(h ->> 'cf-connecting-ip'), ''),
                  nullif(trim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''),
                  'unknown');
end $$;

-- نقطة الدخول الوحيدة: تحدّ التخمين وتُرجع الدور (null بلا رمز، '__locked__' عند الحظر المؤقت).
-- تُسجَّل المحاولة الخاطئة مرة واحدة فقط (لا مع كل فحص داخلي).
create function public._authenticate(p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_ip text := public._client_ip(); v_role text;
begin
  if p_code is null or length(p_code) = 0 then return null; end if;
  if (select count(*) from public.auth_attempts where ip = v_ip and created_at > now() - interval '15 minutes') >= 8 then
    return '__locked__';
  end if;
  v_role := public._role_of(p_code);
  if v_role is null then
    insert into public.auth_attempts (ip) values (v_ip);
    delete from public.auth_attempts where created_at < now() - interval '1 day';
  end if;
  return v_role;
end $$;

create function public._who(p_code text, out o_role text, out o_branch uuid)
language plpgsql security definer set search_path = public, extensions as $$
begin
  o_role := public._authenticate(p_code);
  if o_role in ('branch', 'reader') then o_branch := public._branch_of(p_code); end if;
end $$;

create function public._fail(p_msg text) returns jsonb
language sql immutable as $$ select jsonb_build_object('success', false, 'message', p_msg) $$;

create function public._deny(p_role text) returns jsonb
language sql immutable as $$
  select public._fail(case when p_role = '__locked__' then 'محاولات خاطئة كثيرة، انتظر 15 دقيقة ثم حاول مجددًا'
                           when p_role is null then 'رمز غير صحيح'
                           else 'لا تملك صلاحية لهذا الإجراء' end)
$$;

create function public._actor(p_role text, p_branch uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p_role when 'owner' then 'المالك' when 'editor' then 'المحرر'
    when 'branch' then 'مسؤول فرع: ' || coalesce((select label from public.branch_editors where branch_root_id = p_branch), '؟')
    else 'غير معروف' end
$$;

-- ---------------------------------------------------------------------
-- 4) سجل التغييرات: مشغّلات على الأفراد والزوجات والمناسبات
-- ---------------------------------------------------------------------
create function public._audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := coalesce(nullif(current_setting('app.actor', true), ''), 'النظام');
  o jsonb; n jsonb; v_src jsonb; ch jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'INSERT' then n := to_jsonb(new); v_src := n;
  elsif tg_op = 'DELETE' then o := to_jsonb(old); v_src := o;
  else o := to_jsonb(old); n := to_jsonb(new); v_src := n; end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'created_at') and (n -> k) is distinct from (o -> k) then
        ch := ch || jsonb_build_object(k, case when k = 'phone' then to_jsonb('(تغيّر)'::text)
                                               else jsonb_build_array(o -> k, n -> k) end);
      end if;
    end loop;
    if ch = '{}'::jsonb then return new; end if;
  else
    ch := v_src - 'phone';
  end if;

  insert into public.change_log (actor, table_name, row_id, action, label, changes)
  values (v_actor, tg_table_name, (v_src ->> 'id')::uuid, lower(tg_op),
          coalesce(v_src ->> 'full_name', v_src ->> 'title'), ch);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists members_audit on public.members;
create trigger members_audit after insert or update or delete on public.members
  for each row execute function public._audit();
drop trigger if exists wives_audit on public.wives;
create trigger wives_audit after insert or update or delete on public.wives
  for each row execute function public._audit();
drop trigger if exists family_events_audit on public.family_events;
create trigger family_events_audit after insert or update or delete on public.family_events
  for each row execute function public._audit();

-- ---------------------------------------------------------------------
-- 5) القراءة
-- ---------------------------------------------------------------------
create function public.get_access_mode() returns text
language sql stable security definer set search_path = public as $$
  select access_mode from public.system_settings where id = 1
$$;

-- ما يراه كل دور:
--   زائر (وضع الرابط المفتوح): الأفراد بلا هواتف، بلا زوجات، بلا مناسبات
--   فرد عائلة: الأفراد بلا هواتف + الزوجات + المناسبات
--   مسؤول فرع: كالسابق + هواتف فرعه فقط
--   محرر ومالك: كل شيء (والمالك يرى قائمة مسؤولي الفروع)
create function public.get_bundle(p_code text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_mode text; v_role text; v_priv boolean; v_seen boolean; v_branch uuid; v_scope uuid[]; v_wvis boolean;
begin
  select access_mode into v_mode from public.system_settings where id = 1;
  v_role := public._authenticate(p_code);

  if v_role = '__locked__' then
    return jsonb_build_object('ok', false, 'error', 'locked', 'mode', v_mode);
  end if;
  if v_mode = 'family_code' and v_role is null then
    return jsonb_build_object('ok', false, 'error', 'code_required', 'mode', v_mode);
  end if;

  v_priv := coalesce(v_role in ('owner', 'editor'), false);
  select coalesce(women_names_visible, true) into v_wvis from public.system_settings where id = 1;
  v_seen := v_role is not null;

  if v_role in ('branch', 'reader') then
    v_branch := public._branch_of(p_code);
    if v_role = 'branch' then
      select coalesce(array_agg(b.id), '{}') into v_scope from public._branch_members(v_branch) b;
    end if;
  end if;

  if v_role in ('family', 'branch', 'reader') and p_code is not null then
    insert into public.access_log(role, branch_root_id, ip)
    select v_role, v_branch, public._client_ip()
    where not exists (select 1 from public.access_log a where a.ip = public._client_ip() and a.role = v_role
      and a.branch_root_id is not distinct from v_branch and a.created_at > now() - interval '30 minutes');
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'role', coalesce(v_role, 'visitor'),
    'women_names_visible', v_wvis,
    'access_stats', case when v_role = 'owner' then (select jsonb_build_object(
      'family', (select count(*) from public.access_log where role = 'family' and created_at > now() - interval '30 days'),
      'by_branch', coalesce((select jsonb_object_agg(branch_root_id::text, c) from (select branch_root_id, count(*) c from public.access_log where branch_root_id is not null and created_at > now() - interval '30 days' group by branch_root_id) t), '{}'::jsonb))) end,
    'branch', case when v_branch is not null then
        (select jsonb_build_object('root_id', e.branch_root_id, 'delegate_id', e.delegate_member_id, 'label', e.label)
           from public.branch_editors e where e.branch_root_id = v_branch) end,
    'branches', case when v_role = 'owner' then
        coalesce((select jsonb_agg(jsonb_build_object('root_id', e.branch_root_id, 'delegate_id', e.delegate_member_id, 'label', e.label, 'reader_set', exists(select 1 from public.branch_access_codes c where c.branch_root_id = e.branch_root_id)) order by e.created_at)
                    from public.branch_editors e), '[]'::jsonb) end,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id, 'full_name', case when (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis and not coalesce(m.name_public, false) and not (v_scope is not null and m.id = any(v_scope))))) then 'ابنة الأسرة' else m.full_name end,
          'name_masked', (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis and not coalesce(m.name_public, false) and not (v_scope is not null and m.id = any(v_scope))))), 'name_hidden', coalesce(m.name_hidden, false),
          'nickname', case when (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis and not coalesce(m.name_public, false) and not (v_scope is not null and m.id = any(v_scope))))) then null else m.nickname end,
          'name_public', coalesce(m.name_public, false), 'gender', m.gender,
          'father_id', m.father_id, 'wife_mother_id', m.wife_mother_id,
          'birth_date', m.birth_date, 'death_date', m.death_date, 'is_alive', m.is_alive,
          'birth_year_text', m.birth_year_text, 'death_year_text', m.death_year_text,
          'birth_order', m.birth_order, 'city', m.city, 'photo_url', m.photo_url, 'audio_url', m.audio_url,
          'achievement_badge', m.achievement_badge, 'bio', m.bio, 'biography_story', m.biography_story,
          'created_at', m.created_at)
        || case when v_priv or m.id = any(v_scope) then jsonb_build_object('phone', m.phone) else '{}'::jsonb end
        order by m.created_at)
        from public.members m), '[]'::jsonb),
    'wives', case when v_seen then coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'husband_id', w.husband_id, 'full_name', case when (not v_priv and (coalesce(w.name_hidden, false) or coalesce((select lm.name_hidden from public.members lm where lm.id = w.member_id), false) or (not v_wvis and not (coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false)) and not (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope)))))) then 'زوجة' else public._woman_name(coalesce((select lm.full_name from public.members lm where lm.id = w.member_id), w.full_name),
            coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false),
            (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope))),
            'زوجة ' || coalesce((select h.full_name from public.members h where h.id = w.husband_id), 'أحد أفراد الأسرة'), (not v_wvis and not v_priv)) end,
                                          'name_masked', (not v_priv and (coalesce(w.name_hidden, false) or coalesce((select lm.name_hidden from public.members lm where lm.id = w.member_id), false) or (not v_wvis and not (coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false)) and not (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope)))))),
                                          'family_name', case when (not v_priv and (coalesce(w.name_hidden, false) or coalesce((select lm.name_hidden from public.members lm where lm.id = w.member_id), false) or (not v_wvis and not (coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false)) and not (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope)))))) then null else w.family_name end,
                                          'member_id', w.member_id, 'name_public', coalesce(w.name_public, false), 'created_at', w.created_at) order by w.created_at)
        from public.wives w), '[]'::jsonb) else '[]'::jsonb end,
    'events', case when v_seen then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'event_date', e.event_date,
                                          'location_name', e.location_name, 'location_url', e.location_url,
                                          'description', e.description, 'story', e.story,
                                          'doc_code', case when v_priv then e.doc_code else null end,
                                          'media_count', (select count(*) from public.event_media em where em.event_id = e.id)) order by e.event_date)
        from public.family_events e), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

-- ---------------------------------------------------------------------
-- 6) الاقتراحات
-- ---------------------------------------------------------------------
create function public.submit_suggestion(
  p_code text, p_target_member_id uuid, p_request_type text, p_proposed_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_mode text; v_role text;
begin
  select access_mode into v_mode from public.system_settings where id = 1;
  v_role := public._authenticate(p_code);
  if v_role = '__locked__' then return public._deny(v_role); end if;
  if v_mode = 'family_code' and v_role is null then return public._fail('رمز العائلة مطلوب'); end if;
  if p_proposed_data is null or length(p_proposed_data::text) > 4000 then
    return public._fail('نص الاقتراح طويل جدًا');
  end if;
  insert into public.change_requests (target_member_id, request_type, proposed_data)
  values (p_target_member_id, left(coalesce(p_request_type, 'correction'), 40), p_proposed_data);
  return jsonb_build_object('success', true);
end $$;

create function public.list_suggestions(p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  return jsonb_build_object('success', true, 'items', coalesce((
    select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.change_requests c), '[]'::jsonb));
end $$;

create function public.secure_delete_suggestion(suggestion_id uuid, passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  delete from public.change_requests where id = suggestion_id;
  return jsonb_build_object('success', true);
end $$;

-- ---------------------------------------------------------------------
-- 7) الكتابة على الأفراد والزوجات (المالك والمحرر: الكل، ومسؤول الفرع: فرعه)
-- ---------------------------------------------------------------------
create function public.secure_save_member(
  p_id uuid, p_full_name text, p_nickname text, p_gender text, p_father_id uuid,
  p_wife_mother_id uuid, p_birth_order integer, p_phone text, p_is_alive boolean,
  p_birth_year_text text, p_death_year_text text, p_biography_story text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text; v_branch uuid; v_new_id uuid; v_exists boolean; v_cur_father uuid;
  v_gender public.members.gender%type;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then return public._fail('الاسم مطلوب'); end if;

  v_exists := exists (select 1 from public.members where id = p_id);

  if v_role = 'branch' then
    if v_exists then
      select father_id into v_cur_father from public.members where id = p_id;
      if not public._in_branch(v_branch, p_id) or p_father_id is distinct from v_cur_father then
        return public._fail('هذا الفرد خارج صلاحية فرعك');
      end if;
    else
      if p_father_id is null or not public._in_branch(v_branch, p_father_id) then
        return public._fail('يمكنك الإضافة داخل فرعك فقط');
      end if;
    end if;
    if p_wife_mother_id is not null
       and not exists (select 1 from public.wives where id = p_wife_mother_id and husband_id = p_father_id) then
      return public._fail('الأم المختارة غير صالحة');
    end if;
  end if;

  begin  -- تحويل الجنس إلى نوع العمود الفعلي مهما كان اسمه
    v_gender := (jsonb_populate_record(null::public.members, jsonb_build_object('gender', p_gender))).gender;
  exception when others then
    return public._fail('قيمة الجنس غير صالحة');
  end;

  perform set_config('app.actor', public._actor(v_role, v_branch), true);

  if v_exists then
    update public.members set
      full_name = trim(p_full_name), nickname = p_nickname, gender = v_gender,
      father_id = p_father_id, wife_mother_id = p_wife_mother_id,
      birth_order = coalesce(p_birth_order, 1), phone = p_phone, is_alive = p_is_alive,
      birth_year_text = p_birth_year_text, death_year_text = p_death_year_text,
      biography_story = p_biography_story
    where id = p_id;
    v_new_id := p_id;
  else
    insert into public.members (id, full_name, nickname, gender, father_id, wife_mother_id,
      birth_order, phone, is_alive, birth_year_text, death_year_text, biography_story)
    values (coalesce(p_id, gen_random_uuid()), trim(p_full_name), p_nickname, v_gender, p_father_id,
      p_wife_mother_id, coalesce(p_birth_order, 1), p_phone, p_is_alive, p_birth_year_text,
      p_death_year_text, p_biography_story)
    returning id into v_new_id;
  end if;
  return jsonb_build_object('success', true, 'id', v_new_id);
end $$;

create function public.secure_update_member_extras(
  p_id uuid, p_city text, p_achievement_badge text, p_audio_url text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  if v_role = 'branch' and not public._in_branch(v_branch, p_id) then
    return public._fail('هذا الفرد خارج صلاحية فرعك');
  end if;
  perform set_config('app.actor', public._actor(v_role, v_branch), true);
  update public.members set city = p_city, achievement_badge = p_achievement_badge, audio_url = p_audio_url where id = p_id;
  return jsonb_build_object('success', true);
end $$;

create function public.secure_save_wife(
  p_husband_id uuid, p_full_name text, p_family_name text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_wife_id uuid;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then return public._fail('الاسم مطلوب'); end if;
  if v_role = 'branch' and not public._in_branch(v_branch, p_husband_id) then
    return public._fail('هذا الفرد خارج صلاحية فرعك');
  end if;
  perform set_config('app.actor', public._actor(v_role, v_branch), true);
  insert into public.wives (husband_id, full_name, family_name)
  values (p_husband_id, trim(p_full_name), p_family_name) returning id into v_wife_id;
  return jsonb_build_object('success', true, 'id', v_wife_id);
end $$;

create function public.secure_delete_wife(wife_id uuid, passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_husband uuid;
begin
  select * into v_role, v_branch from public._who(passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  select husband_id into v_husband from public.wives where id = wife_id;
  if v_role = 'branch' and (v_husband is null or not public._in_branch(v_branch, v_husband)) then
    return public._fail('هذه الزوجة خارج صلاحية فرعك');
  end if;
  perform set_config('app.actor', public._actor(v_role, v_branch), true);
  begin
    delete from public.wives where id = wife_id;
  exception when foreign_key_violation then
    return public._fail('لا يمكن الحذف: لها أبناء مسجّلون');
  end;
  return jsonb_build_object('success', true);
end $$;

create function public.secure_delete_member(member_id uuid, passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  perform set_config('app.actor', public._actor(v_role, null), true);
  begin
    delete from public.members where id = member_id;
  exception when foreign_key_violation then
    return public._fail('لا يمكن الحذف: للفرد أبناء أو زوجات مرتبطة');
  end;
  return jsonb_build_object('success', true);
end $$;

-- ---------------------------------------------------------------------
-- 8) المناسبات (المالك والمحرر فقط)
-- ---------------------------------------------------------------------
create function public.secure_save_event(
  p_id uuid, p_title text, p_event_date timestamptz, p_location_name text,
  p_location_url text, p_description text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor') then return public._deny(v_role); end if;
  if p_title is null or length(trim(p_title)) = 0 or p_event_date is null then
    return public._fail('العنوان والموعد مطلوبان');
  end if;
  if p_location_url is not null and p_location_url !~* '^https?://' then
    return public._fail('رابط الخريطة غير صالح');
  end if;
  perform set_config('app.actor', public._actor(v_role, null), true);
  if p_id is not null and exists (select 1 from public.family_events where id = p_id) then
    update public.family_events
       set title = trim(p_title), event_date = p_event_date, location_name = p_location_name,
           location_url = p_location_url, description = p_description
     where id = p_id;
    v_id := p_id;
  else
    insert into public.family_events (title, event_date, location_name, location_url, description)
    values (trim(p_title), p_event_date, p_location_name, p_location_url, p_description)
    returning id into v_id;
  end if;
  return jsonb_build_object('success', true, 'id', v_id);
end $$;

create function public.secure_delete_event(event_id uuid, passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(passcode);
  if coalesce(v_role, '') not in ('owner', 'editor') then return public._deny(v_role); end if;
  perform set_config('app.actor', public._actor(v_role, null), true);
  delete from public.family_events where id = event_id;
  return jsonb_build_object('success', true);
end $$;

-- ---------------------------------------------------------------------
-- 9) إعدادات الوصول والرموز (المالك فقط)
-- ---------------------------------------------------------------------
create function public.secure_set_access_mode(p_mode text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  if p_mode not in ('open_link', 'family_code') then return public._fail('وضع غير معروف'); end if;
  update public.system_settings set access_mode = p_mode where id = 1;
  return jsonb_build_object('success', true, 'mode', p_mode);
end $$;

create function public.secure_set_family_code(p_new_code text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_r text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  if p_new_code is null or length(p_new_code) < 6 then return public._fail('رمز العائلة قصير (6 خانات على الأقل)'); end if;
  v_r := public._role_of(p_new_code);
  if v_r is not null and v_r <> 'family' then return public._fail('هذا الرمز مستخدم لدور آخر، اختر رمزًا مختلفًا'); end if;
  update public.system_settings set family_code_hash = crypt(p_new_code, gen_salt('bf')) where id = 1;
  return jsonb_build_object('success', true);
end $$;

create function public.secure_set_editor_code(p_new_code text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_r text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  if p_new_code is null or length(p_new_code) < 8 then return public._fail('رمز المحرر قصير (8 خانات على الأقل)'); end if;
  v_r := public._role_of(p_new_code);
  if v_r is not null and v_r <> 'editor' then return public._fail('هذا الرمز مستخدم لدور آخر، اختر رمزًا مختلفًا'); end if;
  update public.system_settings set editor_passcode_hash = crypt(p_new_code, gen_salt('bf')) where id = 1;
  return jsonb_build_object('success', true);
end $$;

-- مسؤول الفرع: يُختار من أفراد الفرع نفسه، والمالك وحده يعيّنه ويغيّره
create function public.secure_set_branch_editor(
  p_branch_root uuid, p_delegate uuid, p_code text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_label text; v_r text; v_other uuid;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  if not exists (select 1 from public.members where id = p_branch_root) then
    return public._fail('رأس الفرع غير موجود');
  end if;
  select full_name into v_label from public.members where id = p_delegate;
  if v_label is null or not public._in_branch(p_branch_root, p_delegate) then
    return public._fail('المسؤول يجب أن يكون من أفراد الفرع');
  end if;

  if p_code is null or length(p_code) = 0 then
    update public.branch_editors set delegate_member_id = p_delegate, label = v_label, updated_at = now()
     where branch_root_id = p_branch_root;
    if not found then return public._fail('أدخل رمزًا للمسؤول الجديد'); end if;
  else
    if length(p_code) < 8 then return public._fail('الرمز قصير (8 خانات على الأقل)'); end if;
    v_r := public._role_of(p_code);
    if v_r is not null and v_r <> 'branch' then
      return public._fail('هذا الرمز مستخدم لدور آخر، اختر رمزًا مختلفًا');
    end if;
    v_other := public._branch_of(p_code);
    if v_other is not null and v_other <> p_branch_root then
      return public._fail('هذا الرمز مستخدم لفرع آخر، اختر رمزًا مختلفًا');
    end if;
    insert into public.branch_editors (branch_root_id, delegate_member_id, label, passcode_hash)
    values (p_branch_root, p_delegate, v_label, crypt(p_code, gen_salt('bf')))
    on conflict (branch_root_id) do update
      set delegate_member_id = excluded.delegate_member_id, label = excluded.label,
          passcode_hash = excluded.passcode_hash, updated_at = now();
  end if;

  insert into public.change_log (actor, table_name, row_id, action, label, changes)
  values (public._actor(v_role, null), 'branch_editors', p_branch_root, 'set', v_label,
          jsonb_build_object('full_name', v_label));
  return jsonb_build_object('success', true);
end $$;

create function public.secure_clear_branch_editor(p_branch_root uuid, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_label text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  select label into v_label from public.branch_editors where branch_root_id = p_branch_root;
  delete from public.branch_editors where branch_root_id = p_branch_root;
  if v_label is not null then
    insert into public.change_log (actor, table_name, row_id, action, label, changes)
    values (public._actor(v_role, null), 'branch_editors', p_branch_root, 'clear', v_label, '{}'::jsonb);
  end if;
  return jsonb_build_object('success', true);
end $$;

-- ---------------------------------------------------------------------
-- 10) سجل التغييرات واللقطات
-- ---------------------------------------------------------------------
create function public.list_changes(p_passcode text, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  return jsonb_build_object('success', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('at', t.created_at, 'actor', t.actor, 'table', t.table_name,
                                        'action', t.action, 'label', t.label, 'changes', t.changes) order by t.id desc)
      from (select * from public.change_log order by id desc limit least(coalesce(p_limit, 200), 500)) t), '[]'::jsonb));
end $$;

create function public._take_snapshot(p_label text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.snapshots (label, data)
  values (p_label, jsonb_build_object(
    'members', coalesce((select jsonb_agg(to_jsonb(m)) from public.members m), '[]'::jsonb),
    'wives',   coalesce((select jsonb_agg(to_jsonb(w)) from public.wives w), '[]'::jsonb),
    'events',  coalesce((select jsonb_agg(to_jsonb(e)) from public.family_events e), '[]'::jsonb)))
  returning id into v_id;
  delete from public.snapshots where id not in (select id from public.snapshots order by id desc limit 20);
  return v_id;
end $$;

create function public.secure_snapshot(p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_id bigint;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  v_id := public._take_snapshot('يدوي');
  return jsonb_build_object('success', true, 'id', v_id);
end $$;

-- الاستعادة: من SQL Editor فقط (لا تُستدعى من المتصفح). تأخذ لقطة قبل أن تمسح شيئًا.
--   select public.admin_restore_snapshot(<رقم اللقطة>, 'RESTORE');
--   select public.admin_restore('<محتوى ملف JSON المصدَّر>'::jsonb, 'RESTORE');
create function public.admin_restore(p_data jsonb, p_confirm text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_n integer;
begin
  if p_confirm is distinct from 'RESTORE' then raise exception 'للتأكيد مرّر الكلمة RESTORE'; end if;
  if jsonb_typeof(p_data -> 'members') is distinct from 'array' then raise exception 'الملف غير صالح: لا يحتوي مصفوفة members'; end if;

  perform public._take_snapshot('قبل الاستعادة');
  perform set_config('app.actor', 'استعادة', true);

  drop table if exists _rm, _wm, _be;
  create temp table _rm on commit drop as select * from jsonb_populate_recordset(null::public.members, p_data -> 'members');
  create temp table _wm on commit drop as select id, wife_mother_id from _rm where wife_mother_id is not null;
  create temp table _be on commit drop as select * from public.branch_editors;
  update _rm set wife_mother_id = null;

  update public.members set wife_mother_id = null;
  delete from public.wives;
  delete from public.members;   -- يحذف معه مسؤولي الفروع (نسخة منهم في _be)

  insert into public.members (id, full_name, nickname, gender, father_id, birth_date, death_date, is_alive, phone, photo_url,
      bio, biography_story, birth_year_text, death_year_text, birth_order, city, audio_url, achievement_badge, created_at)
    select id, full_name, nickname, gender, father_id, birth_date, death_date, is_alive, phone, photo_url,
      bio, biography_story, birth_year_text, death_year_text, birth_order, city, audio_url, achievement_badge, coalesce(created_at, now())
      from _rm;
  get diagnostics v_n = row_count;

  if jsonb_typeof(p_data -> 'wives') = 'array' then
    insert into public.wives (id, husband_id, full_name, family_name, created_at)
      select id, husband_id, full_name, family_name, coalesce(created_at, now())
        from jsonb_populate_recordset(null::public.wives, p_data -> 'wives');
  end if;
  update public.members m set wife_mother_id = w.wife_mother_id from _wm w
   where m.id = w.id and exists (select 1 from public.wives x where x.id = w.wife_mother_id);

  if jsonb_typeof(p_data -> 'events') = 'array' then
    delete from public.family_events;
    insert into public.family_events (id, title, event_date, location_name, location_url, description, created_at)
      select id, title, event_date, location_name, location_url, description, coalesce(created_at, now())
        from jsonb_populate_recordset(null::public.family_events, p_data -> 'events');
  end if;

  insert into public.branch_editors (id, branch_root_id, delegate_member_id, label, passcode_hash, created_at, updated_at)
    select b.id, b.branch_root_id,
           case when exists (select 1 from public.members m where m.id = b.delegate_member_id) then b.delegate_member_id end,
           b.label, b.passcode_hash, b.created_at, b.updated_at
      from _be b where exists (select 1 from public.members m where m.id = b.branch_root_id);

  return 'تمت الاستعادة: ' || v_n || ' فردًا';
end $$;

create function public.admin_restore_snapshot(p_id bigint, p_confirm text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  select data into v from public.snapshots where id = p_id;
  if v is null then raise exception 'لا توجد لقطة بهذا الرقم'; end if;
  return public.admin_restore(v, p_confirm);
end $$;

-- ---------------------------------------------------------------------
-- 11) إغلاق الدوال الداخلية أمام المتصفح
-- ---------------------------------------------------------------------
revoke execute on function
  public.verify_owner(text), public.verify_editor(text), public.verify_family(text),
  public._branch_of(text), public._in_branch(uuid, uuid), public._branch_members(uuid),
  public._role_of(text), public._client_ip(), public._authenticate(text), public._who(text),
  public._fail(text), public._deny(text), public._actor(text, uuid), public._audit(),
  public._take_snapshot(text), public.admin_restore(jsonb, text), public.admin_restore_snapshot(bigint, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 12) إغلاق القراءة والكتابة المباشرة على الجداول (كل شيء عبر الدوال أعلاه)
-- ---------------------------------------------------------------------
drop policy if exists "Allow update members all" on public.members;
drop policy if exists "Allow insert for testing" on public.members;
drop policy if exists "Allow read members for all" on public.members;
drop policy if exists "Allow select members" on public.members;
drop policy if exists "Members viewable by authenticated users" on public.members;
drop policy if exists "Allow insert wives" on public.wives;
drop policy if exists "Allow delete wives" on public.wives;
drop policy if exists "Allow all wives" on public.wives;
drop policy if exists "Allow update wives" on public.wives;
drop policy if exists "Allow select wives" on public.wives;
drop policy if exists "Allow read wives" on public.wives;
drop policy if exists "Allow read events for all" on public.family_events;
drop policy if exists "Allow insert suggestions" on public.change_requests;
drop policy if exists "Allow select suggestions" on public.change_requests;
drop policy if exists "Allow update feature_flags" on public.feature_flags;

alter table public.members         enable row level security;
alter table public.wives           enable row level security;
alter table public.family_events   enable row level security;
alter table public.change_requests enable row level security;

revoke all on public.members, public.wives, public.family_events, public.change_requests from anon, authenticated;
revoke insert, update, delete on public.feature_flags from anon, authenticated;

do $$
begin
  if to_regclass('public.safe_members_view') is not null then
    execute 'revoke all on public.safe_members_view from anon, authenticated';
  end if;
end $$;

-- ============================================================
-- القسم 8: إعلانات البطاقات (تهنئة/تعزية تظهر لكل الزوار)
--   تُنشر تلقائيًا عند إضافة مولود أو تسجيل وفاة، وتبقى 7 أيام ثم تختفي.
-- ============================================================
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('birth','condolence')),
  member_id uuid references public.members(id) on delete cascade,
  member_name text not null,
  gender text not null default 'male',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
alter table public.announcements enable row level security;
revoke all on public.announcements from anon, authenticated;

-- ربط فعلي بالعضو (طلب المالك 2026-10-22): حذف العضو يحذف إعلانه فورًا بدل بقائه بلا صاحب،
-- مع تنظيف أي إعلانات يتيمة موجودة من عمليات حذف سابقة (كانت العلاقة on delete set null).
do $$ begin
  alter table public.announcements drop constraint if exists announcements_member_id_fkey;
  alter table public.announcements add constraint announcements_member_id_fkey
    foreign key (member_id) references public.members(id) on delete cascade;
exception when others then null; end $$;
delete from public.announcements where member_id is null
   or member_id not in (select id from public.members);

create or replace function public.secure_post_announcement(p_passcode text, p_kind text, p_member_id uuid, p_member_name text, p_gender text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null or v_role not in ('owner', 'editor', 'branch') then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if p_kind not in ('birth', 'condolence') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if v_role = 'branch' then
    v_branch := public._branch_of(p_passcode);
    if p_member_id is null or not public._in_branch(v_branch, p_member_id) then
      return jsonb_build_object('ok', false, 'error', 'out_of_scope');
    end if;
  end if;
  insert into public.announcements(kind, member_id, member_name, gender)
  values (p_kind, p_member_id, left(coalesce(p_member_name, ''), 120), case when p_gender = 'female' then 'female' else 'male' end)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.get_announcements(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_code);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'code_required'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'member_id', member_id,
      'member_name', member_name, 'gender', gender, 'created_at', created_at, 'expires_at', expires_at)
      order by created_at desc)
    from public.announcements where expires_at > now()), '[]'::jsonb));
end $$;

grant execute on function public.secure_post_announcement(text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.get_announcements(text) to anon, authenticated;

-- ============================================================
-- القسم 10: رموز قراءة الفروع، سجل الدخول، إخفاء أسماء النساء،
--          ربط الزوجات بسجلاتهن، وصور الأعضاء
-- ============================================================
create table if not exists public.branch_access_codes (
  branch_root_id uuid primary key references public.members(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.branch_access_codes enable row level security;
revoke all on public.branch_access_codes from anon, authenticated;

create table if not exists public.access_log (
  id bigint generated always as identity primary key,
  role text not null,
  branch_root_id uuid,
  ip text,
  created_at timestamptz not null default now()
);
alter table public.access_log enable row level security;
revoke all on public.access_log from anon, authenticated;

create table if not exists public.member_photos (
  member_id uuid primary key references public.members(id) on delete cascade,
  photo text not null,
  updated_at timestamptz not null default now()
);
alter table public.member_photos enable row level security;
revoke all on public.member_photos from anon, authenticated;

alter table public.members add column if not exists name_public boolean not null default false;
alter table public.wives add column if not exists name_public boolean not null default false;
alter table public.members add column if not exists name_hidden boolean not null default false;
alter table public.wives add column if not exists name_hidden boolean not null default false;
alter table public.wives add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.system_settings add column if not exists women_names_visible boolean not null default true;

-- اسم امرأة كما يجب أن يصل لكل دور: مقنّع إن فُعّل الإخفاء ولا استثناء ولا نطاق
create or replace function public._woman_name(p_real text, p_public boolean, p_scope_hit boolean, p_masked text, p_hide boolean)
returns text language sql immutable as $$
  select case when p_hide and not coalesce(p_public, false) and not coalesce(p_scope_hit, false) then p_masked else p_real end;
$$;

create or replace function public.secure_set_women_names_visible(p_passcode text, p_visible boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  update public.system_settings set women_names_visible = coalesce(p_visible, true) where id = 1;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.secure_set_branch_read_code(p_passcode text, p_root uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role is distinct from 'owner' then return public._deny(v_role); end if;
  if p_code is null or length(p_code) = 0 then
    delete from public.branch_access_codes where branch_root_id = p_root;
  else
    if length(p_code) < 6 then return public._fail('الرمز قصير: 6 خانات فأكثر'); end if;
    insert into public.branch_access_codes(branch_root_id, code_hash)
    values (p_root, crypt(p_code, gen_salt('bf')))
    on conflict (branch_root_id) do update set code_hash = excluded.code_hash, updated_at = now();
  end if;
  return jsonb_build_object('success', true);
end $$;

-- الزوجة: توقيع جديد (ربط بعضوة + استثناء الإظهار) — يُسقَط القديم أولًا
drop function if exists public.secure_save_wife(uuid, text, text, text);
drop function if exists public.secure_save_wife(uuid, text, text, uuid, boolean, text);
create function public.secure_save_wife(
  p_husband_id uuid, p_full_name text, p_family_name text, p_member_id uuid, p_name_public boolean, p_name_hidden boolean, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_wife_id uuid;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then return public._fail('الاسم مطلوب'); end if;
  if v_role = 'branch' and not public._in_branch(v_branch, p_husband_id) then
    return public._fail('هذا الفرد خارج صلاحية فرعك');
  end if;
  perform set_config('app.actor', public._actor(v_role, v_branch), true);
  insert into public.wives (husband_id, full_name, family_name, member_id, name_public, name_hidden)
  values (p_husband_id, trim(p_full_name), p_family_name, p_member_id, coalesce(p_name_public, false), coalesce(p_name_hidden, false)) returning id into v_wife_id;
  return jsonb_build_object('success', true, 'id', v_wife_id);
end $$;

drop function if exists public.secure_update_member_extras(uuid, text, text, text, text);
drop function if exists public.secure_update_member_extras(uuid, text, text, text, text, boolean);
create function public.secure_update_member_extras(
  p_id uuid, p_city text, p_achievement_badge text, p_audio_url text, p_passcode text, p_name_public boolean, p_name_hidden boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  if v_role = 'branch' and not public._in_branch(v_branch, p_id) then
    return public._fail('هذا الفرد خارج صلاحية فرعك');
  end if;
  perform set_config('app.actor', public._actor(v_role, v_branch), true);
  update public.members set city = p_city, achievement_badge = p_achievement_badge, audio_url = p_audio_url,
    name_public = coalesce(p_name_public, false), name_hidden = coalesce(p_name_hidden, false) where id = p_id;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.secure_set_photo(p_passcode text, p_member_id uuid, p_photo text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if v_role = 'branch' and not public._in_branch(v_branch, p_member_id) then
    return jsonb_build_object('ok', false, 'error', 'out_of_scope');
  end if;
  if p_photo is null then
    delete from public.member_photos where member_id = p_member_id;
  else
    if length(p_photo) > 70000 then return jsonb_build_object('ok', false, 'error', 'too_large'); end if;
    insert into public.member_photos(member_id, photo) values (p_member_id, p_photo)
    on conflict (member_id) do update set photo = excluded.photo, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_photos(p_code text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_priv boolean; v_wvis boolean; v_scope uuid[];
begin
  select * into v_role, v_branch from public._who(p_code);
  if v_role is null or v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  v_priv := v_role in ('owner', 'editor');
  select coalesce(women_names_visible, true) into v_wvis from public.system_settings where id = 1;
  if v_role = 'branch' and v_branch is not null then
    select coalesce(array_agg(b.id), '{}') into v_scope from public._branch_members(v_branch) b;
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('member_id', ph.member_id, 'photo', ph.photo))
    from public.member_photos ph join public.members m on m.id = ph.member_id
    where ph.member_id = any(p_ids)
      and not (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis
               and not coalesce(m.name_public, false)
               and not (v_scope is not null and m.id = any(v_scope)))))), '[]'::jsonb));
end $$;

-- إعلانات البطاقات: مرتبطة بالعضو فعليًا — حذفه يحذف إعلانه، واليتيمة لا تظهر أبدًا،
-- والمخفية اسمها لا يظهر إعلانها للزوار أصلًا (طلب المالك 2026-10-22 بدل «ابنة فلان»)
create or replace function public.get_announcements(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_priv boolean; v_wvis boolean; v_scope uuid[];
begin
  select * into v_role, v_branch from public._who(p_code);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'code_required'); end if;
  v_priv := v_role in ('owner', 'editor');
  select coalesce(women_names_visible, true) into v_wvis from public.system_settings where id = 1;
  if v_role = 'branch' and v_branch is not null then
    select coalesce(array_agg(b.id), '{}') into v_scope from public._branch_members(v_branch) b;
  end if;
  delete from public.announcements a where a.member_id is null
     or not exists (select 1 from public.members m where m.id = a.member_id);
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'member_id', a.member_id,
      'member_name', a.member_name,
      'gender', a.gender, 'created_at', a.created_at, 'expires_at', a.expires_at) order by a.created_at desc)
    from public.announcements a
    join public.members mm on mm.id = a.member_id
    where a.expires_at > now()
      and not (not v_priv and (coalesce(mm.name_hidden, false) or (mm.gender = 'female' and not v_wvis and not coalesce(mm.name_public, false)
               and not (v_scope is not null and mm.id = any(v_scope)))))), '[]'::jsonb));
end $$;

grant execute on function public.secure_set_women_names_visible(text, boolean) to anon, authenticated;
grant execute on function public.secure_set_branch_read_code(text, uuid, text) to anon, authenticated;
grant execute on function public.secure_save_wife(uuid, text, text, uuid, boolean, boolean, text) to anon, authenticated;
grant execute on function public.secure_update_member_extras(uuid, text, text, text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.secure_set_photo(text, uuid, text) to anon, authenticated;
grant execute on function public.get_photos(text, uuid[]) to anon, authenticated;
grant execute on function public.get_announcements(text) to anon, authenticated;

-- حذف إعلان من الواجهة (زر ✕ للمالك والمحرر — طلب المالك 2026-10-22)
create or replace function public.secure_delete_announcement(p_passcode text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null or v_role not in ('owner', 'editor') then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  delete from public.announcements where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.secure_delete_announcement(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- توثيق المناسبات للأجيال: صور داخل الموقع + روابط فيديو + حكاية،
-- وصلاحية لصاحب المناسبة عبر «رمز توثيق» خاص بمناسبته (طلب المالك 2026-10-22)
-- ---------------------------------------------------------------------
alter table public.family_events add column if not exists doc_code text;
alter table public.family_events add column if not exists story text;
create table if not exists public.event_media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.family_events(id) on delete cascade,
  kind text not null check (kind in ('photo', 'video')),
  url text not null,
  caption text,
  created_at timestamptz not null default now()
);
alter table public.event_media enable row level security;
revoke all on public.event_media from anon, authenticated;

create or replace function public._event_doc_ok(p_passcode text, p_event_id uuid) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from public.family_events e
                  where e.id = p_event_id and e.doc_code is not null
                    and length(e.doc_code) >= 4 and e.doc_code = p_passcode);
$$;
revoke execute on function public._event_doc_ok(text, uuid) from public, anon, authenticated;

create or replace function public.get_event_media(p_code text, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_code);
  if v_role is null or v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', em.id, 'kind', em.kind, 'url', em.url, 'caption', em.caption) order by em.created_at)
      from public.event_media em where em.event_id = p_event_id), '[]'::jsonb));
end $$;
grant execute on function public.get_event_media(text, uuid) to anon, authenticated;

create or replace function public.secure_add_event_media(p_passcode text, p_event_id uuid, p_kind text, p_url text, p_caption text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not (coalesce(v_role, '') in ('owner', 'editor') or public._event_doc_ok(p_passcode, p_event_id)) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  if p_kind not in ('photo', 'video') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_kind = 'video' and coalesce(p_url, '') !~* '^https?://' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  if p_kind = 'photo' and (coalesce(p_url, '') !~ '^data:image/' or length(p_url) > 600000) then return jsonb_build_object('ok', false, 'error', 'bad_photo'); end if;
  if (select count(*) from public.event_media where event_id = p_event_id) >= 60 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  insert into public.event_media (event_id, kind, url, caption)
  values (p_event_id, p_kind, p_url, nullif(trim(coalesce(p_caption, '')), '')) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.secure_add_event_media(text, uuid, text, text, text) to anon, authenticated;

create or replace function public.secure_delete_event_media(p_passcode text, p_media_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_event uuid;
begin
  select event_id into v_event from public.event_media where id = p_media_id;
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not (coalesce(v_role, '') in ('owner', 'editor') or public._event_doc_ok(p_passcode, v_event)) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  delete from public.event_media where id = p_media_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.secure_delete_event_media(text, uuid) to anon, authenticated;

create or replace function public.secure_set_event_story(p_passcode text, p_event_id uuid, p_story text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not (coalesce(v_role, '') in ('owner', 'editor') or public._event_doc_ok(p_passcode, p_event_id)) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  update public.family_events set story = nullif(trim(coalesce(p_story, '')), '') where id = p_event_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.secure_set_event_story(text, uuid, text) to anon, authenticated;

-- تحقق فوري من رمز التوثيق + مصادقة وسائط لا تلوّث عدّاد القفل برموز التوثيق الصحيحة
create or replace function public._media_auth(p_passcode text, p_event_id uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_ip text := public._client_ip(); v_role text;
begin
  if p_passcode is null or length(p_passcode) = 0 then return false; end if;
  if (select count(*) from public.auth_attempts where ip = v_ip and created_at > now() - interval '15 minutes') >= 8 then return false; end if;
  if public._event_doc_ok(p_passcode, p_event_id) then return true; end if;
  v_role := public._role_of(p_passcode);
  if v_role in ('owner', 'editor') then return true; end if;
  insert into public.auth_attempts (ip) values (v_ip);
  delete from public.auth_attempts where created_at < now() - interval '1 day';
  return false;
end $$;
revoke execute on function public._media_auth(text, uuid) from public, anon, authenticated;

create or replace function public.verify_event_doc(p_passcode text, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select count(*) from public.auth_attempts where ip = public._client_ip() and created_at > now() - interval '15 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  return jsonb_build_object('ok', public._media_auth(p_passcode, p_event_id));
end $$;
grant execute on function public.verify_event_doc(text, uuid) to anon, authenticated;

create or replace function public.secure_add_event_media(p_passcode text, p_event_id uuid, p_kind text, p_url text, p_caption text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not public._media_auth(p_passcode, p_event_id) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if p_kind not in ('photo', 'video') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_kind = 'video' and coalesce(p_url, '') !~* '^https?://' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  if p_kind = 'photo' and (coalesce(p_url, '') !~ '^data:image/' or length(p_url) > 600000) then return jsonb_build_object('ok', false, 'error', 'bad_photo'); end if;
  if (select count(*) from public.event_media where event_id = p_event_id) >= 60 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  insert into public.event_media (event_id, kind, url, caption)
  values (p_event_id, p_kind, p_url, nullif(trim(coalesce(p_caption, '')), '')) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.secure_delete_event_media(p_passcode text, p_media_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_event uuid;
begin
  select event_id into v_event from public.event_media where id = p_media_id;
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public._media_auth(p_passcode, v_event) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  delete from public.event_media where id = p_media_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.secure_set_event_story(p_passcode text, p_event_id uuid, p_story text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._media_auth(p_passcode, p_event_id) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  update public.family_events set story = nullif(trim(coalesce(p_story, '')), '') where id = p_event_id;
  return jsonb_build_object('ok', true);
end $$;


-- حفظ المناسبة: توقيع جديد يضيف رمز التوثيق
drop function if exists public.secure_save_event(uuid, text, timestamptz, text, text, text, text);
create function public.secure_save_event(
  p_id uuid, p_title text, p_event_date timestamptz, p_location_name text,
  p_location_url text, p_description text, p_doc_code text, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor') then return public._deny(v_role); end if;
  if p_title is null or length(trim(p_title)) = 0 or p_event_date is null then
    return public._fail('العنوان والموعد مطلوبان');
  end if;
  if p_location_url is not null and p_location_url !~* '^https?://' then
    return public._fail('رابط الخريطة غير صالح');
  end if;
  perform set_config('app.actor', public._actor(v_role, null), true);
  if p_id is not null and exists (select 1 from public.family_events where id = p_id) then
    update public.family_events
       set title = trim(p_title), event_date = p_event_date, location_name = p_location_name,
           location_url = p_location_url, description = p_description,
           doc_code = nullif(trim(coalesce(p_doc_code, '')), '')
     where id = p_id;
    v_id := p_id;
  else
    insert into public.family_events (title, event_date, location_name, location_url, description, doc_code)
    values (trim(p_title), p_event_date, p_location_name, p_location_url, p_description, nullif(trim(coalesce(p_doc_code, '')), ''))
    returning id into v_id;
  end if;
  return jsonb_build_object('success', true, 'id', v_id);
end $$;


commit;

-- =====================================================================
-- بعد التشغيل (كل أمر وحده، وغيّر القيم ولا ترسلها لأحد):
--   update system_settings set editor_passcode_hash = crypt('رمز-المحرر-8+', gen_salt('bf')) where id = 1;
--   update system_settings set family_code_hash     = crypt('رمز-العائلة-6+', gen_salt('bf')) where id = 1;
--   select verify_owner('1234');     -- يجب أن تكون النتيجة false (وإلا غيّر رمز المالك)
--   select get_bundle(null)->>'error';   -- يجب أن تكون code_required
-- ثم من Supabase: Authentication ← Providers ← Email ← عطّل Allow new users to sign up
-- (لا نستخدم حسابات Supabase، ولا نريد أن يسجّل أحد حسابًا بالمفتاح العام).
-- =====================================================================

-- ============================================================
-- القسم 9: صندوق الرسائل v2 — مقترح / استفسار / طلب تعديل معلومة
--   • اسم المقدِّم شرط أساسي في كل الأنواع (لا طلبات مجهولة).
--   • طلب التعديل منظّم (عضو + حقل + قيمة جديدة) ويُعرض «الحالي ← المقترح».
--   • الاعتماد من المالك أو المحرر أو مسؤول الفرع (ضمن فرعه فقط)
--     يطبّق التعديل مباشرة بضغطة «اعتماد وتطبيق».
-- ============================================================
create or replace function public.submit_suggestion(
  p_code text, p_target_member_id uuid, p_request_type text, p_proposed_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_mode text; v_role text; v_from text; v_type text; v_field text;
begin
  select access_mode into v_mode from public.system_settings where id = 1;
  v_role := public._authenticate(p_code);
  if v_role = '__locked__' then return public._deny(v_role); end if;
  if v_mode = 'family_code' and v_role is null then return public._fail('رمز العائلة مطلوب'); end if;
  if p_proposed_data is null or length(p_proposed_data::text) > 4000 then
    return public._fail('نص الطلب طويل جدًا');
  end if;
  v_from := trim(coalesce(p_proposed_data ->> 'from', ''));
  if length(v_from) < 2 then return public._fail('اسم المقدِّم مطلوب — لا تُقبل الطلبات مجهولة الاسم'); end if;
  v_type := coalesce(nullif(p_request_type, ''), 'suggestion');
  if v_type not in ('suggestion', 'inquiry', 'correction') then v_type := 'suggestion'; end if;
  if v_type = 'correction' then
    if p_target_member_id is null then return public._fail('طلب التعديل يتطلب تحديد العضو'); end if;
    v_field := coalesce(p_proposed_data ->> 'field', '');
    if v_field not in ('full_name','nickname','gender','is_alive','birth_year_text','death_year_text','city','biography_story') then
      return public._fail('حقل التعديل غير مدعوم');
    end if;
    if not (p_proposed_data ? 'new_value') then return public._fail('القيمة الجديدة مطلوبة'); end if;
    if v_field = 'full_name' and length(trim(coalesce(p_proposed_data ->> 'new_value', ''))) = 0 then
      return public._fail('الاسم الجديد لا يمكن أن يكون فارغًا');
    end if;
  else
    if length(trim(coalesce(p_proposed_data ->> 'note', ''))) = 0 then return public._fail('اكتب نص الرسالة'); end if;
  end if;
  insert into public.change_requests (target_member_id, request_type, proposed_data)
  values (p_target_member_id, v_type, p_proposed_data);
  return jsonb_build_object('success', true);
end $$;

create or replace function public.list_suggestions(p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if v_role in ('owner', 'editor') then
    return jsonb_build_object('success', true, 'items', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.change_requests c), '[]'::jsonb));
  elsif v_role = 'branch' then
    return jsonb_build_object('success', true, 'items', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.change_requests c
      where c.target_member_id is not null and public._in_branch(v_branch, c.target_member_id)), '[]'::jsonb));
  end if;
  return public._deny(v_role);
end $$;

create or replace function public.secure_delete_suggestion(suggestion_id uuid, passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_target uuid;
begin
  select * into v_role, v_branch from public._who(passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  select target_member_id into v_target from public.change_requests where id = suggestion_id;
  if v_role = 'branch' and (v_target is null or not public._in_branch(v_branch, v_target)) then
    return public._fail('هذا الطلب خارج صلاحية فرعك');
  end if;
  delete from public.change_requests where id = suggestion_id;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.secure_apply_suggestion(p_suggestion_id uuid, p_passcode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text; v_branch uuid; v_req public.change_requests%rowtype;
  v_field text; v_text text; v_gender public.members.gender%type;
begin
  select * into v_role, v_branch from public._who(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor', 'branch') then return public._deny(v_role); end if;
  select * into v_req from public.change_requests where id = p_suggestion_id;
  if v_req.id is null then return public._fail('الطلب غير موجود'); end if;
  if v_req.request_type is distinct from 'correction' or (v_req.proposed_data ->> 'field') is null then
    return public._fail('هذا الطلب ليس طلب تعديل منظّمًا قابلًا للتطبيق المباشر');
  end if;
  if v_req.target_member_id is null or not exists (select 1 from public.members where id = v_req.target_member_id) then
    return public._fail('العضو المستهدف غير موجود');
  end if;
  if v_role = 'branch' and not public._in_branch(v_branch, v_req.target_member_id) then
    return public._fail('هذا الفرد خارج صلاحية فرعك');
  end if;
  v_field := v_req.proposed_data ->> 'field';
  v_text := v_req.proposed_data ->> 'new_value';
  perform set_config('app.actor', public._actor(v_role, v_branch), true);
  if v_field = 'full_name' then
    if length(trim(coalesce(v_text, ''))) = 0 then return public._fail('الاسم الجديد فارغ'); end if;
    update public.members set full_name = trim(v_text) where id = v_req.target_member_id;
  elsif v_field = 'nickname' then
    update public.members set nickname = nullif(trim(coalesce(v_text, '')), '') where id = v_req.target_member_id;
  elsif v_field = 'gender' then
    begin
      v_gender := (jsonb_populate_record(null::public.members, jsonb_build_object('gender', v_text))).gender;
    exception when others then return public._fail('قيمة الجنس غير صالحة'); end;
    update public.members set gender = v_gender where id = v_req.target_member_id;
  elsif v_field = 'is_alive' then
    update public.members set is_alive = (v_text = 'true'),
      death_year_text = case when v_text = 'true' then null else death_year_text end
      where id = v_req.target_member_id;
  elsif v_field = 'birth_year_text' then
    update public.members set birth_year_text = nullif(trim(coalesce(v_text, '')), '') where id = v_req.target_member_id;
  elsif v_field = 'death_year_text' then
    update public.members set death_year_text = nullif(trim(coalesce(v_text, '')), '') where id = v_req.target_member_id;
  elsif v_field = 'city' then
    update public.members set city = nullif(trim(coalesce(v_text, '')), '') where id = v_req.target_member_id;
  elsif v_field = 'biography_story' then
    update public.members set biography_story = nullif(trim(coalesce(v_text, '')), '') where id = v_req.target_member_id;
  else
    return public._fail('حقل غير مدعوم للتطبيق المباشر');
  end if;
  delete from public.change_requests where id = p_suggestion_id;
  return jsonb_build_object('success', true, 'member_id', v_req.target_member_id);
end $$;
grant execute on function public.secure_apply_suggestion(uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 10) الأقسام المُبرزة في الشريط العلوي (ann25)
--     المالك والمحرر يختاران من قائمة الأقسام نفسها ما يظهر كأزرار بارزة
--     أعلى الصفحة لكل الزوار (طلب المالك 2026-10-23). القائمة كما هي.
-- ---------------------------------------------------------------------
alter table public.system_settings add column if not exists featured_sections text[] not null default array['events','honor'];

create or replace function public.get_bundle(p_code text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_mode text; v_role text; v_priv boolean; v_seen boolean; v_branch uuid; v_scope uuid[]; v_wvis boolean; v_feat text[];
begin
  select access_mode into v_mode from public.system_settings where id = 1;
  v_role := public._authenticate(p_code);

  if v_role = '__locked__' then
    return jsonb_build_object('ok', false, 'error', 'locked', 'mode', v_mode);
  end if;
  if v_mode = 'family_code' and v_role is null then
    return jsonb_build_object('ok', false, 'error', 'code_required', 'mode', v_mode);
  end if;

  v_priv := coalesce(v_role in ('owner', 'editor'), false);
  select coalesce(women_names_visible, true) into v_wvis from public.system_settings where id = 1;
  select coalesce(featured_sections, array['events','honor']) into v_feat from public.system_settings where id = 1;
  v_seen := v_role is not null;

  if v_role in ('branch', 'reader') then
    v_branch := public._branch_of(p_code);
    if v_role = 'branch' then
      select coalesce(array_agg(b.id), '{}') into v_scope from public._branch_members(v_branch) b;
    end if;
  end if;

  if v_role in ('family', 'branch', 'reader') and p_code is not null then
    insert into public.access_log(role, branch_root_id, ip)
    select v_role, v_branch, public._client_ip()
    where not exists (select 1 from public.access_log a where a.ip = public._client_ip() and a.role = v_role
      and a.branch_root_id is not distinct from v_branch and a.created_at > now() - interval '30 minutes');
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'role', coalesce(v_role, 'visitor'),
    'women_names_visible', v_wvis,
    'featured_sections', coalesce(to_jsonb(v_feat), '[]'::jsonb),
    'access_stats', case when v_role = 'owner' then (select jsonb_build_object(
      'family', (select count(*) from public.access_log where role = 'family' and created_at > now() - interval '30 days'),
      'by_branch', coalesce((select jsonb_object_agg(branch_root_id::text, c) from (select branch_root_id, count(*) c from public.access_log where branch_root_id is not null and created_at > now() - interval '30 days' group by branch_root_id) t), '{}'::jsonb))) end,
    'branch', case when v_branch is not null then
        (select jsonb_build_object('root_id', e.branch_root_id, 'delegate_id', e.delegate_member_id, 'label', e.label)
           from public.branch_editors e where e.branch_root_id = v_branch) end,
    'branches', case when v_role = 'owner' then
        coalesce((select jsonb_agg(jsonb_build_object('root_id', e.branch_root_id, 'delegate_id', e.delegate_member_id, 'label', e.label, 'reader_set', exists(select 1 from public.branch_access_codes c where c.branch_root_id = e.branch_root_id)) order by e.created_at)
                    from public.branch_editors e), '[]'::jsonb) end,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id, 'full_name', case when (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis and not coalesce(m.name_public, false) and not (v_scope is not null and m.id = any(v_scope))))) then 'ابنة الأسرة' else m.full_name end,
          'name_masked', (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis and not coalesce(m.name_public, false) and not (v_scope is not null and m.id = any(v_scope))))), 'name_hidden', coalesce(m.name_hidden, false),
          'nickname', case when (not v_priv and (coalesce(m.name_hidden, false) or (m.gender = 'female' and not v_wvis and not coalesce(m.name_public, false) and not (v_scope is not null and m.id = any(v_scope))))) then null else m.nickname end,
          'name_public', coalesce(m.name_public, false), 'gender', m.gender,
          'father_id', m.father_id, 'wife_mother_id', m.wife_mother_id,
          'birth_date', m.birth_date, 'death_date', m.death_date, 'is_alive', m.is_alive,
          'birth_year_text', m.birth_year_text, 'death_year_text', m.death_year_text,
          'birth_order', m.birth_order, 'city', m.city, 'photo_url', m.photo_url, 'audio_url', m.audio_url,
          'achievement_badge', m.achievement_badge, 'bio', m.bio, 'biography_story', m.biography_story,
          'created_at', m.created_at)
        || case when v_priv or m.id = any(v_scope) then jsonb_build_object('phone', m.phone) else '{}'::jsonb end
        order by m.created_at)
        from public.members m), '[]'::jsonb),
    'wives', case when v_seen then coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'husband_id', w.husband_id, 'full_name', case when (not v_priv and (coalesce(w.name_hidden, false) or coalesce((select lm.name_hidden from public.members lm where lm.id = w.member_id), false) or (not v_wvis and not (coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false)) and not (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope)))))) then 'زوجة' else public._woman_name(coalesce((select lm.full_name from public.members lm where lm.id = w.member_id), w.full_name),
            coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false),
            (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope))),
            'زوجة ' || coalesce((select h.full_name from public.members h where h.id = w.husband_id), 'أحد أفراد الأسرة'), (not v_wvis and not v_priv)) end,
                                          'name_masked', (not v_priv and (coalesce(w.name_hidden, false) or coalesce((select lm.name_hidden from public.members lm where lm.id = w.member_id), false) or (not v_wvis and not (coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false)) and not (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope)))))),
                                          'family_name', case when (not v_priv and (coalesce(w.name_hidden, false) or coalesce((select lm.name_hidden from public.members lm where lm.id = w.member_id), false) or (not v_wvis and not (coalesce(w.name_public, false) or coalesce((select lm.name_public from public.members lm where lm.id = w.member_id), false)) and not (v_scope is not null and (w.husband_id = any(v_scope) or w.member_id = any(v_scope)))))) then null else w.family_name end,
                                          'member_id', w.member_id, 'name_public', coalesce(w.name_public, false), 'created_at', w.created_at) order by w.created_at)
        from public.wives w), '[]'::jsonb) else '[]'::jsonb end,
    'events', case when v_seen then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'event_date', e.event_date,
                                          'location_name', e.location_name, 'location_url', e.location_url,
                                          'description', e.description, 'story', e.story,
                                          'doc_code', case when v_priv then e.doc_code else null end,
                                          'media_count', (select count(*) from public.event_media em where em.event_id = e.id)) order by e.event_date)
        from public.family_events e), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

create or replace function public.secure_set_featured_sections(p_passcode text, p_sections text[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_clean text[];
begin
  v_role := public._authenticate(p_passcode);
  if coalesce(v_role, '') not in ('owner', 'editor') then return public._deny(v_role); end if;
  select coalesce(array_agg(x), '{}') into v_clean
    from unnest(coalesce(p_sections, '{}')) x
   where x in ('cities','names','events','honor','cards','kin','suggest','csv');
  update public.system_settings set featured_sections = v_clean where id = 1;
  return jsonb_build_object('success', true, 'featured_sections', v_clean);
end $$;
grant execute on function public.secure_set_featured_sections(text, text[]) to anon, authenticated;

-- ===== القسم 11: أنواع إعلانات جديدة — زواج + إعلان عام بنص حر (طلب المالك 2026-10-23) =====
-- نفّذ هذا القسم مرة واحدة في SQL Editor

alter table public.announcements add column if not exists body text;
alter table public.announcements drop constraint if exists announcements_kind_check;
alter table public.announcements add constraint announcements_kind_check
  check (kind in ('birth','condolence','wedding','general'));

drop function if exists public.secure_post_announcement(text, text, uuid, text, text);
create or replace function public.secure_post_announcement(p_passcode text, p_kind text, p_member_id uuid, p_member_name text, p_gender text, p_body text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null or v_role not in ('owner', 'editor', 'branch') then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if p_kind not in ('birth', 'condolence', 'wedding', 'general') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_kind = 'general' then
    if v_role = 'branch' then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
    if coalesce(trim(p_member_name), '') = '' or coalesce(trim(p_body), '') = '' then
      return jsonb_build_object('ok', false, 'error', 'empty');
    end if;
    insert into public.announcements(kind, member_id, member_name, gender, body)
    values ('general', null, left(trim(p_member_name), 200), 'male', left(trim(p_body), 4000))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  if v_role = 'branch' then
    v_branch := public._branch_of(p_passcode);
    if p_member_id is null or not public._in_branch(v_branch, p_member_id) then
      return jsonb_build_object('ok', false, 'error', 'out_of_scope');
    end if;
  end if;
  insert into public.announcements(kind, member_id, member_name, gender)
  values (p_kind, p_member_id, left(coalesce(p_member_name, ''), 120), case when p_gender = 'female' then 'female' else 'male' end)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.get_announcements(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_priv boolean; v_wvis boolean; v_scope uuid[];
begin
  select * into v_role, v_branch from public._who(p_code);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'code_required'); end if;
  v_priv := v_role in ('owner', 'editor');
  select coalesce(women_names_visible, true) into v_wvis from public.system_settings where id = 1;
  if v_role = 'branch' and v_branch is not null then
    select coalesce(array_agg(b.id), '{}') into v_scope from public._branch_members(v_branch) b;
  end if;
  delete from public.announcements a where a.kind <> 'general'
     and (a.member_id is null or not exists (select 1 from public.members m where m.id = a.member_id));
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'member_id', a.member_id,
      'member_name', a.member_name, 'body', a.body,
      'gender', a.gender, 'created_at', a.created_at, 'expires_at', a.expires_at) order by a.created_at desc)
    from public.announcements a
    left join public.members mm on mm.id = a.member_id
    where a.expires_at > now()
      and (a.kind = 'general' or mm.id is not null)
      and not (a.kind <> 'general' and not v_priv and (coalesce(mm.name_hidden, false) or (mm.gender = 'female' and not v_wvis and not coalesce(mm.name_public, false)
               and not (v_scope is not null and mm.id = any(v_scope)))))), '[]'::jsonb));
end $$;

grant execute on function public.secure_post_announcement(text, text, uuid, text, text, text) to anon, authenticated;

-- ===== القسم 12: بطاقات مناسبات موسّعة + رقم الجوال في التهنئة (طلب المالك 2026-10-24) =====
-- نفّذ هذا القسم مرة واحدة في SQL Editor
-- أنواع جديدة: خطبة، عقد قران (ملكة)، تخرج، وظيفة، ترقية، نجاح، سلامة، منزل جديد
-- ويرجع رقم جوال العضو مع إعلانات البطاقات ليظهر في نافذة التهنئة (للمسجلين برمز فقط)

alter table public.announcements drop constraint if exists announcements_kind_check;
alter table public.announcements add constraint announcements_kind_check
  check (kind in ('birth','condolence','wedding','engagement','aqd','graduation','job','promotion','success','recovery','newhome','general'));

drop function if exists public.secure_post_announcement(text, text, uuid, text, text, text);
create or replace function public.secure_post_announcement(p_passcode text, p_kind text, p_member_id uuid, p_member_name text, p_gender text, p_body text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null or v_role not in ('owner', 'editor', 'branch') then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if p_kind not in ('birth','condolence','wedding','engagement','aqd','graduation','job','promotion','success','recovery','newhome','general') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_kind = 'general' then
    if v_role = 'branch' then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
    if coalesce(trim(p_member_name), '') = '' or coalesce(trim(p_body), '') = '' then
      return jsonb_build_object('ok', false, 'error', 'empty');
    end if;
    insert into public.announcements(kind, member_id, member_name, gender, body)
    values ('general', null, left(trim(p_member_name), 200), 'male', left(trim(p_body), 4000))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  if v_role = 'branch' then
    v_branch := public._branch_of(p_passcode);
    if p_member_id is null or not public._in_branch(v_branch, p_member_id) then
      return jsonb_build_object('ok', false, 'error', 'out_of_scope');
    end if;
  end if;
  insert into public.announcements(kind, member_id, member_name, gender)
  values (p_kind, p_member_id, left(coalesce(p_member_name, ''), 120), case when p_gender = 'female' then 'female' else 'male' end)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.get_announcements(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_priv boolean; v_wvis boolean; v_scope uuid[];
begin
  select * into v_role, v_branch from public._who(p_code);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'code_required'); end if;
  v_priv := v_role in ('owner', 'editor');
  select coalesce(women_names_visible, true) into v_wvis from public.system_settings where id = 1;
  if v_role = 'branch' and v_branch is not null then
    select coalesce(array_agg(b.id), '{}') into v_scope from public._branch_members(v_branch) b;
  end if;
  delete from public.announcements a where a.kind <> 'general'
     and (a.member_id is null or not exists (select 1 from public.members m where m.id = a.member_id));
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'member_id', a.member_id,
      'member_name', a.member_name, 'body', a.body, 'phone', mm.phone,
      'gender', a.gender, 'created_at', a.created_at, 'expires_at', a.expires_at) order by a.created_at desc)
    from public.announcements a
    left join public.members mm on mm.id = a.member_id
    where a.expires_at > now()
      and (a.kind = 'general' or mm.id is not null)
      and not (a.kind <> 'general' and not v_priv and (coalesce(mm.name_hidden, false) or (mm.gender = 'female' and not v_wvis and not coalesce(mm.name_public, false)
               and not (v_scope is not null and mm.id = any(v_scope)))))), '[]'::jsonb));
end $$;

grant execute on function public.secure_post_announcement(text, text, uuid, text, text, text) to anon, authenticated;

-- ===== القسم 13: بطاقة شكر (طلب المالك 2026-10-24) =====
-- نفّذ هذا القسم مرة واحدة في SQL Editor
-- يضيف نوع شكر (بطاقة شكر من صاحب المناسبة — نص ثابت أو حر عبر p_body) لقيد الأنواع ودالة النشر

alter table public.announcements drop constraint if exists announcements_kind_check;
alter table public.announcements add constraint announcements_kind_check
  check (kind in ('birth','condolence','wedding','engagement','aqd','graduation','job','promotion','success','recovery','newhome','general','thanks'));

drop function if exists public.secure_post_announcement(text, text, uuid, text, text, text);
create or replace function public.secure_post_announcement(p_passcode text, p_kind text, p_member_id uuid, p_member_name text, p_gender text, p_body text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_role text; v_branch uuid; v_id uuid;
begin
  v_role := public._authenticate(p_passcode);
  if v_role = '__locked__' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_role is null or v_role not in ('owner', 'editor', 'branch') then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if p_kind not in ('birth','condolence','wedding','engagement','aqd','graduation','job','promotion','success','recovery','newhome','general','thanks') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_kind = 'general' then
    if v_role = 'branch' then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
    if coalesce(trim(p_member_name), '') = '' or coalesce(trim(p_body), '') = '' then
      return jsonb_build_object('ok', false, 'error', 'empty');
    end if;
    insert into public.announcements(kind, member_id, member_name, gender, body)
    values ('general', null, left(trim(p_member_name), 200), 'male', left(trim(p_body), 4000))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  if v_role = 'branch' then
    v_branch := public._branch_of(p_passcode);
    if p_member_id is null or not public._in_branch(v_branch, p_member_id) then
      return jsonb_build_object('ok', false, 'error', 'out_of_scope');
    end if;
  end if;
  insert into public.announcements(kind, member_id, member_name, gender, body)
  values (p_kind, p_member_id, left(coalesce(p_member_name, ''), 120), case when p_gender = 'female' then 'female' else 'male' end, nullif(left(trim(coalesce(p_body, '')), 2000), ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.secure_post_announcement(text, text, uuid, text, text, text) to anon, authenticated;
