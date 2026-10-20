-- =====================================================================
-- اختبارات الصلاحيات والأمان: تُشغَّل على مشروع Supabase تجريبي فقط
-- (بعد 00_test_schema.sql ثم 01_setup.sql). لا تشغّلها على مشروعك الحقيقي.
--
-- طريقة العمل: كل الاختبارات داخل كتلة واحدة تنتهي بخطأ مقصود لتُلغى بياناتها كلها.
-- فإذا رأيت رسالة خطأ تبدأ بـ «كل الاختبارات نجحت ✅» فهذا هو النجاح.
-- وإن بدأت بـ «بعض الاختبارات فشلت» فستجد أسطر ❌ تحدد المشكلة، فأرسلها لي.
-- =====================================================================
create or replace function pg_temp.t(c boolean, m text) returns text
language sql as $$ select case when c is true then '✅ ' else '❌ ' end || m || E'\n' $$;

do $$
declare
  c_own constant text := 'OWNER-TEST-1';
  c_edi constant text := 'EDITOR-TEST-1';
  c_fam constant text := 'FAMILY-TEST-1';
  c_bra constant text := 'BRANCH-TEST-A1';
  c_brb constant text := 'BRANCH-TEST-B1';
  v_root uuid := 'a0000000-0000-0000-0000-000000000001';
  v_a    uuid := 'a0000000-0000-0000-0000-000000000002';
  v_b    uuid := 'a0000000-0000-0000-0000-000000000003';
  v_a1   uuid := 'a0000000-0000-0000-0000-000000000004';
  v_b1   uuid := 'a0000000-0000-0000-0000-000000000005';
  rep text := ''; res jsonb; res2 jsonb; v_new uuid; v_w uuid; v_snap bigint; v_ok boolean;
  v_cnt1 integer; v_cnt2 integer; i integer;
begin
  if exists (select 1 from public.members) then
    raise exception 'هذا المشروع فيه بيانات. شغّل الاختبارات على مشروع تجريبي فارغ فقط.';
  end if;

  update public.system_settings set
    editor_passcode_hash = extensions.crypt(c_edi, extensions.gen_salt('bf')),
    family_code_hash = extensions.crypt(c_fam, extensions.gen_salt('bf')),
    access_mode = 'family_code' where id = 1;

  insert into public.members (id, full_name, gender, father_id, phone, is_alive, birth_order, city) values
    (v_root, 'الجد',   'male', null,   '0550000001', true, 1, 'أبها'),
    (v_a,    'فرع أ',  'male', v_root, '0550000002', true, 1, 'أبها'),
    (v_b,    'فرع ب',  'male', v_root, '0550000003', true, 2, 'أبها'),
    (v_a1,   'حفيد أ', 'male', v_a,    '0550000004', true, 1, 'أبها'),
    (v_b1,   'حفيد ب', 'male', v_b,    '0550000005', true, 1, 'أبها');
  insert into public.wives (husband_id, full_name) values (v_a, 'زوجة أ'), (v_b, 'زوجة ب');

  -- ===== 1) القراءة حسب الدور =====
  res := get_bundle(null);
  rep := rep || pg_temp.t(res->>'ok' = 'false' and res->>'error' = 'code_required', 'وضع رمز العائلة: بلا رمز لا يرى شيئًا');
  res := get_bundle(c_fam);
  rep := rep || pg_temp.t(res->>'role' = 'family', 'رمز العائلة يعطي دور family');
  rep := rep || pg_temp.t(jsonb_array_length(res->'members') = 5, 'فرد العائلة يرى الأفراد');
  rep := rep || pg_temp.t(not exists (select 1 from jsonb_array_elements(res->'members') e where jsonb_exists(e, 'phone')), 'فرد العائلة لا يرى أي هاتف');
  rep := rep || pg_temp.t(not exists (select 1 from jsonb_array_elements(res->'members') e where jsonb_exists(e, 'updated_at') or jsonb_exists(e, 'mother_id')), 'الاستجابة بأعمدة محددة فقط (لا تسريب لأعمدة مستقبلية)');
  rep := rep || pg_temp.t(jsonb_array_length(res->'wives') = 2, 'فرد العائلة يرى الزوجات');

  update public.system_settings set access_mode = 'open_link' where id = 1;
  res := get_bundle(null);
  rep := rep || pg_temp.t(res->>'ok' = 'true' and res->>'role' = 'visitor', 'وضع الرابط المفتوح: الزائر يدخل');
  rep := rep || pg_temp.t(jsonb_array_length(res->'members') = 5 and not exists (select 1 from jsonb_array_elements(res->'members') e where jsonb_exists(e, 'phone')), 'الزائر يرى الأفراد بلا هواتف');
  rep := rep || pg_temp.t(jsonb_array_length(res->'wives') = 0 and jsonb_array_length(res->'events') = 0, 'الزائر لا يرى الزوجات ولا المناسبات');
  update public.system_settings set access_mode = 'family_code' where id = 1;

  res := get_bundle(c_own);
  rep := rep || pg_temp.t((select count(*) from jsonb_array_elements(res->'members') e where jsonb_exists(e, 'phone')) = 5, 'المالك يرى كل الهواتف');
  res := get_bundle(c_edi);
  rep := rep || pg_temp.t((select count(*) from jsonb_array_elements(res->'members') e where jsonb_exists(e, 'phone')) = 5, 'المحرر يرى كل الهواتف');
  rep := rep || pg_temp.t(jsonb_typeof(res->'branches') = 'null', 'المحرر لا يرى قائمة مسؤولي الفروع');

  -- ===== 2) تعيين مسؤولي الفروع (المالك فقط، والمسؤول من أفراد الفرع) =====
  res := secure_set_branch_editor(v_a, v_a1, c_bra, c_own);
  rep := rep || pg_temp.t(res->>'success' = 'true', 'المالك يعيّن مسؤول الفرع أ');
  res := secure_set_branch_editor(v_b, v_b1, c_brb, c_own);
  rep := rep || pg_temp.t(res->>'success' = 'true', 'المالك يعيّن مسؤول الفرع ب');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_b1, 'BRANCH-TEST-X1', c_own))->>'success' = 'false', 'رفض مسؤول من خارج الفرع');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_a1, 'short', c_own))->>'success' = 'false', 'رفض رمز قصير');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_a1, c_fam, c_own))->>'success' = 'false', 'رفض رمز يطابق رمز العائلة');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_a1, c_edi, c_own))->>'success' = 'false', 'رفض رمز يطابق رمز المحرر');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_a1, c_brb, c_own))->>'success' = 'false', 'رفض رمز فرع آخر');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_a1, 'BRANCH-TEST-Z1', c_edi))->>'success' = 'false', 'المحرر لا يعيّن مسؤولين');
  rep := rep || pg_temp.t((secure_set_branch_editor(v_a, v_a1, 'BRANCH-TEST-Z1', c_bra))->>'success' = 'false', 'مسؤول الفرع لا يعيّن مسؤولين');

  res := get_bundle(c_bra);
  rep := rep || pg_temp.t(res->>'role' = 'branch' and (res->'branch'->>'root_id')::uuid = v_a, 'مسؤول الفرع أ: دور branch ورأس فرعه صحيح');
  rep := rep || pg_temp.t((select count(*) from jsonb_array_elements(res->'members') e where jsonb_exists(e, 'phone')) = 2, 'مسؤول الفرع يرى هواتف فرعه فقط (فرع أ + حفيد أ)');
  rep := rep || pg_temp.t(jsonb_array_length(get_bundle(c_own)->'branches') = 2, 'المالك يرى مسؤولَي الفروع');

  -- ===== 3) حدود مسؤول الفرع =====
  res := secure_save_member(null, 'ابن جديد', null, 'male', v_a1, null, 1, null, true, null, null, null, c_bra);
  rep := rep || pg_temp.t(res->>'success' = 'true', 'يضيف ابنًا داخل فرعه');
  v_new := (res->>'id')::uuid;
  rep := rep || pg_temp.t((secure_save_member(null, 'دخيل', null, 'male', v_b1, null, 1, null, true, null, null, null, c_bra))->>'success' = 'false', 'لا يضيف تحت فرع آخر');
  rep := rep || pg_temp.t((secure_save_member(null, 'دخيل', null, 'male', v_root, null, 1, null, true, null, null, null, c_bra))->>'success' = 'false', 'لا يضيف تحت الجد الأعلى');
  rep := rep || pg_temp.t((secure_save_member(v_b1, 'تعديل خارجي', null, 'male', v_b, null, 1, null, true, null, null, null, c_bra))->>'success' = 'false', 'لا يعدّل فردًا من فرع آخر');
  rep := rep || pg_temp.t((select full_name from public.members where id = v_b1) = 'حفيد ب', 'اسم فرد الفرع الآخر لم يتغيّر');
  rep := rep || pg_temp.t((secure_save_member(v_a1, 'حفيد أ معدّل', null, 'male', v_a, null, 1, '0551', true, null, null, null, c_bra))->>'success' = 'true', 'يعدّل فردًا من فرعه');
  rep := rep || pg_temp.t((select full_name from public.members where id = v_a1) = 'حفيد أ معدّل', 'التعديل حُفظ');
  rep := rep || pg_temp.t((secure_save_member(v_a1, 'نقل', null, 'male', v_root, null, 1, null, true, null, null, null, c_bra))->>'success' = 'false', 'لا ينقل فردًا إلى أب آخر (الجد)');
  rep := rep || pg_temp.t((secure_save_member(v_a1, 'نقل', null, 'male', v_b, null, 1, null, true, null, null, null, c_bra))->>'success' = 'false', 'لا ينقل فردًا إلى فرع آخر');
  rep := rep || pg_temp.t((secure_save_member(v_a, 'فرع أ', null, 'male', v_root, null, 1, null, true, null, null, null, c_bra))->>'success' = 'true', 'يعدّل رأس فرعه (بلا تغيير أبيه)');
  rep := rep || pg_temp.t((secure_save_member(v_a, 'فرع أ', null, 'male', null, null, 1, null, true, null, null, null, c_bra))->>'success' = 'false', 'لا يفصل رأس فرعه عن أبيه');
  rep := rep || pg_temp.t((secure_update_member_extras(v_b1, 'مكة', null, null, c_bra))->>'success' = 'false', 'لا يعدّل المدينة/الشارة خارج فرعه');
  rep := rep || pg_temp.t((secure_update_member_extras(v_a1, 'مكة', 'دكتور', null, c_bra))->>'success' = 'true', 'يعدّل المدينة/الشارة داخل فرعه');

  res := secure_save_wife(v_a1, 'زوجة جديدة', null, c_bra);
  rep := rep || pg_temp.t(res->>'success' = 'true', 'يضيف زوجة داخل فرعه');
  v_w := (res->>'id')::uuid;
  rep := rep || pg_temp.t((secure_save_wife(v_b1, 'زوجة دخيلة', null, c_bra))->>'success' = 'false', 'لا يضيف زوجة خارج فرعه');
  rep := rep || pg_temp.t((secure_delete_wife((select id from public.wives where husband_id = v_b limit 1), c_bra))->>'success' = 'false', 'لا يحذف زوجة من فرع آخر');
  rep := rep || pg_temp.t((secure_delete_wife(v_w, c_bra))->>'success' = 'true', 'يحذف زوجة من فرعه');

  rep := rep || pg_temp.t((secure_delete_member(v_new, c_bra))->>'success' = 'false', 'مسؤول الفرع لا يحذف أفرادًا');
  rep := rep || pg_temp.t((secure_delete_member(v_new, c_edi))->>'success' = 'false', 'المحرر لا يحذف أفرادًا');
  rep := rep || pg_temp.t((secure_delete_member(v_new, c_fam))->>'success' = 'false', 'فرد العائلة لا يحذف');
  rep := rep || pg_temp.t((secure_save_event(null, 'حفل', '2030-01-01 10:00+00', null, null, null, c_bra))->>'success' = 'false', 'مسؤول الفرع لا يدير المناسبات');
  rep := rep || pg_temp.t((secure_save_event(null, 'حفل', '2030-01-01 10:00+00', null, null, null, c_edi))->>'success' = 'true', 'المحرر يضيف مناسبة');
  rep := rep || pg_temp.t((secure_save_event(null, 'حفل', '2030-01-01 10:00+00', null, null, null, c_fam))->>'success' = 'false', 'فرد العائلة لا يضيف مناسبة');
  rep := rep || pg_temp.t((secure_save_member(null, 'حفيد ب2', null, 'male', v_b1, null, 1, null, true, null, null, null, c_edi))->>'success' = 'true', 'المحرر يضيف في أي فرع');
  rep := rep || pg_temp.t((secure_save_member(null, 'محاولة', null, 'male', v_b1, null, 1, null, true, null, null, null, c_fam))->>'success' = 'false', 'فرد العائلة لا يكتب');
  rep := rep || pg_temp.t((secure_save_member(null, 'x', null, 'unknown-gender', v_b1, null, 1, null, true, null, null, null, c_edi))->>'success' = 'false', 'قيمة جنس غير صالحة مرفوضة');
  rep := rep || pg_temp.t((secure_delete_member(v_new, c_own))->>'success' = 'true', 'المالك يحذف فردًا');

  -- ===== 4) الاقتراحات =====
  rep := rep || pg_temp.t((submit_suggestion(c_fam, v_a1, 'correction', '{"note":"x"}'::jsonb))->>'success' = 'true', 'فرد العائلة يرسل اقتراحًا');
  rep := rep || pg_temp.t((submit_suggestion(null, v_a1, 'correction', '{"note":"x"}'::jsonb))->>'success' = 'false', 'بلا رمز لا اقتراح في وضع رمز العائلة');
  rep := rep || pg_temp.t((list_suggestions(c_bra))->>'success' = 'false', 'مسؤول الفرع لا يقرأ صندوق الاقتراحات');
  rep := rep || pg_temp.t(jsonb_array_length((list_suggestions(c_own))->'items') = 1, 'المالك يقرأ الاقتراحات');

  -- ===== 5) سجل التغييرات =====
  res := list_changes(c_own, 200);
  rep := rep || pg_temp.t(exists (select 1 from jsonb_array_elements(res->'items') e where e->>'actor' like 'مسؤول فرع:%' and e->>'table' = 'members'), 'السجل يذكر مسؤول الفرع كفاعل');
  rep := rep || pg_temp.t(exists (select 1 from jsonb_array_elements(res->'items') e where e->>'action' = 'update' and jsonb_exists(e->'changes', 'full_name')), 'السجل يحفظ ما تغيّر (الاسم)');
  rep := rep || pg_temp.t(not exists (select 1 from jsonb_array_elements(res->'items') e where e->'changes'->>'phone' like '0551%'), 'السجل لا يخزّن أرقام الهواتف');
  rep := rep || pg_temp.t((list_changes(c_bra, 10))->>'success' = 'false', 'مسؤول الفرع لا يقرأ السجل');

  -- ===== 6) اللقطات والاستعادة =====
  res := secure_snapshot(c_own);
  rep := rep || pg_temp.t(res->>'success' = 'true', 'المالك يأخذ لقطة');
  v_snap := (res->>'id')::bigint;
  delete from public.members where father_id = v_b1;
  delete from public.wives where husband_id = v_b1;
  delete from public.members where id = v_b1;
  update public.members set full_name = 'خراب' where id = v_a;
  perform admin_restore_snapshot(v_snap, 'RESTORE');
  rep := rep || pg_temp.t(exists (select 1 from public.members where id = v_b1), 'الاستعادة من لقطة أعادت الفرد المحذوف');
  rep := rep || pg_temp.t((select full_name from public.members where id = v_a) = 'فرع أ', 'الاستعادة أعادت الاسم الأصلي');
  rep := rep || pg_temp.t((select count(*) from public.branch_editors) = 2, 'الاستعادة أبقت مسؤولي الفروع');

  res := get_bundle(c_own);
  v_cnt1 := jsonb_array_length(res->'members');
  perform admin_restore(jsonb_build_object('members', res->'members', 'wives', res->'wives', 'events', res->'events'), 'RESTORE');
  select count(*) into v_cnt2 from public.members;
  rep := rep || pg_temp.t(v_cnt1 = v_cnt2 and v_cnt1 > 0, 'الاستعادة من ملف JSON بنفس شكل التصدير تعيد كل الأفراد');
  v_ok := false;
  begin perform admin_restore('{"members":[]}'::jsonb, 'no'); v_ok := true; exception when others then null; end;
  rep := rep || pg_temp.t(not v_ok, 'الاستعادة ترفض بلا كلمة التأكيد');

  -- ===== 7) الوصول المباشر مغلق على المتصفح =====
  v_ok := false;
  begin set local role anon; perform 1 from public.members limit 1; v_ok := true; exception when insufficient_privilege then null; end;
  reset role;
  rep := rep || pg_temp.t(not v_ok, 'الزائر (anon) لا يقرأ جدول الأفراد مباشرة');
  v_ok := false;
  begin set local role anon; insert into public.members (full_name) values ('اختراق'); v_ok := true; exception when insufficient_privilege then null; end;
  reset role;
  rep := rep || pg_temp.t(not v_ok, 'الزائر (anon) لا يكتب في جدول الأفراد');
  v_ok := false;
  begin set local role anon; perform public.verify_owner('x'); v_ok := true; exception when insufficient_privilege then null; end;
  reset role;
  rep := rep || pg_temp.t(not v_ok, 'دالة التحقق من المالك غير متاحة للمتصفح (لا تخمين بلا حد)');
  v_ok := false;
  begin set local role anon; perform public.get_bundle(null); v_ok := true; exception when others then null; end;
  reset role;
  rep := rep || pg_temp.t(v_ok, 'الزائر (anon) يستطيع استدعاء get_bundle');

  -- ===== 8) الحد من التخمين (آخر اختبار لأنه يحظر العنوان) =====
  for i in 1..8 loop
    perform secure_save_member(null, 'x', null, 'male', v_a1, null, 1, null, true, null, null, null, 'WRONG-CODE-' || i);
  end loop;
  res := secure_save_member(null, 'x', null, 'male', v_a1, null, 1, null, true, null, null, null, c_bra);
  rep := rep || pg_temp.t(res->>'success' = 'false' and res->>'message' like 'محاولات خاطئة كثيرة%', 'بعد 8 محاولات خاطئة يُحظر العنوان مؤقتًا حتى بالرمز الصحيح');
  res2 := get_bundle(c_own);
  rep := rep || pg_temp.t(res2->>'error' = 'locked', 'get_bundle يعيد locked أثناء الحظر');

  if position('❌' in rep) > 0 then
    raise exception E'بعض الاختبارات فشلت:\n%', rep;
  else
    raise exception E'كل الاختبارات نجحت ✅ (هذا الخطأ مقصود: يُلغي بيانات الاختبار)\n%', rep;
  end if;
end $$;
