const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let _toastT = null;
function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.hidden = false; requestAnimationFrame(() => t.classList.add('on')); clearTimeout(_toastT); _toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => { t.hidden = true; }, 300); }, 2600); }
const ROLES = { visitor: 'زائر', family: 'فرد عائلة', reader: 'قارئ فرع', editor: 'محرر', branch: 'مسؤول فرع', owner: 'مالك' };
const W = 170, H = 120, GX = 18, GY = 62;
const COL = ['#f59e0b', '#38bdf8', '#34d399', '#c084fc', '#f472b6', '#fb923c'];
const S = { members: [], wives: [], byId: new Map(), kids: new Map(), roots: [], open: new Set(), hit: null, saved: null, curId: null, order: [], code: '', onForm: null, branch: null, branches: [], role: 'visitor', view: innerWidth < 700 ? 'list' : 'graph', photos: new Map(), womenVisible: true, accessStats: null, ann: [] };
const V = { x: 0, y: 0, k: 1 };

/* ---------- بيانات وهمية للتصميم ---------- */
function demo() {
  const N = ['سالم', 'ناصر', 'فهد', 'خالد', 'عمر', 'سعد', 'ياسر', 'بدر', 'تركي', 'ماجد', 'راشد', 'حمد', 'زياد', 'مازن', 'وليد', 'نايف'];
  const out = []; let n = 0;
  const add = (father, d) => {
    const first = N[n % N.length], id = 'd' + n, i = n++;
    out.push({ id, full_name: father ? `${first} بن ${father.first}` : 'الجد الأكبر', first, father_id: father?.id || null, gender: d === 4 && i % 2 ? 'female' : 'male', birth_order: 1,
      is_alive: d >= 3 || (d === 2 && i % 3 !== 0), nickname: i % 5 === 0 ? 'أبو ' + N[(i + 3) % N.length] : null,
      achievement_badge: i % 11 === 0 && i ? 'دكتور' : null, city: ['النماص', 'أبها', 'الرياض'][i % 3], created_at: i });
    if (d < 4) { const c = d < 2 ? 3 : 1 + (i % 3); for (let j = 0; j < c; j++) add({ id, first }, d + 1); }
  };
  add(null, 0);
  return out;
}

/* ---------- التحميل والدخول ---------- */
async function load(code) {
  const b = CFG.DEMO ? { ok: true, role: 'visitor', members: demo(), wives: [] } : await rpc('get_bundle', { p_code: code || null });
  if (!b.ok) { S.locked = b.error === 'locked'; return false; }
  S.members = b.members; S.wives = b.wives; S.role = b.role; S.code = code || ''; S.branch = b.branch || null; S.branches = b.branches || [];
  S.womenVisible = b.women_names_visible !== false; S.accessStats = b.access_stats || null;
  S.featured = Array.isArray(b.featured_sections) ? b.featured_sections : ['events', 'honor'];
  const day = n => new Date(Date.now() + n * 864e5 + 2 * 36e5).toISOString();
  S.events = CFG.DEMO ? [
    { id: 'e1', title: 'حفل زواج (تجريبي)', event_date: day(33), location_name: 'قاعة المناسبات الكبرى', location_url: 'https://maps.google.com', description: 'عقد قران وزواج 💍 — المستضيف: أسرة تجريبية\nالدعوة عامة للعائلة.' },
    { id: 'e2', title: 'اجتماع العائلة السنوي (تجريبي)', event_date: day(60), location_name: 'استراحة العائلة', description: 'اجتماع عائلي 🤝 — المستضيف: كبير العائلة' },
    { id: 'e3', title: 'ملتقى الأبناء (تجريبي)', event_date: day(100), location_name: 'مركز الأحياء', description: 'ملتقى 🎓 — المستضيف: لجنة الشباب' }
  ] : (b.events || []);
  index(); collapseInitial(); render(true); showEvent();
  applyRole(); renderFeat();
  checkAnnouncements();
  inboxBadge();
  setTimeout(fetchPhotos, 400);
  if (!window._almAuto) window._almAuto = setInterval(silentRefresh, 90000);
  return true;
}
function showGate(msg) {
$('#gate-err').hidden = !msg; $('#gate-err').textContent = msg || '';
  $('#code').value = ''; $('#gate').showModal(); $('#code').focus();
}
$('#gate-form').addEventListener('submit', async e => {
  e.preventDefault();
  const code = $('#code').value.trim(); if (!code) return;
  try {
    if (await load(code)) {
      sessionStorage.setItem('code', code);
      $('#gate').close();
    }
    else showGate(S.locked ? 'محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم حاول من جديد.' : 'الرمز غير صحيح. تأكد منه وحاول مرة أخرى.');
  } catch { showGate('تعذر الاتصال بالخادم. حاول بعد قليل.'); }
});
$('#gate-x').onclick = () => $('#gate').close();
const canEdit = () => ['owner', 'editor'].includes(S.role);
const delegateName = b => S.byId.get(b?.delegate_id)?.full_name || b?.label || '';
const inBranch = m => { for (let p = m, i = 0; p && i < 60; p = S.byId.get(p.father_id), i++) if (p.id === S.branch?.root_id) return true; return false; };
const canMember = m => canEdit() || (S.role === 'branch' && inBranch(m));
function applyRole() {
  $('#btn-login').textContent = ['visitor', 'family', 'reader'].includes(S.role) ? 'دخول' : ROLES[S.role] + (S.role === 'branch' ? ' · ' + (S.byId.get(S.branch?.root_id)?.full_name || '') : '') + (CFG.DEMO ? ' (تجريبي)' : ''); /* ann50: زر واحد «دخول» للزائر وفرد العائلة، والدور يظهر بعد دخول الإدارة فقط */
  $('#adm-menu').hidden = !canEdit(); $('#m-settings').hidden = $('#m-branches').hidden = $('#m-log').hidden = $('#m-snap').hidden = S.role !== 'owner'; $('#m-inbox').hidden = !['owner', 'editor', 'branch'].includes(S.role); $('#m-family').hidden = !canEdit();
  $('#m-cards').hidden = !['owner', 'editor', 'branch'].includes(S.role); /* ann44: صفحة البطاقات مقفلة عن الزوار (قرار المالك 2026-10-24) */
  initFeatToggles();
}
$('#btn-login').onclick = () => {
  if (CFG.DEMO) {  // تجربة الأدوار: زائر ثم مالك ثم مسؤول فرع
    S.role = S.role === 'visitor' ? 'owner' : S.role === 'owner' ? 'branch' : 'visitor'; S.code = 'demo';
    S.branch = S.role === 'branch' ? { root_id: S.branches[0]?.root_id || (S.kids.get(S.roots[0]?.id) || [])[0]?.id } : null;
    applyRole(); return render();
  }
  if (canEdit() || S.role === 'branch') { if (confirm('تسجيل الخروج؟')) { sessionStorage.removeItem('code'); location.reload(); } } else showGate();
};

/* ---------- الفهارس ---------- */
function index() {
  S.byId = new Map(S.members.map(m => [m.id, m])); S.kids = new Map();
  for (const m of S.members) if (m.father_id && S.byId.has(m.father_id)) {
    if (!S.kids.has(m.father_id)) S.kids.set(m.father_id, []);
    S.kids.get(m.father_id).push(m);
  }
  for (const a of S.kids.values()) a.sort((x, y) => (x.birth_order || 99) - (y.birth_order || 99));
  S.roots = S.members.filter(m => !m.father_id || !S.byId.has(m.father_id));
}
const gen = m => { if (m._g) return m._g; let n = 1, p = S.byId.get(m.father_id); while (p && n < 30) { n++; p = S.byId.get(p.father_id); } return m._g = n; };
/* اسم البطاقة: الجيلان الأول والثاني بالاسم الكامل، ومن الثالث فأحدث الاسم الأول فقط (بلا سلسلة الأب) */
const shortName = m => {
  const f = S.byId.get(m.father_id); if (!f) return m.full_name;
  for (const sep of [' بن ', ' بنت ']) {
    if (m.full_name.endsWith(sep + f.full_name)) return m.full_name.slice(0, -(sep + f.full_name).length);
    const i = m.full_name.indexOf(sep);
    if (i > 0 && m.full_name.slice(i + sep.length).split(' ')[0] === f.full_name.split(' ')[0]) return m.full_name.slice(0, i);
  }
  return m.full_name;
};
const cardName = m => gen(m) <= 2 ? m.full_name : shortName(m);
/* اسم بطاقات التهاني والتعازي وإعلاناتها: ثلاثي أو رباعي — الاسم الأول + الأب + الجد + أبو الجد عبر سلسلة الآباء (طلب المالك 2026-10-22) */
const cardLongName = m => {
  if (!m) return '';
  let out = shortName(m), cur = m, p = S.byId.get(m.father_id), n = 1;
  while (p && n < 4) { out += (cur.gender === 'female' ? ' بنت ' : ' بن ') + shortName(p); cur = p; p = S.byId.get(p.father_id); n++; }
  return out;
};
function stats() {
  const n = f => S.members.filter(f).length, gens = S.members.reduce((x, m) => Math.max(x, gen(m)), 0);
  const c = [['👥', 'الإجمالي', S.members.length], ['👨', 'الذكور', n(m => m.gender === 'male')], ['👩', 'الإناث', n(m => m.gender === 'female')],
    ['🟢', 'الأحياء', n(m => m.is_alive)], ['⚪', 'المتوفون', n(m => m.is_alive === false)], ['📜', 'الأجيال', gens]];
  $('#chips').innerHTML = c.map(([i, l, v]) => `<span class="chip">${i} <span class="chl">${l}</span> <b>${v}</b></span>`).join(''); /* ann48: بالجوال رموز وأرقام فقط */
}
const evList = () => (S.events || []).map(e => ({ ...e, t: new Date(e.event_date).getTime() })).filter(e => e.t > Date.now()).sort((a, b) => a.t - b.t);
let evRot = null, evTick = null, evHold = false;
function showEvent() {
  const box = $('#event');
  clearInterval(evRot); clearInterval(evTick); evRot = evTick = null;
  const L = evList();
  box.hidden = !L.length; if (!L.length) { box.innerHTML = ''; return; }
  S.ev = Math.min(S.ev || 0, L.length - 1);
  const draw = () => {
    const cur = evList(); if (!cur.length) return showEvent();
    S.ev = Math.min(S.ev || 0, cur.length - 1);
    const e = cur[S.ev], ms = e.t - Date.now(), s = Math.max(0, Math.floor(ms / 1000));
    box.innerHTML = `<div class="evslide"><span class="ev-type">${esc((e.description || '').split(' — ')[0] || 'مناسبة')}</span><b class="ev-title">${esc(e.title)}</b>
    <span class="ev-cd">⏳ متبقي ${Math.floor(s / 86400)} يوم و ${pad(Math.floor(s % 86400 / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}</span><button class="ev-more">📍 تفاصيل الدعوة والموقع</button>
    ${cur.length > 1 ? `<span class="ev-pg"><button data-evn="-1" aria-label="السابقة">›</button>${S.ev + 1} / ${cur.length}<button data-evn="1" aria-label="التالية">‹</button></span>` : ''}</div>`; /* ann46: غلاف واحد للتلاشي الناعم */
  };
  draw();
  box.onpointerenter = () => evHold = true;
  box.onpointerleave = () => evHold = false;
  box.onpointerdown = () => evHold = true;
  evTick = setInterval(() => { const cur = evList(); if (!cur.length) return showEvent(); if ((S.ev || 0) >= cur.length) S.ev = 0; const e = cur[S.ev || 0]; if (!e || e.t - Date.now() <= 0) return draw(); const cd = box.querySelector('.ev-cd'); if (cd) { const s = Math.floor((e.t - Date.now()) / 1000); cd.textContent = `⏳ متبقي ${Math.floor(s / 86400)} يوم و ${pad(Math.floor(s % 86400 / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; } }, 1000);
  if (L.length > 1) evRot = setInterval(() => { if (!evHold) { const cur = evList(); if (cur.length > 1) { S.ev = ((S.ev || 0) + 1) % cur.length; draw(); } } }, 7000);
}
function evDetails(e) {
  e = e || S.evDetail || evList()[S.ev || 0]; if (!e) return;
  S.evDetail = e;
  const d = new Date(e.t || e.event_date), f = (loc, o) => d.toLocaleString(loc, o);
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  const url = /^https?:\/\//.test(e.location_url || '') ? e.location_url : '';
  $('#profile-body').innerHTML = `<h2>${esc(e.title)}</h2><p class="sub">${esc((e.description || '').split('\n')[0].split(' — ')[0])}</p>
    <dl>${row('الميلادي', esc(f('ar-SA-u-ca-gregory', { dateStyle: 'full', timeStyle: 'short' })))}${row('الهجري', esc(f('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'full' })))}
    ${row('المكان', esc(e.location_name || '') + (url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">الخريطة</a>` : ''))}</dl>
    ${e.description ? `<div class="story">${esc(e.description)}</div>` : ''}<div id="evdoc"></div>`;
  if (!$('#profile').open) $('#profile').showModal();
  loadEvDoc(e);
}
/* توثيق المناسبة: صور داخل الموقع + روابط فيديو + حكاية — للمالك/المحرر أو صاحب المناسبة برمز توثيقها */
const evDocCodes = new Map();
async function loadEvDoc(e, force) {
  const box = $('#evdoc'); if (!box) return;
  if (CFG.DEMO) { renderEvDoc(e, e._media || []); return; }
  if (!force && e._items) { renderEvDoc(e, e._items); return; }
  /* ann30: حالة تحميل فورية + زر استدعاء مباشر (طلب المالك) */
  box.innerHTML = `<h3 class="evdoch">📸 توثيق المناسبة</h3>
    ${e.story ? `<div class="story">${esc(e.story)}</div>` : '<p class="sub">لا حكاية موثقة بعد.</p>'}
    <div class="evdoc-tools"><button data-evload="1">📸 تحميل صور وفيديو المناسبة${e.media_count ? ` (${e.media_count})` : ''}</button></div>
    <p class="sub" id="evloadmsg">جارٍ التحميل…</p>`;
  const lb = box.querySelector('[data-evload]'); if (lb) lb.onclick = () => loadEvDoc(e, true);
  try {
    const r = await rpc('get_event_media', { p_code: S.code, p_event_id: e.id });
    if (!r.ok) throw new Error();
    e._items = r.items || [];
    if (S.evDetail === e && $('#evdoc')) renderEvDoc(e, e._items);
  } catch (_) {
    const m = $('#evloadmsg'); if (m && S.evDetail === e) m.textContent = 'تعذّر تحميل الصور — اضغط الزر أعلاه للمحاولة مرة أخرى';
  }
}
function renderEvDoc(e, items) {
  const box = $('#evdoc'); if (!box) return;
  const canDoc = () => canEdit() || evDocCodes.has(String(e.id));
  const pass = () => canEdit() ? S.code : evDocCodes.get(String(e.id));
  const photos = items.filter(x => x.kind === 'photo'), vids = items.filter(x => x.kind === 'video');
  box.innerHTML = `<h3 class="evdoch">📸 توثيق المناسبة</h3>
    ${e.story ? `<div class="story">${esc(e.story)}</div>` : '<p class="sub">لا حكاية موثقة بعد.</p>'}
    ${photos.length ? `<div class="evgrid">${photos.map(x => `<figure><img src="${x.url}" alt="${esc(x.caption || 'صورة من المناسبة')}" data-evzoom="${x.id}">${canDoc() ? `<button class="x" data-evdel="${x.id}" aria-label="حذف صورة">✕</button>` : ''}${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
    ${vids.map(x => `<div class="evvid">▶️ <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.caption || 'مشاهدة الفيديو')}</a>${canDoc() ? `<button class="x" data-evdel="${x.id}" aria-label="حذف فيديو">✕</button>` : ''}</div>`).join('')}
    <div class="evdoc-tools">${canDoc() ? `<button data-evadd="photo">➕ صورة</button><button data-evadd="video">➕ فيديو (رابط)</button><button data-evadd="story">✏️ ${e.story ? 'تعديل الحكاية' : 'كتابة حكاية المناسبة'}</button>` : `<button data-evadd="code">🎟️ لديّ رمز توثيق هذه المناسبة</button>`}</div>`;
  box.querySelectorAll('[data-evzoom]').forEach(im => im.onclick = () => { const i = photos.findIndex(z => z.id === im.dataset.evzoom); if (i >= 0) evZoom(e, photos, i); });
  box.querySelectorAll('[data-evdel]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف هذا العنصر من التوثيق؟')) return;
    try {
      if (CFG.DEMO) e._media = (e._media || []).filter(z => z.id !== b.dataset.evdel);
      else { const r = await rpc('secure_delete_event_media', { p_passcode: pass(), p_media_id: b.dataset.evdel }); if (!r.ok) throw new Error(); e.media_count = Math.max(0, (e.media_count || 1) - 1); }
      loadEvDoc(e, true); toast('تم الحذف');
    } catch (_) { toast('تعذر الحذف — تأكد من الرمز'); }
  });
  box.querySelectorAll('[data-evadd]').forEach(b => b.onclick = async () => {
    const k = b.dataset.evadd;
    if (k === 'code') {
      const c = prompt('أدخل رمز توثيق هذه المناسبة (تحصل عليه من مالك الموقع):'); if (!c) return;
      const code = c.trim();
      if (CFG.DEMO) { evDocCodes.set(String(e.id), code); loadEvDoc(e); return; }
      try {
        const r = await rpc('verify_event_doc', { p_passcode: code, p_event_id: e.id });
        if (r && r.ok) { evDocCodes.set(String(e.id), code); loadEvDoc(e); toast('تم التحقق من الرمز — تقدر توثّق الآن'); }
        else toast(r && r.error === 'locked' ? 'محاولات خاطئة كثيرة — انتظر 15 دقيقة ثم حاول' : 'الرمز غير مطابق لهذه المناسبة');
      } catch (_) { toast('تعذر التحقق من الرمز'); }
      return;
    }
    if (k === 'photo') { const f = $('#ev-file'); f.dataset.eid = e.id; f.click(); return; }
    if (k === 'video') {
      const u = prompt('رابط الفيديو (يوتيوب/درايف…):'); if (!u) return;
      const cap = prompt('عنوان الفيديو (اختياري):') || '';
      try {
        if (CFG.DEMO) (e._media = e._media || []).push({ id: 'v' + Date.now(), kind: 'video', url: u.trim(), caption: cap.trim() || null });
        else { const r = await rpc('secure_add_event_media', { p_passcode: pass(), p_event_id: e.id, p_kind: 'video', p_url: u.trim(), p_caption: cap.trim() }); if (!r.ok) throw new Error(); e.media_count = (e.media_count || 0) + 1; }
        loadEvDoc(e, true); toast('تمت إضافة الفيديو');
      } catch (_) { toast('تعذر الإضافة — تأكد من الرابط أو الرمز'); }
      return;
    }
    if (k === 'story') {
      const s = prompt('حكاية المناسبة (وين كانت؟ أبرز ما صار؟):', e.story || ''); if (s === null) return;
      try {
        if (!CFG.DEMO) { const r = await rpc('secure_set_event_story', { p_passcode: pass(), p_event_id: e.id, p_story: s }); if (!r.ok) throw new Error(); }
        e.story = s.trim() || null; evDetails(); toast('تم حفظ الحكاية');
      } catch (_) { toast('تعذر الحفظ — تأكد من الرمز'); }
    }
  });
}
/* عارض الصور: تنقّل سابق/تالي بين صور المناسبة (ann30) */
function evZoom(e, photos, idx) {
  const x = photos[idx]; if (!x) return;
  $('#profile-body').innerHTML = `<div class="evzoombar"><button class="x" id="evback">→ رجوع</button><span class="sub">${idx + 1} / ${photos.length}</span>
    <span><button class="x" id="evprev" ${idx === 0 ? 'disabled' : ''} aria-label="الصورة السابقة">‹ سابقة</button>
    <button class="x" id="evnext" ${idx === photos.length - 1 ? 'disabled' : ''} aria-label="الصورة التالية">تالية ›</button></span></div>
    <img class="evbig" src="${x.url}" alt="">${x.caption ? `<p class="sub">${esc(x.caption)}</p>` : ''}`;
  $('#evback').onclick = () => evDetails();
  const pv = $('#evprev'), nx = $('#evnext');
  if (pv) pv.onclick = () => evZoom(e, photos, idx - 1);
  if (nx) nx.onclick = () => evZoom(e, photos, idx + 1);
}
function compressEventPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); let w = img.width, h = img.height; const k = Math.min(1, 1280 / Math.max(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h); let q = 0.82, out = cv.toDataURL('image/jpeg', q); while (out.length > 560000 && q > 0.45) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); } res(out); };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
$('#event').addEventListener('click', ev => {
  const n = ev.target.closest('[data-evn]');
  if (n) { const L = evList(); S.ev = ((S.ev || 0) + +n.dataset.evn + L.length) % L.length; showEvent(); }
  else if (ev.target.closest('.ev-more')) evDetails();
});
document.addEventListener('click', e => { const d = $('.more'); if (!d.contains(e.target)) d.open = false; });
setInterval(showEvent, 60000);
function collapseAll() { S.open = new Set(); for (const r of S.roots) { S.open.add(r.id); for (const k of S.kids.get(r.id) || []) S.open.add(k.id); } }
/* ann24: على الجوال يبدأ العرض بالمؤسس فقط مطويًا (طلب المالك) */
function collapseInitial() { if (window.matchMedia('(max-width: 640px)').matches) S.open = new Set(S.roots.map(r => r.id)); else collapseAll(); } /* ann48: المؤسس مفتوح بالجوال فتظهر الشجرة */
/* أبناء العرض: نتجاوز العضوات المخفيات (لا بطاقة لهن عند الزوار بطلب المالك) ونُظهر أبناءهن إن وُجدوا في مكانهن */
const dispKids = m => { const out = []; for (const c of (S.kids.get(m.id) || [])) { if (c.name_masked) out.push(...dispKids(c)); else out.push(c); } return out; };
const dispRoots = () => { const out = []; const push = m => { if (m.name_masked) (S.kids.get(m.id) || []).forEach(push); else out.push(m); }; S.roots.forEach(push); return out; };
/* نص عدد الأبناء والبنات محسوبًا من كامل الأبناء (يشمل المخفيات) ليظهر في بطاقة الأب */
const kidsTxt = m => { const ks = S.kids.get(m.id) || []; if (!ks.length) return ''; const s = ks.filter(c => c.gender === 'male').length, d = ks.length - s; return [s ? `👦 ${s}` : '', d ? `👧 ${d}` : ''].filter(Boolean).join(' · '); };
const kidsOf = m => S.open.has(m.id) ? dispKids(m) : [];

/* ---------- المخطط ---------- */
function layout() {
  const pos = new Map(); let leaf = 0;
  const walk = (m, d) => {
    const ks = kidsOf(m); let x;
    if (!ks.length) { x = leaf; leaf += W + GX; }
    else { ks.forEach(c => walk(c, d + 1)); x = (pos.get(ks[0].id).x + pos.get(ks[ks.length - 1].id).x) / 2; }
    pos.set(m.id, { x, y: d * (H + GY), m });
  };
  dispRoots().forEach(r => walk(r, 0));
  return pos;
}
function renderGraph(fitView) {
  const pos = layout(); let mw = 0, mh = 0;
  for (const p of pos.values()) { mw = Math.max(mw, p.x + W); mh = Math.max(mh, p.y + H); }
  const X = x => mw - x - W; S._pos = pos; S._X = X; let nodes = '', lines = '', k = 0;
  for (const { x, y, m } of pos.values()) {
    const all = dispKids(m), ks = kidsOf(m), o = ks.length > 0, hit = S.hit?.has(m.id);
    for (const c of ks) { const q = pos.get(c.id); lines += `<path style="stroke:${COL[(gen(c) - 1) % COL.length]}" d="M${X(x) + W / 2} ${y + H} V${y + H + GY / 2} H${X(q.x) + W / 2} V${q.y}"/>`; }
    nodes += `<div class="gn${hit ? ' hit' : ''}${m.id === S.curId ? ' cur' : ''}${m.is_alive === false ? ' dead' : ''}" style="left:${X(x)}px;top:${y}px;--ac:${COL[(gen(m) - 1) % COL.length]};--i:${k++}" data-p="${m.id}" tabindex="0" role="button">
      <i>الجيل ${gen(m)}</i>${S.photos.get(m.id) ? `<img class="gimg" src="${S.photos.get(m.id)}" alt="">` : ''}${m.is_alive === false ? '' : '<em class="al"></em>'}
      <b>${esc(cardName(m))}</b><small class="stt ${m.is_alive === false ? 'dead' : 'alive'}">${m.is_alive === false ? 'رحمه الله' : 'حي يرزق'}${m.nickname ? ' · ' + esc(m.nickname) : ''}</small>${m.achievement_badge ? `<span class="bd">${esc(m.achievement_badge)}</span>` : ''}
      <small class="meta">${esc([m.city ? '📍 ' + m.city : '', kidsTxt(m)].filter(Boolean).join(' · '))}</small>
      ${all.length ? `<button class="tg" data-t="${m.id}" aria-expanded="${o}" aria-label="${o ? 'طي' : 'عرض'} فرع ${esc(m.full_name)}">${o ? 'طي' : 'عرض'} ${all.length}</button>` : ''}</div>`;
  }
  const st = $('#stage'); st.style.width = mw + 'px'; st.style.height = mh + 'px';
  $('#lines').setAttribute('width', mw); $('#lines').setAttribute('height', mh);
  $('#lines').innerHTML = lines; $('#nodes').innerHTML = nodes; $('#nodes').classList.toggle('enter', !!fitView);
  if (fitView === 'hit' && S.hit?.size) focusHits(pos, X); else if (fitView) fit(); else setT();
}
const setT = () => { $('#stage').style.transform = `translate(${V.x}px,${V.y}px) scale(${V.k})`; };
function fit() {
  const vp = $('#vp'), st = $('#stage'), w = vp.clientWidth, h = vp.clientHeight;
  V.k = Math.max(.3, Math.min(1, (w - 130) / (st.offsetWidth + 40), h / (st.offsetHeight + 60)));
  V.x = (w - st.offsetWidth * V.k) / 2; V.y = Math.max(12, (h - st.offsetHeight * V.k) / 2); setT(); // ann23: توسيط عمودي أيضًا (طلب المالك: الفتح والملاءمة بالتوسيط)
}
function focusHits(pos, X) {  // تعرض كل نتائج البحث معًا (بحدّ أدنى للتصغير)
  const hs = [...S.hit].map(id => pos.get(id)).filter(Boolean);
  if (!hs.length) return fit();
  const vp = $('#vp'), w = vp.clientWidth, h = vp.clientHeight;
  const x1 = Math.min(...hs.map(p => X(p.x))), x2 = Math.max(...hs.map(p => X(p.x) + W));
  const y1 = Math.min(...hs.map(p => p.y)), y2 = Math.max(...hs.map(p => p.y + H));
  const k = Math.max(.3, Math.min(1, (w - 130) / (x2 - x1 + 80), h / (y2 - y1 + 120))), cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  V.k = k; V.x = w / 2 - cx * k; V.y = h / 2 - cy * k; setT();
}
function zoomAt(cx, cy, f) {
  const r = $('#vp').getBoundingClientRect(), k = Math.min(2, Math.max(.25, V.k * f)), px = cx - r.left, py = cy - r.top;
  V.x = px - (px - V.x) * (k / V.k); V.y = py - (py - V.y) * (k / V.k); V.k = k; setT();
}
/* سحب بإصبع واحد، وقرص بإصبعين، وعجلة الفأرة */
const vp = $('#vp'), ptr = new Map(); let moved = 0;
const dist = () => { const [a, b] = [...ptr.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
vp.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; });
addEventListener('pointermove', e => {
  const p = ptr.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
  if (ptr.size === 2) { const d0 = dist(); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); const d1 = dist(), [a, b] = [...ptr.values()]; zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d1 / d0); }
  else { V.x += dx; V.y += dy; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); setT(); }
});
['pointerup', 'pointercancel'].forEach(t => addEventListener(t, e => ptr.delete(e.pointerId)));
vp.addEventListener('click', e => { if (moved > 8 && !e.target.closest('button')) e.stopPropagation(); }, true);
vp.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
$('#z-fit').onclick = fit;

/* ---------- القائمة (للجوال) ---------- */
function node(m) {
  const k = dispKids(m), o = S.open.has(m.id), hit = S.hit?.has(m.id);
  return `<li><div class="card${hit ? ' hit' : ''}${m.id === S.curId ? ' cur' : ''}">
    ${k.length ? `<button class="tg tgl" data-t="${m.id}" aria-expanded="${o}" aria-label="${o ? 'طي' : 'عرض'} فرع ${esc(m.full_name)}">${o ? 'طي' : 'عرض'}</button>` : '<span class="tg dot"></span>'}
    <div class="nm" data-p="${m.id}" tabindex="0" role="button">${S.photos.get(m.id) ? `<img class="gimg2" src="${S.photos.get(m.id)}" alt="">` : ''}<b>${esc(cardName(m))}</b>${m.nickname ? `<small>${esc(m.nickname)}</small>` : ''}</div>
    ${m.achievement_badge ? `<span class="bd">${esc(m.achievement_badge)}</span>` : ''}${kidsTxt(m) ? `<span class="ct">${kidsTxt(m)}</span>` : ''}${m.is_alive === false ? '<span class="rip">رحمه الله</span>' : ''}
  </div>${k.length && o ? `<ul>${k.map(node).join('')}</ul>` : ''}</li>`;
}

/* ---------- العرض والتحكم ---------- */
function render(fitView) {
  stats();
  const g = S.view === 'graph', none = !!S.hit && S.hit.size === 0;
  $('#vp').hidden = !g || none; $('#tree').hidden = g || none;
  $('#v-graph').setAttribute('aria-pressed', g); $('#v-list').setAttribute('aria-pressed', !g);
  S.order = [];
  if (!none) {
    if (g) {
      renderGraph(fitView);
      if (S.hit) S.order = [...S.hit].filter(id => S._pos.has(id)).sort((a, b) => S._pos.get(a).y - S._pos.get(b).y || S._X(S._pos.get(b).x) - S._X(S._pos.get(a).x));
    } else {
      $('#tree').innerHTML = dispRoots().map(node).join('');
      if (S.hit) S.order = [...$('#tree').querySelectorAll('.card.hit .nm')].map(el => el.dataset.p);
    }
  }
  $('#qn').hidden = !S.order.length;
  $('#qc').textContent = S.curId && S.order.includes(S.curId) ? `${S.order.indexOf(S.curId) + 1} / ${S.order.length}` : `${S.order.length} نتيجة`;
  $('#empty').innerHTML = (S.members.length ? 'لا توجد نتائج لهذا البحث.' : 'لا يوجد أفراد بعد.') + (!S.members.length && canEdit() ? '<br><button id="add-root">➕ إضافة أول فرد</button>' : '');
  $('#empty').hidden = !(none || !S.members.length);
}
$('#v-graph').onclick = () => { S.view = 'graph'; render(true); };
$('#v-list').onclick = () => { S.view = 'list'; render(); };
const norm = s => String(s ?? '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
$('#q').addEventListener('input', e => {
  const q = norm(e.target.value);
  S.curId = null;
  if (!q) { if (S.saved) S.open = S.saved; S.saved = S.hit = null; return render(true); }
  if (!S.saved) S.saved = new Set(S.open);
  S.hit = new Set(S.members.filter(m => !m.name_masked && (norm(m.full_name).includes(q) || norm(m.nickname).includes(q))).map(m => m.id));
  S.open = new Set();  // تُفتح آباء النتائج فقط، وتبقى أزرار الطي والفتح تعمل
  for (const id of S.hit) for (let a = S.byId.get(S.byId.get(id)?.father_id), i = 0; a && i < 30; a = S.byId.get(a.father_id), i++) S.open.add(a.id);
  render('hit');
});
function goHit(i) {  // الانتقال إلى نتيجة محددة (Enter للتالية، Shift+Enter للسابقة)
  const n = S.order.length; if (!n) return;
  S.curId = S.order[(i % n + n) % n];
  render();
  if (S.view === 'graph') {
    const p = S._pos.get(S.curId); if (!p) return;
    const vp = $('#vp'), st = $('#stage');
    st.classList.add('anim'); V.k = 1;
    V.x = vp.clientWidth / 2 - (S._X(p.x) + W / 2); V.y = vp.clientHeight / 2 - (p.y + H / 2); setT();
    setTimeout(() => st.classList.remove('anim'), 350);
  } else document.querySelector('.card.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
const stepHit = d => { const i = S.order.indexOf(S.curId); goHit(d > 0 ? i + 1 : (i < 0 ? -1 : i - 1)); };
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } });
$('#qx').onclick = () => stepHit(1); $('#qp').onclick = () => stepHit(-1);
function onTree(e) {
  const t = e.target.closest('[data-t]'), p = e.target.closest('[data-p]');
  if (t) { const id = t.dataset.t; S.open.has(id) ? S.open.delete(id) : S.open.add(id); render(); }
  else if (p) profile(p.dataset.p);
}
$('#nodes').addEventListener('click', onTree); $('#tree').addEventListener('click', onTree);
for (const el of [$('#nodes'), $('#tree')]) el.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.p) { e.preventDefault(); profile(e.target.dataset.p); }
});
$('#btn-open').onclick = () => { S.saved = null; S.open = new Set(S.members.map(m => m.id)); render(true); };
$('#btn-close').onclick = () => { S.saved = null; collapseAll(); render(true); };
addEventListener('resize', () => { if (S.view === 'graph' && !$('#vp').hidden) fit(); });

/* ---------- الملف الشخصي ---------- */
function waNum(p) {  // 05xxxxxxxx أو 5xxxxxxxx أو 00966... إلى صيغة دولية بلا + أو أصفار
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0966')) d = d.slice(1);
  if (/^05\d{8}$/.test(d)) d = '966' + d.slice(1); else if (/^5\d{8}$/.test(d)) d = '966' + d;
  return d;
}
function profile(id) {
  const m = S.byId.get(id); if (!m) return;
  const father = S.byId.get(m.father_id), wives = S.wives.filter(w => w.husband_id === m.id), mother = S.wives.find(w => w.id === m.wife_mother_id);
  const hub = S.wives.find(w => w.member_id === m.id), husband = hub ? S.byId.get(hub.husband_id) : null;
  const born = m.birth_year_text || (m.birth_date || '').slice(0, 4);
  const died = m.is_alive === false ? (m.death_year_text || (m.death_date || '').slice(0, 4) || 'غير معروف') : '';
  $('#profile-body').dataset.id = id;
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '', digits = waNum(m.phone);
  $('#profile-body').innerHTML = `${S.photos.get(m.id) ? `<img class="pimg" src="${S.photos.get(m.id)}" alt="">` : ''}<h2>${esc(m.full_name)}</h2>
    <p class="sub">${m.nickname ? esc(m.nickname) + ' · ' : ''}الجيل ${gen(m)}${m.is_alive === false ? ' · رحمه الله' : ''}</p>
    ${m.achievement_badge ? `<p><span class="bd">${esc(m.achievement_badge)}</span></p>` : ''}
    <dl>${row('الأب', father ? esc(father.full_name) : '')}${row('الأم', mother ? esc(mother.full_name) : '')}
      ${row('الزوج', husband ? esc(husband.full_name) : '')}
      ${row('الزوجات', wives.map(w => esc(w.full_name) + (w.family_name ? ' (' + esc(w.family_name) + ')' : '') + (w.member_id ? ' · من الأسرة' + (S.byId.get(w.member_id)?.name_masked ? '' : ' <button class="x" data-so="' + esc(w.member_id) + '">ملفها</button>') : '') + (canMember(m) ? `<button class="x" data-wd="${esc(w.id)}" aria-label="حذف زوجة">✕</button>` : '')).join('، '))}
      ${row('مسؤول الفرع', esc(delegateName(S.branches.find(x => x.root_id === m.id))))}${row('الأبناء', (S.kids.get(m.id) || []).length || '')}${row('الميلاد', esc(born))}${row('الوفاة', esc(died))}${row('المدينة', esc(m.city))}
      ${row('الهاتف', digits ? `<a href="tel:+${digits}" dir="ltr">${esc(m.phone)}</a> · <a href="https://wa.me/${digits}" target="_blank" rel="noopener">واتساب</a>` : '')}</dl>
    ${m.audio_url ? `<audio controls preload="none" src="${esc(m.audio_url)}" style="width:100%"></audio>` : ''}
    ${(m.biography_story || m.bio) ? `<div class="story">${esc(m.biography_story || m.bio)}</div>` : ''}
    ${canMember(m) ? `<div class="row adm"><button data-act="edit">✏️ تعديل</button><button data-act="child">➕ ابن</button><button data-act="wife">➕ زوجة</button><button data-act="photo">📷 صورة</button>${S.role === 'owner' ? '<button data-act=\"branch\">👤 مسؤول الفرع</button><button class="danger" data-act="del">🗑 حذف</button>' : ''}</div>` : '<div class="row adm"><button class="ghost" data-sg="1">📝 اقتراح تصحيح</button></div>'}`;
  $('#profile').showModal();
}
$('#profile-x').onclick = () => $('#profile').close();

/* ---------- الإدارة: تعمل عبر دوال الخادم المؤمّنة، وفي التجربة على الذاكرة ---------- */
async function op(name, args, demo) {
  if (CFG.DEMO) { demo(); index(); render(); return { success: true }; }
  const r = await rpc(name, args);
  if (!r.success) throw new Error(r.message || 'تعذر الحفظ');
  return r;
}
async function refresh() {
  const b = await rpc('get_bundle', { p_code: S.code });
  if (!b.ok) throw new Error('انتهت الجلسة، سجّل الدخول من جديد');
  S.members = b.members; S.wives = b.wives; S.events = b.events || []; S.branch = b.branch || null; S.branches = b.branches || []; index(); render(); showEvent();
}
function openForm(title, fields, onSubmit) {
  $('#form-title').textContent = title; $('#form-err').hidden = true; S.onForm = onSubmit;
  $('#form-fields').innerHTML = fields.map(f => f.type === 'raw' ? f.html : `<label class="fl">${esc(f.label)}${
    f.type === 'select' ? `${f.opts.length > 12 ? `<input class="selfilter" type="search" placeholder="🔍 ابحث في القائمة…" data-tg="${f.k}">` : ''}<select name="${f.k}">${f.opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(f.val ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
    : f.type === 'area' ? `<textarea name="${f.k}" rows="4"${f.req ? ' required' : ''}>${esc(f.val)}</textarea>`
    : `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(f.val)}"${f.req ? ' required' : ''} autocomplete="off">`}</label>`).join('');
  /* ann41: بحث داخل القوائم الطويلة (رأس فرع/مسؤول/عضو…) */
  document.querySelectorAll('.selfilter').forEach(inp => {
    const sel = document.querySelector(`select[name="${inp.dataset.tg}"]`); if (!sel) return;
    const all = [...sel.options].map(o => [o.value, o.textContent]);
    inp.addEventListener('input', () => {
      const q = inp.value.trim();
      sel.innerHTML = all.filter(([v, t], i) => (i === 0 && v === '') || t.includes(q)).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    });
  });
  $('#form').showModal();
}
$('#form-el').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  try { await S.onForm(Object.fromEntries(new FormData(e.target))); $('#form').close(); }
  catch (err) { $('#form-err').textContent = err.message || 'تعذر الحفظ'; $('#form-err').hidden = false; }
  btn.disabled = false;
});
$('#form-x').onclick = () => $('#form').close();

async function saveMember(m, fid, d) {
  const v = { full_name: d.full_name.trim(), nickname: d.nickname.trim() || null, gender: d.gender, is_alive: d.alive === '1', birth_year_text: d.by.trim() || null,
    death_year_text: d.alive === '1' ? null : (d.dy.trim() || null), city: (d.city === '__other' ? (d.city2 || '') : d.city).trim() || null, achievement_badge: d.badge.trim() || null, phone: d.phone.trim() || null,
    birth_order: +d.order || 1, wife_mother_id: d.mother || null, biography_story: d.story.trim() || null, name_public: d.gender === 'female' && d.namepub === '1', name_hidden: d.gender === 'female' && d.namehid === '1' };
  const r = await op('secure_save_member', { p_id: m?.id ?? null, p_full_name: v.full_name, p_nickname: v.nickname, p_gender: v.gender, p_father_id: fid,
    p_wife_mother_id: v.wife_mother_id, p_birth_order: v.birth_order, p_phone: v.phone, p_is_alive: v.is_alive, p_birth_year_text: v.birth_year_text,
    p_death_year_text: v.death_year_text, p_biography_story: v.biography_story, p_passcode: S.code },
    () => { if (m) Object.assign(m, v); else S.members.push({ id: 'n' + Date.now(), father_id: fid, audio_url: null, created_at: Date.now(), ...v }); });
  await op('secure_update_member_extras', { p_id: r.id ?? m?.id, p_city: v.city, p_achievement_badge: v.achievement_badge, p_audio_url: m?.audio_url || null, p_name_public: v.name_public, p_name_hidden: v.name_hidden, p_passcode: S.code }, () => {});
  if (fid) S.open.add(fid);
  if (!CFG.DEMO) await refresh(); else render();
  // بطاقات تلقائية: إضافة مولود ← تهنئة، وتحويل حي إلى متوفى ← تعزية (تقبل السنة الحالية أو الماضية، هجري/ميلادي، بأرقام عربية أو إنجليزية)
  const ym = (String(v.birth_year_text || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).match(/\d{4}/) || [''])[0];
  const yr = new Date().getFullYear(), hj = +new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { year: 'numeric' }).format(new Date()).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  const newborn = !ym || Math.abs(+ym - yr) <= 1 || Math.abs(+ym - hj) <= 1;
  if (!m && v.is_alive && newborn) { const ln = cardLongName({ full_name: v.full_name, gender: v.gender, father_id: fid }); setTimeout(() => openCard({ full_name: ln, gender: v.gender, father_id: fid }, 'birth'), 80); postAnnouncement('birth', { id: r.id, full_name: ln, gender: v.gender }); }
  else if (m && m.is_alive !== false && !v.is_alive) { const ln = cardLongName({ full_name: v.full_name, gender: v.gender, father_id: m.father_id }); setTimeout(() => openCard({ full_name: ln, gender: v.gender, father_id: m.father_id }, 'condolence'), 80); postAnnouncement('condolence', { id: m.id, full_name: ln, gender: v.gender }); }
}
const CITIES = ['المدينة المنورة', 'ينبع', 'العلا', 'خيبر', 'الحناكية', 'المهد', 'بدر', 'وادي الفرع', 'العيص', 'مكة المكرمة', 'جدة', 'الطائف', 'رابغ', 'الليث', 'القنفذة', 'الجموم', 'الرياض', 'الخرج', 'الدوادمي', 'المجمعة', 'الزلفي', 'شقراء', 'وادي الدواسر', 'الأفلاج', 'حوطة بني تميم', 'الدمام', 'الخبر', 'الظهران', 'الجبيل', 'الأحساء', 'القطيف', 'حفر الباطن', 'تبوك', 'ضباء', 'الوجه', 'أملج', 'تيماء', 'حائل', 'بريدة', 'عنيزة', 'الرس', 'عرعر', 'سكاكا', 'القريات', 'أبها', 'خميس مشيط', 'بيشة', 'جازان', 'صبيا', 'نجران', 'الباحة', 'بلجرشي', 'خارج المملكة'];
function memberForm(m, parentId) {
  const fid = m ? m.father_id : parentId, moms = S.wives.filter(w => w.husband_id === fid);
  const f = (k, label, val, type, x = {}) => ({ k, label, val, type, ...x });
  openForm(m ? 'تعديل بيانات الفرد' : fid ? 'إضافة ابن لـ ' + (S.byId.get(fid)?.full_name || '') : 'إضافة أول فرد', [
    f('full_name', 'الاسم الكامل', m?.full_name, 'text', { req: true }), f('nickname', 'الكنية', m?.nickname),
    f('gender', 'الجنس', m?.gender || 'male', 'select', { opts: [['male', 'ذكر'], ['female', 'أنثى']] }),
    f('alive', 'الحالة', m?.is_alive === false ? '0' : '1', 'select', { opts: [['1', 'حي'], ['0', 'متوفى']] }),
    f('by', 'سنة الميلاد (نص)', m?.birth_year_text ?? (m?.birth_date || '').slice(0, 4)), f('dy', 'سنة الوفاة', m?.death_year_text),
    { type: 'raw', html: `<div class="conv"><b>محوّل سنة الميلاد والوفاة (هجري ⇄ ميلادي)</b><div class="convrow"><input name="cy" type="number" placeholder="السنة" aria-label="السنة للتحويل"><select name="cc" aria-label="نوع السنة"><option value="h">هجرية</option><option value="g">ميلادية</option></select><button type="button" id="cv-go">حوّل</button></div><p class="cvout sub" hidden></p><div class="convrow"><button type="button" id="cv-by">املأ به سنة الميلاد</button><button type="button" id="cv-dy">املأ به سنة الوفاة</button></div></div>` },
    f('city', 'المدينة', m?.city || '', 'select', { opts: [['', '—'], ['__other', 'أخرى — مدينة جديدة'], ...CITIES.map(c => [c, c]), ...(m?.city && !CITIES.includes(m.city) ? [[m.city, m.city]] : [])] }),
    f('city2', 'المدينة الجديدة (تُستخدم عند اختيار «أخرى»)', ''), f('phone', 'الهاتف', m?.phone, 'tel'), f('badge', 'الشارة', m?.achievement_badge),
    f('order', 'ترتيب الميلاد بين إخوته', m?.birth_order ?? (S.kids.get(fid)?.length || 0) + 1, 'number'),
    ...(moms.length ? [f('mother', 'الأم', m?.wife_mother_id || '', 'select', { opts: [['', '—'], ...moms.map(w => [w.id, w.full_name])] })] : []),
    f('namepub', 'إظهار الاسم رغم إخفاء أسماء النساء (للإناث)', m?.name_public ? '1' : '0', 'select', { opts: [['0', 'لا'], ['1', 'نعم']] }),
    f('namehid', 'إخفاء الاسم برغبة صاحبة الاسم (للإناث)', m?.name_hidden ? '1' : '0', 'select', { opts: [['0', 'لا'], ['1', 'نعم']] }),
    f('story', 'نبذة', m?.biography_story || m?.bio, 'area')], d => saveMember(m, fid, d));
  const cvGo = document.querySelector('#cv-go');
  if (cvGo) {
    let cvText = '';
    const run = () => { const y = +document.querySelector('#form-fields [name=cy]').value, cc = document.querySelector('#form-fields [name=cc]').value, out = document.querySelector('.cvout');
      if (!y || y < 1000 || y > 3000) { out.hidden = false; out.textContent = 'أدخل سنة صحيحة أولًا'; cvText = ''; return; }
      cvText = cc === 'h' ? hijriYearText(y) : gregYearText(y); out.hidden = false; out.textContent = cvText; };
    cvGo.onclick = run;
    document.querySelector('#cv-by').onclick = () => { if (!cvText) run(); if (cvText) document.querySelector('#form-fields [name=by]').value = cvText; };
    document.querySelector('#cv-dy').onclick = () => { if (!cvText) run(); if (cvText) document.querySelector('#form-fields [name=dy]').value = cvText; };
  }
  const alSel = document.querySelector('#form-fields [name=alive]'), dyInp = document.querySelector('#form-fields [name=dy]');
  if (alSel && dyInp) { const syncAlive = () => { dyInp.closest('.fl').style.display = alSel.value === '1' ? 'none' : ''; }; alSel.addEventListener('change', syncAlive); syncAlive(); }
  const gSel = document.querySelector('#form-fields [name=gender]');
  if (gSel) { const syncGender = () => { const fem = gSel.value === 'female'; for (const n of ['namepub', 'namehid']) { const inp = document.querySelector(`#form-fields [name=${n}]`); if (inp) inp.closest('.fl').style.display = fem ? '' : 'none'; } }; gSel.addEventListener('change', syncGender); syncGender(); }
}
function wifeForm(m) {
  const women = S.members.filter(x => x.gender === 'female').sort(byName);
  openForm('إضافة زوجة لـ ' + m.full_name, [
    { k: 'mode', label: 'نوع الزوجة', type: 'select', val: 'new', opts: [['new', 'من خارج الأسرة (اسم نصي)'], ['link', 'من نساء الأسرة (ربط بسجلها)']] },
    { k: 'member', label: 'اخترها من نساء الشجرة (عند الربط)', type: 'select', opts: [['', '—'], ...women.map(w => [w.id, w.full_name])] },
    { k: 'name', label: 'اسم الزوجة (عند عدم الربط)' }, { k: 'fam', label: 'اسم عائلتها' },
    { k: 'namepub', label: 'إظهار اسمها رغم إخفاء أسماء النساء', type: 'select', val: '0', opts: [['0', 'لا'], ['1', 'نعم']] },
    { k: 'namehid', label: 'إخفاء اسمها برغبتها', type: 'select', val: '0', opts: [['0', 'لا'], ['1', 'نعم']] }], async d => {
    const linked = d.mode === 'link' && d.member ? S.byId.get(d.member) : null;
    if (d.mode === 'link' && !linked) throw new Error('اختر الزوجة من قائمة نساء الأسرة');
    const name = linked ? linked.full_name : d.name.trim();
    if (!name) throw new Error('الاسم مطلوب');
    const fam = linked ? null : (d.fam.trim() || null);
    await op('secure_save_wife', { p_husband_id: m.id, p_full_name: name, p_family_name: fam, p_member_id: linked?.id || null, p_name_public: d.namepub === '1', p_name_hidden: d.namehid === '1', p_passcode: S.code },
      () => S.wives.push({ id: 'w' + Date.now(), husband_id: m.id, full_name: name, family_name: fam, member_id: linked?.id || null, name_public: d.namepub === '1', name_hidden: d.namehid === '1' }));
    if (!CFG.DEMO) await refresh(); profile(m.id);
  });
}
async function delWife(id) {
  const w = S.wives.find(x => x.id === id); if (!w) return;
  if (S.members.some(m => m.wife_mother_id === id)) return alert('لا يمكن حذفها: لها أبناء مسجّلون.');
  if (!confirm(`حذف الزوجة «${w.full_name}»؟`)) return;
  try { await op('secure_delete_wife', { wife_id: id, passcode: S.code }, () => { S.wives = S.wives.filter(x => x.id !== id); }); if (!CFG.DEMO) await refresh(); profile(w.husband_id); }
  catch (err) { alert(err.message); }
}
async function delMember(m) {
  if ((S.kids.get(m.id) || []).length) return alert('لا يمكن حذف فرد له أبناء. احذف الأبناء أولًا.');
  if (!confirm(`حذف «${m.full_name}» نهائيًا؟ لا يمكن التراجع، وخذ نسخة احتياطية قبل ذلك.`)) return;
  try {
    for (const w of S.wives.filter(x => x.husband_id === m.id)) await op('secure_delete_wife', { wife_id: w.id, passcode: S.code }, () => {});
    await op('secure_delete_member', { member_id: m.id, passcode: S.code }, () => { S.members = S.members.filter(x => x.id !== m.id); S.wives = S.wives.filter(w => w.husband_id !== m.id); });
    $('#profile').close(); if (!CFG.DEMO) await refresh();
  } catch (err) { alert(err.message); }
}
$('#profile-body').addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-wd]'); if (!b) return;
  const m = S.byId.get($('#profile-body').dataset.id);
  if (b.dataset.wd) return delWife(b.dataset.wd);
  ({ edit: () => { $('#profile').close(); memberForm(m); }, child: () => { $('#profile').close(); memberForm(null, m.id); },
     wife: () => { $('#profile').close(); wifeForm(m); }, branch: () => { $('#profile').close(); branchForm(m.id); }, del: () => delMember(m),
     photo: () => { const f = $('#photo-file'); f.dataset.mid = m.id; f.click(); } })[b.dataset.act]?.();
});
$('#m-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), members: S.members, wives: S.wives, events: S.events }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `al-matarid-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href); $('.more').open = false;
};
$('#m-settings').onclick = async () => {
  $('.more').open = false;
  const mode = CFG.DEMO ? 'family_code' : await rpc('get_access_mode');
  openForm('إعدادات الوصول', [
    { k: 'mode', label: 'وضع الوصول', val: mode, type: 'select', opts: [['family_code', 'رمز العائلة (الشجرة محمية)'], ['open_link', 'رابط مفتوح (الهواتف للمحررين فقط)']] },
    { k: 'women', label: 'أسماء النساء لبقية الزوار (المالك والمحرر ومسؤول الفرع داخل فرعه يرونها دائمًا)', val: S.womenVisible ? '1' : '0', type: 'select', opts: [['1', 'ظاهرة'], ['0', 'مخفية — تظهر «ابنة/زوجة فلان»']] },
    { k: 'fam', label: 'رمز عائلة جديد (فارغ = بلا تغيير، 6 خانات فأكثر)', type: 'password' },
    { k: 'ed', label: 'رمز محرر جديد (فارغ = بلا تغيير، 8 خانات فأكثر)', type: 'password' }], async d => {
    await op('secure_set_access_mode', { p_mode: d.mode, p_passcode: S.code }, () => {});
    await op('secure_set_women_names_visible', { p_visible: d.women === '1', p_passcode: S.code }, () => { S.womenVisible = d.women === '1'; });
    if (d.fam) await op('secure_set_family_code', { p_new_code: d.fam, p_passcode: S.code }, () => {});
    if (d.ed) await op('secure_set_editor_code', { p_new_code: d.ed, p_passcode: S.code }, () => {});
    alert('تم الحفظ');
  });
};

/* ---------- المناسبات والاقتراحات ---------- */
const pad = n => String(n).padStart(2, '0');
/* تقويم أم القرى: تحويلات هجري ⇄ ميلادي عبر Intl المدمج (بلا مكتبات) */
const HJ_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الثانية', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const _hjF = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' });
function gregToHijri(d) { const o = {}; for (const p of _hjF.formatToParts(d)) if (p.type !== 'literal') o[p.type] = +p.value; return { y: o.year, m: o.month, d: o.day }; }
function hijriToGreg(y, m, d) {
  let t = Date.UTC(Math.round(y * 0.970224 + 621.577), m - 1, d);
  const key = h => h.y * 10000 + h.m * 100 + h.d, want = y * 10000 + m * 100 + d;
  for (let i = 0; i < 400; i++) { const k = key(gregToHijri(new Date(t))); if (k === want) return new Date(t); t += (k < want ? 86400000 : -86400000); }
  return new Date(t);
}
const hijriLong = d => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch (_) { return ''; } };
const hijriShort = d => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d); } catch (_) { return ''; } };
function hijriYearText(y) { const a = hijriToGreg(y, 1, 1).getUTCFullYear(), b = hijriToGreg(y + 1, 1, 1).getUTCFullYear(); return b > a ? `${y}هـ (الموافق ${a}–${b}م)` : `${y}هـ (الموافق ${a}م)`; }
function gregYearText(y) { const a = gregToHijri(new Date(Date.UTC(y, 0, 1))).y, b = gregToHijri(new Date(Date.UTC(y, 11, 31))).y; return b > a ? `${y}م (الموافق ${a}–${b}هـ)` : `${y}م (الموافق ${a}هـ)`; }
const localDT = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function showInfo(html) { $('#profile-body').dataset.id = ''; $('#profile-body').innerHTML = html; const p = $('#profile'); if (!p.open) p.showModal(); }
const evWhen = e => new Date(e.event_date).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
function eventsList() {
  const now = Date.now(), past = e => new Date(e.event_date).getTime() < now;
  const L = [...(S.events || [])].sort((a, b) => (past(a) ? 1 : 0) - (past(b) ? 1 : 0) || new Date(a.event_date) - new Date(b.event_date));
  showInfo(`<h2>مناسبات الأسرة</h2><p class="sub">اضغط على أي مناسبة لفتح تفاصيلها وتوثيقها بالصور والفيديو</p>${L.map(e => `<div class="evrow${past(e) ? ' past' : ''}" data-evopen="${esc(e.id)}" style="cursor:pointer"><div><b>${esc(e.title)}</b>${past(e) ? ' <span class="evend">منتهي</span>' : ''}${e.media_count ? ` <span class="evmed">📸 ${e.media_count}</span>` : ''}<small>${esc(evWhen(e))} · ${esc(hijriShort(new Date(e.event_date)))}${e.location_name ? ' · ' + esc(e.location_name) : ''}</small></div>${canEdit() ? `<span><button class="x" data-ee="${esc(e.id)}" aria-label="تعديل">✏️</button><button class="x" data-ed="${esc(e.id)}" aria-label="حذف">✕</button></span>` : ''}</div>`).join('') || '<p class="sub">لا توجد مناسبات.</p>'}${canEdit() ? '<div class="row adm"><button data-ea="1">➕ مناسبة</button></div>' : ''}`);
  document.querySelectorAll('#profile-body [data-evopen]').forEach(r => r.onclick = ev2 => { if (ev2.target.closest('button')) return; const x = S.events.find(z => String(z.id) === String(r.dataset.evopen)); if (x) evDetails(x); });
}
function eventForm(e) {
  const cur = e ? new Date(e.event_date) : new Date(), hj = gregToHijri(cur);
  openForm(e ? 'تعديل مناسبة' : 'إضافة مناسبة', [
    { k: 'title', label: 'عنوان المناسبة', val: e?.title, req: true },
    { k: 'cal', label: 'تقويم الموعد', type: 'select', val: 'g', opts: [['g', 'ميلادي'], ['h', 'هجري (أم القرى)']] },
    { k: 'date', label: 'الموعد (ميلادي)', val: e ? localDT(e.event_date) : '', type: 'datetime-local' },
    { type: 'raw', html: `<div class="hjrow" hidden><span class="hjlab">الموعد (هجري)</span><select name="hd">${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}"${hj.d === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select><select name="hm">${HJ_MONTHS.map((t, i) => `<option value="${i + 1}"${hj.m === i + 1 ? ' selected' : ''}>${t}</option>`).join('')}</select><input name="hy" type="number" value="${hj.y}" min="1300" max="1600" aria-label="السنة الهجرية"><input name="ht" type="time" value="${pad(cur.getHours())}:${pad(cur.getMinutes())}" aria-label="الوقت"></div>` },
    { k: 'place', label: 'المكان', val: e?.location_name }, { k: 'url', label: 'رابط الخريطة (اختياري)', val: e?.location_url, type: 'url' },
    { k: 'desc', label: 'النوع والتفاصيل (السطر الأول: النوع — المستضيف)', val: e?.description, type: 'area' },
    { k: 'doccode', label: 'رمز توثيق المناسبة (اختياري — يُعطى لصاحبها ليضيف الصور والفيديو والحكاية بنفسه)', val: e?.doc_code || '' }], async d => {
    const url = d.url.trim(); if (url && !/^https?:\/\//.test(url)) throw new Error('رابط الخريطة يجب أن يبدأ بـ http');
    let when;
    if (d.cal === 'h') {
      const y = +d.hy, m = +d.hm, dd = +d.hd;
      if (!y || y < 1300 || y > 1600) throw new Error('أدخل السنة الهجرية بشكل صحيح');
      const g = hijriToGreg(y, m, dd), chk = gregToHijri(g);
      if (chk.y !== y || chk.m !== m || chk.d !== dd) throw new Error('هذا اليوم غير موجود في هذا الشهر الهجري — جرّب يومًا آخر');
      const [hh, mm] = (d.ht || '18:00').split(':').map(Number);
      when = new Date(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate(), hh || 0, mm || 0);
    } else {
      if (!d.date) throw new Error('أدخل الموعد');
      when = new Date(d.date);
    }
    const v = { title: d.title.trim(), event_date: when.toISOString(), location_name: d.place.trim() || null, location_url: url || null, description: d.desc.trim() || null };
    await op('secure_save_event', { p_id: e?.id ?? null, p_title: v.title, p_event_date: v.event_date, p_location_name: v.location_name, p_location_url: v.location_url, p_description: v.description, p_doc_code: d.doccode.trim(), p_passcode: S.code },
      () => { if (e) Object.assign(e, v); else S.events.push({ id: 'e' + Date.now(), ...v }); });
    if (!CFG.DEMO) await refresh(); showEvent(); eventsList();
  });
  const calSel = document.querySelector('#form-fields [name=cal]'), dtInp = document.querySelector('#form-fields [name=date]'), hjRow = document.querySelector('#form-fields .hjrow');
  const syncCal = () => { const h = calSel.value === 'h'; hjRow.hidden = !h; dtInp.closest('.fl').style.display = h ? 'none' : ''; dtInp.required = !h; dtInp.disabled = h; hjRow.querySelectorAll('select,input').forEach(x => { x.disabled = !h; }); };
  calSel.addEventListener('change', syncCal); syncCal();
}
async function delEvent(id) {
  const e = S.events.find(x => String(x.id) === id); if (!e || !confirm(`حذف المناسبة «${e.title}»؟`)) return;
  try { await op('secure_delete_event', { event_id: id, passcode: S.code }, () => { S.events = S.events.filter(x => String(x.id) !== id); }); if (!CFG.DEMO) await refresh(); showEvent(); eventsList(); }
  catch (err) { alert(err.message); }
}
const CORR_FIELDS = [['full_name', 'الاسم الكامل'], ['nickname', 'الكنية'], ['gender', 'الجنس'], ['is_alive', 'الحالة'], ['birth_year_text', 'سنة الميلاد'], ['death_year_text', 'سنة الوفاة'], ['city', 'المدينة'], ['biography_story', 'النبذة']];
const corrFieldLabel = k => (CORR_FIELDS.find(([v]) => v === k) || [, k])[1];
function memberFieldText(m, k) {
  if (!m) return '—';
  if (k === 'gender') return m.gender === 'female' ? 'أنثى' : 'ذكر';
  if (k === 'is_alive') return m.is_alive === false ? 'متوفى' : 'حي';
  const v = m[k];
  return v == null || v === '' ? '—' : String(v);
}
function corrValueText(field, val) {
  if (field === 'gender') return val === 'female' ? 'أنثى' : 'ذكر';
  if (field === 'is_alive') return val ? 'حي' : 'متوفى';
  return val == null || val === '' ? '—' : String(val);
}
function suggestForm(targetId) {
  const fixed = S.byId.get(targetId) || null;
  const memOpts = [...S.members].filter(m => !m.name_masked).sort(byName).map(m => [m.id, m.full_name]);
  openForm(fixed ? 'رسالة بخصوص ' + fixed.full_name : 'مقترح / استفسار / طلب تعديل', [
    { k: 'rtype', label: 'نوع الرسالة', type: 'select', opts: [['suggestion', '💡 مقترح'], ['inquiry', '❓ استفسار'], ['correction', '✏️ طلب تعديل معلومة']] },
    ...(fixed ? [] : [{ k: 'member', label: 'العضو المقصود (لطلب التعديل)', type: 'select', opts: [['', '— اختر العضو —'], ...memOpts] }]),
    { k: 'cfield', label: 'الحقل المراد تعديله', type: 'select', opts: CORR_FIELDS },
    { type: 'raw', html: '<p class="sub" id="sg-cur"></p>' },
    { k: 'newval', label: 'القيمة الجديدة' },
    { k: 'newgender', label: 'القيمة الجديدة', type: 'select', opts: [['male', 'ذكر'], ['female', 'أنثى']] },
    { k: 'newalive', label: 'القيمة الجديدة', type: 'select', opts: [['1', 'حي'], ['0', 'متوفى']] },
    { k: 'note', label: 'التفاصيل (نص الرسالة، أو سبب التعديل)', type: 'area' },
    { k: 'from', label: 'اسمك الكامل (إلزامي — لا تُقبل الرسائل مجهولة الاسم)', req: true },
    { k: 'frommember', label: 'هل اسمك موجود بالشجرة؟ اختره لتوثيق هويتك (اختياري)', type: 'select', opts: [['', '—'], ...memOpts] }], async d => {
    const from = (d.from || '').trim();
    if (from.length < 2) throw new Error('اكتب اسمك الكامل — لا تُقبل الرسائل بدون اسم المُرسل');
    const fm = d.frommember ? S.byId.get(d.frommember) : null;
    const base = { from, from_member_id: fm?.id || null, from_member_name: fm?.full_name || null };
    const note = (d.note || '').trim() || null;
    let type = d.rtype, target = fixed?.id || null, data;
    if (type === 'correction') {
      target = fixed?.id || d.member || null;
      if (!target) throw new Error('اختر العضو المقصود بطلب التعديل');
      const field = d.cfield;
      const new_value = field === 'gender' ? d.newgender : field === 'is_alive' ? (d.newalive === '1') : (d.newval || '').trim();
      if (field !== 'gender' && field !== 'is_alive' && !new_value && !['nickname', 'city', 'biography_story', 'death_year_text'].includes(field))
        throw new Error('اكتب القيمة الجديدة');
      data = { ...base, field, field_label: corrFieldLabel(field), new_value, note };
    } else {
      if (!note) throw new Error('اكتب نص الرسالة');
      data = { ...base, note };
    }
    await op('submit_suggestion', { p_code: S.code || null, p_target_member_id: target, p_request_type: type, p_proposed_data: data },
      () => { (S.demoSug ||= []).push({ id: 's' + Date.now(), target_member_id: target, request_type: type, proposed_data: data, created_at: new Date().toISOString() }); });
    alert('شكرًا لك، وصلت رسالتك وسيراجعها المسؤول.');
  });
  const F = n => document.querySelector(`#form-fields [name=${n}]`);
  const row = n => F(n)?.closest('.fl');
  const typeSel = F('rtype'), fldSel = F('cfield'), memSel = F('member'), cur = document.querySelector('#sg-cur');
  const sync = () => {
    const corr = typeSel.value === 'correction';
    [['member', !!memSel], ['cfield', 1], ['newval', 1], ['newgender', 1], ['newalive', 1]].forEach(([n, has]) => { if (!has) return; const el = F(n); el.disabled = !corr; if (row(n)) row(n).style.display = corr ? '' : 'none'; });
    if (cur) cur.style.display = corr ? '' : 'none';
    if (!corr) return;
    const fld = fldSel.value;
    const show = fld === 'gender' ? 'newgender' : fld === 'is_alive' ? 'newalive' : 'newval';
    ['newval', 'newgender', 'newalive'].forEach(n => { if (row(n)) row(n).style.display = n === show ? '' : 'none'; F(n).disabled = n !== show; });
    const m = S.byId.get(fixed?.id || memSel?.value || '');
    if (cur) cur.textContent = m ? `القيمة الحالية لـ«${corrFieldLabel(fld)}»: ${memberFieldText(m, fld)}` : '';
  };
  typeSel.addEventListener('change', sync); fldSel.addEventListener('change', sync); if (memSel) memSel.addEventListener('change', sync); sync();
}
async function inboxBadge() {
  const b = $('#inbox-badge'), d = $('#menu-dot');
  if (!b) return;
  if (CFG.DEMO || !['owner', 'editor', 'branch'].includes(S.role) || !S.code) { b.hidden = true; if (d) d.hidden = true; return; }
  try {
    const r = await rpc('list_suggestions', { p_passcode: S.code });
    const n = r.success ? (r.items || []).length : 0;
    b.textContent = n; b.hidden = !n; if (d) d.hidden = !n;
  } catch (_) { b.hidden = true; if (d) d.hidden = true; }
}
const REQ_TYPES = { suggestion: '💡 مقترح', inquiry: '❓ استفسار', correction: '✏️ طلب تعديل معلومة' };
async function inbox() {
  $('.more').open = false;
  let items;
  if (CFG.DEMO) items = S.demoSug ||= [{ id: 's0', target_member_id: S.members[3]?.id, request_type: 'correction', proposed_data: { field: 'birth_year_text', field_label: 'سنة الميلاد', new_value: '1370هـ (الموافق 1950–1951م)', note: 'مثال: تصحيح سنة الميلاد.', from: 'زائر تجريبي' } }];
  else { const r = await rpc('list_suggestions', { p_passcode: S.code }); if (!r.success) return alert(r.message); items = r.items; }
  const rowHtml = s => {
    const m = S.byId.get(s.target_member_id), pd = s.proposed_data || {};
    const structured = s.request_type === 'correction' && !!pd.field;
    let detail = '';
    if (structured) detail += `<small>الحقل: ${esc(pd.field_label || corrFieldLabel(pd.field))} — الحالي: «${esc(memberFieldText(m, pd.field))}» ← المقترح: «${esc(corrValueText(pd.field, pd.new_value))}»</small>`;
    if (pd.note) detail += `<small>${esc(pd.note)}</small>`;
    detail += pd.from ? `<small>المُرسل: ${esc(pd.from)}${pd.from_member_name ? ' (بالشجرة: ' + esc(pd.from_member_name) + ')' : ''}</small>` : '<small>المُرسل: غير معروف (رسالة قديمة)</small>';
    const btns = structured
      ? `${m ? `<button class="x" data-so="${esc(m.id)}">فتح</button>` : ''}<button class="x" data-sa="${esc(s.id)}">اعتماد وتطبيق ✅</button><button class="x" data-sd="${esc(s.id)}">رفض</button>`
      : `${m ? `<button class="x" data-so="${esc(m.id)}">فتح</button>` : ''}<button class="x" data-sd="${esc(s.id)}">تم ✓</button>`;
    return `<div class="evrow"><div><b>${REQ_TYPES[s.request_type] || '💡 مقترح'}${m ? ' — ' + esc(m.full_name) : ''}</b>${detail}</div><span>${btns}</span></div>`;
  };
  showInfo(`<h2>صندوق الاقتراحات (${items.length})</h2>${items.map(rowHtml).join('') || '<p class="sub">لا توجد اقتراحات.</p>'}`);
}
async function applySuggestion(id) {
  if (!confirm('اعتماد هذا التعديل وتطبيقه مباشرة على بيانات العضو؟')) return;
  try {
    await op('secure_apply_suggestion', { p_suggestion_id: id, p_passcode: S.code }, () => {
      const s = (S.demoSug || []).find(x => String(x.id) === String(id));
      if (s?.proposed_data?.field) { const m = S.byId.get(s.target_member_id); if (m) m[s.proposed_data.field] = s.proposed_data.new_value; }
      S.demoSug = (S.demoSug || []).filter(x => String(x.id) !== String(id));
    });
    if (!CFG.DEMO) await refresh();
    await inbox(); inboxBadge(); alert('تم اعتماد التعديل وتطبيقه ✅');
  } catch (err) { alert(err.message); }
}
async function delSuggestion(id) {
  try { await op('secure_delete_suggestion', { suggestion_id: id, passcode: S.code }, () => { S.demoSug = S.demoSug.filter(s => s.id !== id); }); await inbox(); inboxBadge(); }
  catch (err) { alert(err.message); }
}
$('#profile-body').addEventListener('click', e => {
  const b = e.target.closest('[data-ee],[data-ed],[data-ea],[data-sg],[data-sd],[data-so],[data-sa]'); if (!b) return;
  const D = b.dataset, cur = $('#profile-body').dataset.id;
  if ('ea' in D) { $('#profile').close(); eventForm(); }
  else if ('ee' in D) { $('#profile').close(); eventForm(S.events.find(x => String(x.id) === D.ee)); }
  else if ('ed' in D) delEvent(D.ed);
  else if ('sg' in D) { $('#profile').close(); suggestForm(cur || null); }
  else if ('sd' in D) delSuggestion(D.sd);
  else if ('sa' in D) applySuggestion(D.sa);
  else if ('so' in D) profile(D.so);
});
$('#m-events').onclick = () => { $('.more').open = false; eventsList(); };
$('#m-suggest').onclick = () => { $('.more').open = false; suggestForm(null); };
$('#m-inbox').onclick = inbox;
$('#empty').addEventListener('click', e => { if (e.target.id === 'add-root') memberForm(null, null); });

/* ---------- أقسام الاستعراض: الأسماء، المدن، الشرف، القرابة، التصدير ---------- */
const nameBtn = m => m.name_masked ? '' : `<button class="nl" data-so="${esc(m.id)}">${esc(m.full_name)}<small>الجيل ${gen(m)}${m.city ? ' · ' + esc(m.city) : ''}</small></button>`;
const byName = (a, b) => a.full_name.localeCompare(b.full_name, 'ar');
const menuClose = fn => () => { $('.more').open = false; fn(); };

function namesList(q = '') {
  const n = norm(q), L = S.members.filter(m => !n || norm(m.full_name).includes(n) || norm(m.nickname).includes(n)).sort(byName);
  if (!$('#nsrch')) showInfo(`<h2>جميع الأسماء</h2><input id="nsrch" type="search" placeholder="ابحث في الأسماء" autocomplete="off"><p class="sub" id="ncount"></p><div id="nlist"></div>`);
  $('#ncount').textContent = `${L.length} من ${S.members.length}`;
  $('#nlist').innerHTML = L.slice(0, 300).map(nameBtn).join('') + (L.length > 300 ? '<p class="sub">اكتب في البحث لتضييق النتائج…</p>' : '');
}
$('#profile-body').addEventListener('input', e => { if (e.target.id === 'nsrch') namesList(e.target.value); });
$('#m-names').onclick = menuClose(() => { $('#profile-body').innerHTML = ''; namesList(); $('#nsrch').focus(); });

$('#m-cities').onclick = menuClose(() => {
  const g = new Map(); for (const m of S.members) { const c = (m.city || '').trim() || 'غير محددة'; (g.get(c) || g.set(c, []).get(c)).push(m); }
  showInfo(`<h2>المدن والمحافظات</h2><p class="sub">${g.size} مدينة</p>${[...g].sort((a, b) => b[1].length - a[1].length).map(([c, L]) =>
    `<details><summary>${esc(c)}<span>${L.length}</span></summary>${L.sort(byName).map(nameBtn).join('')}</details>`).join('')}`);
});

$('#m-honor').onclick = menuClose(() => {
  const g = new Map(); for (const m of S.members) if (m.achievement_badge) (g.get(m.achievement_badge) || g.set(m.achievement_badge, []).get(m.achievement_badge)).push(m);
  showInfo(`<h2>🏅 لوحة الشرف</h2>${[...g].map(([b, L]) => `<h3>${esc(b)} (${L.length})</h3>${L.sort(byName).map(nameBtn).join('')}`).join('') || '<p class="sub">لا توجد شارات بعد. تُضاف الشارة من نموذج تعديل الفرد.</p>'}`);
});

/* مستكشف القرابة: عبر خط الآباء فقط */
const KIN = { '0,1': ['أب', 'أب'], '0,2': ['جد', 'جد'], '0,3': ['جد الأب', 'جد الأب'], '1,0': ['ابن', 'بنت'], '2,0': ['حفيد', 'حفيدة'], '3,0': ['ابن حفيد', 'بنت حفيد'],
  '1,1': ['أخ', 'أخت'], '1,2': ['عم', 'عمة'], '1,3': ['عم الأب', 'عمة الأب'], '2,1': ['ابن أخ', 'بنت أخ'], '3,1': ['ابن ابن أخ', 'بنت ابن أخ'],
  '2,2': ['ابن عم', 'بنت عم'], '2,3': ['ابن عم الأب', 'بنت عم الأب'], '3,2': ['ابن ابن عم', 'بنت ابن عم'], '3,3': ['ابن عم من الدرجة الثانية', 'بنت عم من الدرجة الثانية'] };
function relation(a, b) {  // «a هو ___ لـ b»
  if (a.id === b.id) return { term: 'نفس الشخص' };
  const chain = m => { const c = [m]; for (let p = S.byId.get(m.father_id), i = 0; p && i < 40; p = S.byId.get(p.father_id), i++) c.push(p); return c; };
  const ca = chain(a), cb = chain(b), ids = new Set(cb.map(x => x.id)), da = ca.findIndex(x => ids.has(x.id));
  if (da < 0) return null;
  const L = ca[da], db = cb.findIndex(x => x.id === L.id), t = KIN[da + ',' + db];
  return { L, da, db, term: t ? t[a.gender === 'female' ? 1 : 0] : `قريب (يجمعكما الجد ${L.full_name}، وبعد ${a.full_name} ${da} أجيال وبعد ${b.full_name} ${db})` };
}
function kinView() {
  const A = $('#kin-a')?.value, B = $('#kin-b')?.value, a = S.byId.get(A), b = S.byId.get(B), out = $('#kin-out'); if (!out) return;
  if (!a || !b) return out.innerHTML = '<p class="sub">اختر شخصين لمعرفة صلة القرابة بينهما.</p>';
  const r1 = relation(a, b), r2 = relation(b, a);
  out.innerHTML = r1 ? `<div class="kin"><div><b>${esc(a.full_name)}</b> هو <b>${esc(r1.term)}</b> لـ <b>${esc(b.full_name)}</b></div>
    <div><b>${esc(b.full_name)}</b> هو <b>${esc(r2.term)}</b> لـ <b>${esc(a.full_name)}</b></div>${r1.L ? `<small>الجد المشترك: ${esc(r1.L.full_name)}</small>` : ''}</div>` : '<p class="sub">لا يوجد جد مشترك في الشجرة.</p>';
}
$('#m-kin').onclick = menuClose(() => {
  const opt = S.members.slice().sort(byName).map(m => `<option value="${esc(m.id)}">${esc(m.full_name)} (الجيل ${gen(m)}${S.byId.get(S.byId.get(m.father_id)?.father_id) ? ' · ' + esc(S.byId.get(S.byId.get(m.father_id).father_id).full_name) : ''})</option>`).join('');
  showInfo(`<h2>🧭 مستكشف القرابة</h2><p class="sub">تُحسب الصلة عبر خط الآباء فقط، وهي تقريبية.</p>
    <label>الشخص الأول<select id="kin-a"><option value="">اختر…</option>${opt}</select></label>
    <label>الشخص الثاني<select id="kin-b"><option value="">اختر…</option>${opt}</select></label><div id="kin-out"></div>`); kinView();
});
$('#profile-body').addEventListener('change', e => { if (e.target.id === 'kin-a' || e.target.id === 'kin-b') kinView(); });

/* تصدير Excel (CSV بترميز يفتحه Excel بالعربية صحيحًا) */
$('#m-csv').onclick = menuClose(() => {
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const head = ['الاسم', 'الكنية', 'الأب', 'الجيل', 'الجنس', 'الحالة', 'الميلاد', 'الوفاة', 'المدينة', 'الشارة', ...(canEdit() ? ['الهاتف'] : [])];
  const rows = S.members.slice().sort(byName).map(m => [m.full_name, m.nickname, S.byId.get(m.father_id)?.full_name, gen(m), m.gender === 'female' ? 'أنثى' : 'ذكر',
    m.is_alive === false ? 'متوفى' : 'حي', m.birth_year_text || (m.birth_date || '').slice(0, 4), m.death_year_text || (m.death_date || '').slice(0, 4), m.city, m.achievement_badge, ...(canEdit() ? [m.phone] : [])]);
  const blob = new Blob(['\ufeff' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `al-matarid-names-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
});

/* ---------- مسؤولو الفروع (للمالك) ---------- */
function branchesList() {
  /* ann32: إجمالي دخولات العائلة ظاهر للمالك هنا (يُجلب أصلًا مع الحزمة) */
  showInfo(`<h2>👥 مسؤولو الفروع</h2>${S.accessStats ? `<p class="sub">👥 <b>دخولات العائلة آخر 30 يوم: ${S.accessStats.family ?? 0}</b> (كل شبكة تُحسب مرة كل 30 دقيقة — رقم تقريبي للزيارات لا عدد أشخاص بالضبط)</p>` : ''}
    <p class="sub">لكل فرع مسؤول واحد يضيف ويعدّل داخل فرعه فقط، ولا يحذف ولا يصل لفروع الآخرين. ورمز قراءة خاص بكل فرع يوزّعه المسؤول على أهله — إن تسرّب غيّرته وحده.</p>
    ${S.branches.map(b => { const visits = S.accessStats?.by_branch?.[b.root_id] || 0; return `<div class="evrow"><div><b>${esc(S.byId.get(b.root_id)?.full_name || '؟')}</b><small>المسؤول: ${esc(delegateName(b))} · رمز القراءة: ${b.reader_set ? 'مضبوط ✓' : 'غير مضبوط'} · دخولات الفرع آخر 30 يوم: ${visits}</small></div><span><button class="x" data-brc="${esc(b.root_id)}" aria-label="رمز القراءة" title="رمز قراءة الفرع">🔑</button>${b.reader_set ? `<button class="x" data-brx="${esc(b.root_id)}" aria-label="إلغاء رمز القراءة" title="إلغاء رمز القراءة">🚫</button>` : ''}<button class="x" data-bf="${esc(b.root_id)}" aria-label="تعديل">✏️</button><button class="x" data-bx="${esc(b.root_id)}" aria-label="إلغاء">✕</button></span></div>`; }).join('') || '<p class="sub">لم يُعيَّن أحد بعد.</p>'}
    <div class="row adm"><button data-bf="">➕ تعيين مسؤول لفرع</button></div>`);
}
function readCodeForm(root) {
  openForm(`رمز قراءة فرع «${S.byId.get(root)?.full_name || ''}»`, [
    { k: 'code', label: 'رمز قراءة جديد (6 خانات فأكثر) — للقراءة فقط، يوزّعه المسؤول على أهل الفرع، وتغييره يبطل القديم فورًا', type: 'password', req: true }], async d => {
    await op('secure_set_branch_read_code', { p_root: root, p_code: d.code, p_passcode: S.code }, () => { const b = S.branches.find(x => x.root_id === root); if (b) b.reader_set = true; });
    if (!CFG.DEMO) await refresh(); branchesList();
  });
}
async function clearReadCode(root) {
  if (!confirm('إلغاء رمز قراءة هذا الفرع؟ من يدخل به سيفقد الوصول فورًا.')) return;
  try { await op('secure_set_branch_read_code', { p_root: root, p_code: null, p_passcode: S.code }, () => { const b = S.branches.find(x => x.root_id === root); if (b) b.reader_set = false; }); if (!CFG.DEMO) await refresh(); branchesList(); }
  catch (err) { alert(err.message); }
}
const underRoot = (m, root) => { for (let p = m, i = 0; p && i < 60; p = S.byId.get(p.father_id), i++) if (p.id === root) return true; return false; };
function branchForm(rootId) {
  if (!rootId) {  // الخطوة 1: اختيار رأس الفرع من أسماء الشجرة
    const opts = [['', 'اختر…'], ...S.members.filter(m => (S.kids.get(m.id) || []).length && !S.branches.some(b => b.root_id === m.id)).sort(byName).map(m => [m.id, `${m.full_name} · ${S.kids.get(m.id).length} أبناء`])];
    return openForm('تعيين مسؤول: اختر رأس الفرع', [{ k: 'root', label: 'رأس الفرع (جدّ الأسرة)', type: 'select', opts, val: '' }],
      async d => { if (!d.root) throw new Error('اختر رأس الفرع'); setTimeout(() => branchForm(d.root), 0); });
  }
  // الخطوة 2: اختيار المسؤول من أفراد الفرع نفسه (قائمة، وليس كتابة)
  const cur = S.branches.find(b => b.root_id === rootId);
  const opts = [['', 'اختر…'], ...S.members.filter(m => underRoot(m, rootId)).sort(byName).map(m => [m.id, `${m.full_name} (الجيل ${gen(m)})`])];
  openForm(`مسؤول فرع «${S.byId.get(rootId)?.full_name || ''}»`, [
    { k: 'delegate', label: 'المسؤول (اختره من أفراد الفرع)', type: 'select', opts, val: cur?.delegate_id || '' },
    { k: 'code', label: cur ? 'رمز جديد (فارغ = بلا تغيير، 8 خانات فأكثر)' : 'رمز دخول المسؤول (8 خانات فأكثر)', type: 'password', req: !cur }], async d => {
    if (!d.delegate) throw new Error('اختر المسؤول من القائمة');
    await op('secure_set_branch_editor', { p_branch_root: rootId, p_delegate: d.delegate, p_code: d.code || null, p_passcode: S.code }, () => {
      const name = S.byId.get(d.delegate)?.full_name, b = S.branches.find(x => x.root_id === rootId);
      if (b) Object.assign(b, { delegate_id: d.delegate, label: name }); else S.branches.push({ root_id: rootId, delegate_id: d.delegate, label: name }); });
    if (!CFG.DEMO) await refresh(); branchesList();
  });
}
async function delBranch(root) {
  if (!confirm(`إلغاء تفويض مسؤول فرع «${S.byId.get(root)?.full_name || ''}»؟ سيفقد دخوله فورًا.`)) return;
  try { await op('secure_clear_branch_editor', { p_branch_root: root, p_passcode: S.code }, () => { S.branches = S.branches.filter(b => b.root_id !== root); }); if (!CFG.DEMO) await refresh(); branchesList(); }
  catch (err) { alert(err.message); }
}
$('#profile-body').addEventListener('click', e => {
  const b = e.target.closest('[data-bf],[data-bx],[data-brc],[data-brx]'); if (!b) return;
  if ('bx' in b.dataset) delBranch(b.dataset.bx);
  else if ('brc' in b.dataset) { $('#profile').close(); readCodeForm(b.dataset.brc); }
  else if ('brx' in b.dataset) clearReadCode(b.dataset.brx);
  else { $('#profile').close(); branchForm(b.dataset.bf || null); }
});
$('#m-branches').onclick = () => { $('.more').open = false; branchesList(); };

/* ---------- سجل التغييرات واللقطات (للمالك) ---------- */
const FLD = { full_name: 'الاسم', nickname: 'الكنية', city: 'المدينة', is_alive: 'الحالة', birth_year_text: 'الميلاد', death_year_text: 'الوفاة', achievement_badge: 'الشارة',
  phone: 'الهاتف', biography_story: 'النبذة', father_id: 'الأب', gender: 'الجنس', birth_order: 'الترتيب', family_name: 'اسم العائلة', title: 'العنوان',
  event_date: 'الموعد', location_name: 'المكان', description: 'التفاصيل', husband_id: 'الزوج' };
const ACT = { insert: 'إضافة', update: 'تعديل', delete: 'حذف', set: 'تعيين مسؤول', clear: 'إلغاء مسؤول' };
const TBL = { members: 'فرد', wives: 'زوجة', family_events: 'مناسبة', branch_editors: 'فرع' };
const fmtV = (k, v) => v == null ? '—' : (k === 'father_id' || k === 'husband_id') ? (S.byId.get(v)?.full_name || '؟') : typeof v === 'boolean' ? (v ? 'حي' : 'متوفى') : String(v);
$('#m-log').onclick = async () => {
  $('.more').open = false;
  if (CFG.DEMO) return alert('سجل التغييرات يعمل مع القاعدة الحقيقية فقط.');
  try {
    const r = await rpc('list_changes', { p_passcode: S.code, p_limit: 150 }); if (!r.success) return alert(r.message);
    showInfo(`<h2>📜 سجل التغييرات</h2>${r.items.map(c => {
      const ch = c.action === 'update' ? Object.entries(c.changes || {}).map(([k, v]) => Array.isArray(v) ? `${FLD[k] || k}: ${fmtV(k, v[0])} ← ${fmtV(k, v[1])}` : `${FLD[k] || k}: ${v}`).join('، ') : '';
      return `<div class="evrow"><div><b>${esc(ACT[c.action] || c.action)} ${esc(TBL[c.table] || c.table)}: ${esc(c.label || '')}</b><small>${esc(c.actor)} · ${esc(new Date(c.at).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short' }))}${ch ? '<br>' + esc(ch) : ''}</small></div></div>`;
    }).join('') || '<p class="sub">لا توجد تغييرات مسجّلة بعد.</p>'}`);
  } catch (err) { alert(err.message); }
};
$('#m-snap').onclick = async () => {
  $('.more').open = false;
  if (CFG.DEMO) return alert('اللقطات تعمل مع القاعدة الحقيقية فقط.');
  try {
    const r = await rpc('secure_snapshot', { p_passcode: S.code });
    alert(r.success ? `تم حفظ لقطة رقم ${r.id} داخل القاعدة (تُحفظ آخر 20). وهي لا تغني عن تصدير نسخة JSON وحفظها خارج Supabase.` : r.message);
  } catch (err) { alert(err.message); }
};

/* ---------- بطاقات التهنئة والتعزية: تُنشأ تلقائيًا عند الإضافة/الوفاة، أو يدويًا من القائمة ---------- */
/* ann40: بطاقات المناسبات — نصوص جاهزة لكل مناسبة (مذكر/مؤنث تلقائيًا) */
const CARDS = {
  birth: { celeb: 1, h: '💌 بطاقة تهنئة', nb: '💌 تهنئة', title: 'بُشرى سارّة', sub: f => f ? 'مولودة جديدة' : 'مولود جديد', lines: f => ['بارك الله لكم في الموهوب وشكرتم الواهب', (f ? 'جعلها' : 'جعله') + ' الله من مواليد السعادة وقرة عين لوالديه'] },
  condolence: { celeb: 0, h: '🕊️ بطاقة تعزية', nb: '🕊️ تعزية', title: 'إنا لله وإنا إليه راجعون', sub: f => f ? 'فقيدتنا الغالية' : 'فقيدنا الغالي', lines: f => [f ? 'رحمها الله وغفر لها وأسكنها فسيح جناته' : 'رحمه الله وغفر له وأسكنه فسيح جناته', 'وألهم أهله وذويه الصبر والسلوان'] },
  wedding: { celeb: 1, h: '💍 بطاقة تهنئة بالزواج', nb: '💍 زفاف', title: 'بُشرى سارّة', sub: f => f ? 'عروستنا الغالية' : 'عريسنا الغالي', lines: () => ['بارك الله لهما وبارك عليهما وجمع بينهما في خير', 'جعلها الله زواجًا مباركًا وحياة ملؤها السعادة والذرية الصالحة'] },
  engagement: { celeb: 1, h: '💍 بطاقة تهنئة بالخطبة', nb: '💍 خطبة', title: 'بُشرى سارّة', sub: () => 'خطوبة مباركة', lines: f => ['بقلوب يملؤها الفرح نبارك ' + (f ? 'لها خطوبتها' : 'له خطوبته') + ' المباركة', 'سائلين الله أن يتمم لهما بخير، وأن يجعلها بداية حياة عامرة بالمودة والرحمة'] },
  aqd: { celeb: 1, h: '📜 بطاقة تهنئة بعقد القران', nb: '📜 عقد قران', title: 'بُشرى سارّة', sub: () => 'عقد قران مبارك', lines: f => ['ببالغ السعادة والسرور، نرفع أسمى آيات التهاني والتبريكات بمناسبة عقد ' + (f ? 'قرانها' : 'قرانه') + ' المبارك', f ? 'بارك الله لها وعليها، وجمع بينها وبين أهلها في خير، وجعل أيامها عامرة بالأفراح والمسرات' : 'بارك الله له وعليه، وجمع بينه وبين أهله في خير، وجعل أيامه عامرة بالأفراح والمسرات'] },
  graduation: { celeb: 1, h: '🎓 بطاقة تهنئة بالتخرج', nb: '🎓 تخرج', title: 'بُشرى سارّة', sub: f => f ? 'خريجتنا الغالية' : 'خريجنا الغالي', lines: f => ['بكل فخر واعتزاز نبارك ' + (f ? 'لها تخرجها ونيلها' : 'له تخرجه ونيله') + ' ثمرة ' + (f ? 'جهدها واجتهادها' : 'جهده واجتهاده'), 'سائلين الله أن يجعل ' + (f ? 'علمها' : 'علمه') + ' نافعًا وأن يفتح ' + (f ? 'لها' : 'له') + ' أبواب التوفيق في قابل ' + (f ? 'أيامها' : 'أيامه')] },
  job: { celeb: 1, h: '💼 بطاقة تهنئة بالوظيفة', nb: '💼 وظيفة', title: 'بُشرى سارّة', sub: () => 'وظيفة جديدة', lines: f => ['أسمى التهاني وأصدق التبريكات بمناسبة ' + (f ? 'تعيينها في وظيفتها' : 'تعيينه في وظيفته') + ' الجديدة', 'سائلين الله أن يجعلها بداية خير وبركة، وأن ' + (f ? 'يوفقها' : 'يوفقه') + ' لما فيه رفعة ونجاح'] },
  promotion: { celeb: 1, h: '⭐ بطاقة تهنئة بالترقية', nb: '⭐ ترقية', title: 'بُشرى سارّة', sub: () => 'ترقية مستحقة', lines: f => ['نبارك ' + (f ? 'لها ترقيتها' : 'له ترقيته') + ' المستحقة، ثمرة ' + (f ? 'إخلاصها وتميزها' : 'إخلاصه وتميزه'), 'وإلى مزيد من التقدم والرفعة بإذن الله'] },
  success: { celeb: 1, h: '🏆 بطاقة تهنئة بالنجاح', nb: '🏆 نجاح', title: 'بُشرى سارّة', sub: () => 'نجاح وتفوق', lines: f => ['بكل سرور نبارك ' + (f ? 'لها نجاحها وتفوقها' : 'له نجاحه وتفوقه') + ' الباهر', 'جعلها الله بداية لمسيرة حافلة بالإنجاز والتميز'] },
  recovery: { celeb: 1, h: '🌿 بطاقة سلامة', nb: '🌿 سلامة', title: 'حمدًا لله على السلامة', sub: () => 'سلامة وعافية', lines: f => ['نحمد الله على ' + (f ? 'سلامتها وتمام عافيتها' : 'سلامته وتمام عافيته'), (f ? 'حفظها الله ورعاها' : 'حفظه الله ورعاه') + '، وأدام ' + (f ? 'عليها' : 'عليه') + ' نعمة الصحة والعافية'] },
  newhome: { celeb: 1, h: '🏡 بطاقة تهنئة بالمنزل الجديد', nb: '🏡 منزل جديد', title: 'بُشرى سارّة', sub: () => 'منزل جديد', lines: f => ['نبارك ' + (f ? 'لها منزلها' : 'له منزله') + ' الجديد، جعله الله منزل خير وبركة', 'عامرًا بالأفراح والمسرات، وملتقى للأحبة على طاعة الله'] },
  thanks: { celeb: 1, h: '🙏 بطاقة شكر', nb: '🙏 شكر', title: 'شكر وعرفان', sub: () => 'كلمة شكر وتقدير', phoneLabel: 'للتواصل مع صاحب المناسبة', lines: () => ['من القلب: شكرًا لكل من شاركنا فرحتنا وحضر وهنّأ وبارك ودعا لنا بخير', 'حضوركم أبهج قلوبنا وزاد مناسبتنا نورًا — أدام الله عليكم الأفراح وجمعنا بكم على الخير دائمًا'] }
};
async function drawCard(data, kind) {
  const C = CARDS[kind] || CARDS.birth, celeb = !!C.celeb, gram = data.gender === 'female';
  const cv = document.createElement('canvas'); cv.width = cv.height = 1080;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1080);
  g.addColorStop(0, celeb ? '#162033' : '#111827'); g.addColorStop(1, celeb ? '#0b1120' : '#030712');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1080);
  const accent = celeb ? '#f59e0b' : '#9ca3af';
  x.strokeStyle = accent; x.lineWidth = 6; x.strokeRect(36, 36, 1008, 1008);
  x.lineWidth = 2; x.strokeRect(56, 56, 968, 968);
  x.textAlign = 'center';
  try { await document.fonts.ready; } catch (_) {}
  const F = (s, w = 800) => `${w} ${s}px Cairo, Tahoma, sans-serif`;
  const fit = (t, s) => { x.font = F(s); while (x.measureText(t).width > 920 && s > 28) { s -= 4; x.font = F(s); } };
  await new Promise(res => { const im = new Image(); im.onload = () => { try { x.save(); x.beginPath(); x.arc(540, 205, 92, 0, Math.PI * 2); x.clip(); x.drawImage(im, 448, 113, 184, 184); x.restore(); x.strokeStyle = accent; x.lineWidth = 3; x.beginPath(); x.arc(540, 205, 92, 0, Math.PI * 2); x.stroke(); } catch (_) {} res(); }; im.onerror = () => res(); im.src = 'logo.jpg'; });
  x.fillStyle = accent; x.font = F(46); x.fillText('أسرة آل مطارد - بنو عمرو', 540, 395);
  x.fillStyle = '#f1f5f9';
  const title = C.title;
  fit(title, celeb ? 88 : 64); x.fillText(title, 540, 505);
  x.fillStyle = accent; x.font = F(38, 600);
  x.fillText(C.sub(gram), 540, 580);
  x.fillStyle = '#f1f5f9'; fit(data.full_name, 68); x.fillText(data.full_name, 540, 665);
  x.strokeStyle = accent; x.lineWidth = 3; x.beginPath(); x.moveTo(390, 715); x.lineTo(690, 715); x.stroke();
  x.fillStyle = '#cbd5e1'; x.font = F(40, 600);
  const fitL = t => { let sz = 40; x.font = F(sz, 600); while (x.measureText(t).width > 940 && sz > 22) { sz -= 2; x.font = F(sz, 600); } };
  if (kind === 'thanks' && data.body) { /* ann47: نص الشكر الحر — يُلفّ حتى 3 أسطر */
    const words = String(data.body).split(/\s+/); const wrapped = []; let cur = '';
    x.font = F(38, 600);
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > 920 && cur) { wrapped.push(cur); cur = w; } else cur = t; }
    if (cur) wrapped.push(cur);
    wrapped.slice(0, 3).forEach((ln, i) => { fitL(ln); x.fillText(ln, 540, 785 + i * 62); });
  } else {
    const lines = C.lines(gram);
    fitL(lines[0]); x.fillText(lines[0], 540, 790); fitL(lines[1]); x.fillText(lines[1], 540, 855);
  }
  x.fillStyle = '#94a3b8'; x.font = F(32, 400);
  x.fillText(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'full' }).format(new Date()), 540, 965);
  return cv;
}
async function openCard(data, kind, waitClose = false) {
  try {
    const cv = await drawCard(data, kind), url = cv.toDataURL('image/png');
    const C = CARDS[kind] || CARDS.birth;
    let phoneHtml = '';
    if (data.phone) {
      const dg = String(data.phone).replace(/\D/g, '');
      const wa = dg.startsWith('966') ? dg : dg.startsWith('0') ? '966' + dg.slice(1) : dg.length === 9 ? '966' + dg : dg;
      phoneHtml = `<p class="sub" style="text-align:center">📱 ${C.phoneLabel || 'للتهنئة'}: <bdo dir="ltr">${esc(data.phone)}</bdo></p><div class="row adm"><button id="card-wa">💬 تهنئة واتساب</button><button id="card-call">📞 اتصال</button></div>`;
      setTimeout(() => { const w = $('#card-wa'), c2 = $('#card-call'); if (w) w.onclick = () => window.open('https://wa.me/' + wa, '_blank'); if (c2) c2.onclick = () => location.href = 'tel:+' + wa; }, 0);
    }
    showInfo(`<h2>${C.h}</h2><img class="cardimg" src="${url}" alt="البطاقة">${phoneHtml}<div class="row adm"><button id="card-dl">⬇️ تنزيل البطاقة</button></div>`);
    $('#card-dl').onclick = () => { const a = Object.assign(document.createElement('a'), { href: url, download: 'al-matarid-card.png' }); a.click(); };
    if (waitClose) await new Promise(r => { const p = $('#profile'); if (!p.open) return r(); p.addEventListener('close', r, { once: true }); setTimeout(r, 20000); });
  } catch (e) { toast('تعذر إنشاء البطاقة تلقائيًا — تقدر تنشئها من قائمة «بطاقات التهاني والتعازي»'); }
}
/* ann31: نشر إعلان عام بنص حر (مالك/محرر) */
$('#m-annpost').onclick = menuClose(() => {
  openForm('نشر إعلان عام للزوار', [
    { k: 'title', label: 'عنوان الإعلان', req: 1 },
    { k: 'text', label: 'نص الإعلان', type: 'area', req: 1 }], async d => {
    if (CFG.DEMO) { toast('الوضع التجريبي: لن يُنشر فعليًا'); return; }
    try {
      const r = await rpc('secure_post_announcement', { p_passcode: S.code, p_kind: 'general', p_member_id: null, p_member_name: d.title.trim(), p_gender: 'male', p_body: d.text.trim() });
      if (!r || !r.ok) throw new Error();
      toast('تم نشر الإعلان'); checkAnnouncements(false);
    } catch (_) { toast('تعذر النشر — تأكد أنك شغّلت القسم 11 من ملف الإعداد'); }
  });
});
$('#m-cards').onclick = menuClose(() => {
  if (!['owner', 'editor', 'branch'].includes(S.role)) { toast('صفحة البطاقات للمالك والمحرر ومسؤولي الفروع فقط'); return; } /* ann44 */
  openForm('إنشاء بطاقة', [
    { k: 'who', label: 'الاسم', type: 'select', opts: S.members.slice().sort(byName).map(m => [m.id, m.full_name]) },
    { k: 'kind', label: 'نوع البطاقة', type: 'select', opts: [['birth', 'تهنئة بمولود'], ['engagement', 'تهنئة بخطبة'], ['aqd', 'تهنئة بعقد قران (ملكة)'], ['wedding', 'تهنئة بزواج'], ['graduation', 'تهنئة بتخرج'], ['job', 'تهنئة بوظيفة'], ['promotion', 'تهنئة بترقية'], ['success', 'تهنئة بنجاح وتفوق'], ['recovery', 'بطاقة سلامة وشفاء'], ['newhome', 'تهنئة بمنزل جديد'], ['condolence', 'تعزية بوفاة'], ['thanks', 'بطاقة شكر 🙏']] },
    { k: 'txt', label: 'نص شكر خاص (اختياري — لبطاقة الشكر فقط؛ اتركه فارغًا ويظهر النص الثابت)', type: 'area' }], d => {
    const mm = S.byId.get(d.who); if (mm) { const ln = cardLongName(mm); const tb = d.kind === 'thanks' ? (d.txt || '').trim() : ''; openCard({ full_name: ln, gender: mm.gender, father_id: mm.father_id, phone: mm.phone, body: tb || undefined }, d.kind); postAnnouncement(d.kind, { ...mm, full_name: ln, body: tb || null }); }
  });
});

/* ---------- إعلانات البطاقات: منبثقة أول مرة لكل زائر، ثم شريط علوي دوّار حتى تنتهي مدتها (7 أيام) ---------- */
const ANN_KEY = 'alm_seen_ann';
const seenAnn = () => { try { return JSON.parse(localStorage.getItem(ANN_KEY) || '[]'); } catch (_) { return []; } };
function markSeenAnn(id) { if (!id) return; const s = seenAnn(); if (!s.includes(id)) { s.push(id); try { localStorage.setItem(ANN_KEY, JSON.stringify(s.slice(-60))); } catch (_) {} } }
async function postAnnouncement(kind, member) {
  if (CFG.DEMO || !member) return; /* ann31: أنواع جديدة wedding/general عبر member.body */
  if (!canEdit()) { toast('البطاقة ظهرت لك فقط — نشرها للزوار يحتاج دخول المالك أو المحرر'); return; }
  try { const r = await rpc('secure_post_announcement', { p_passcode: S.code, p_kind: kind, p_member_id: member.id ?? null, p_member_name: member.full_name || '', p_gender: member.gender || 'male', p_body: member.body || null }); if (r && r.ok) { markSeenAnn(r.id); checkAnnouncements(false); } else toast('تعذر نشر البطاقة للزوار'); } catch (_) { toast('تعذر نشر البطاقة للزوار'); }
}
async function checkAnnouncements(popups = true) {
  if (CFG.DEMO || !S.code) return;
  let items = [];
  try { const r = await rpc('get_announcements', { p_code: S.code }); if (!r.ok) return; items = r.items || []; } catch (_) { return; }
  S.ann = items; renderNewsbar();
  if (!popups) return;
  const seen = seenAnn();
  for (const a of items.filter(z => !seen.includes(z.id))) { markSeenAnn(a.id); if (a.kind === 'general') { showInfo(`<h2>📢 ${esc(a.member_name)}</h2><div class="story">${esc(a.body || '').replace(/\n/g, '<br>')}</div>`); await new Promise(r => { const p = $('#profile'); if (!p.open) return r(); p.addEventListener('close', r, { once: true }); setTimeout(r, 20000); }); } else await openCard({ full_name: a.member_name, gender: a.gender, phone: a.phone }, a.kind, true); }
}
let nbTimer = null;
function stopNbCycle() { if (nbTimer) { clearInterval(nbTimer); nbTimer = null; } }
function startNbCycle(n) { stopNbCycle(); if (n < 2) return; let i = 0; nbTimer = setInterval(() => { const cs = document.querySelectorAll('#newsbar .nbcard'); if (cs.length < 2) return stopNbCycle(); cs[i % cs.length].classList.remove('on'); i++; cs[i % cs.length].classList.add('on'); }, 5000); }
async function renderNewsbar() {
  const bar = $('#newsbar'); if (!bar) return;
  const items = S.ann || [];
  if (!items.length) { bar.hidden = true; bar.innerHTML = ''; stopNbCycle(); return; }
  bar.hidden = false;
  bar.onpointerenter = () => stopNbCycle(); bar.onpointerleave = () => startNbCycle(items.length); /* ann43: إيقاف الحركة عند التمرير/اللمس */
  bar.innerHTML = items.map((a, i) => `<button class="nbcard${i === 0 ? ' on' : ''}" data-ann="${a.id}"><img alt=""><span>${a.kind === 'general' ? '📢 إعلان' : (CARDS[a.kind] ? CARDS[a.kind].nb : '🕊️ تعزية')}: ${esc(a.member_name)}</span>${canEdit() ? `<span class="nbdel" data-andel="${a.id}" role="button" aria-label="حذف الإعلان" title="حذف الإعلان">✕</span>` : ''}</button>`).join('');
  for (const a of items) {
    const img = bar.querySelector(`[data-ann="${a.id}"] img`);
    if (a.kind === 'general') { img.style.display = 'none'; continue; }
    try { img.src = (await drawCard({ full_name: a.member_name, gender: a.gender }, a.kind)).toDataURL('image/png'); } catch (_) {}
  }
  bar.querySelectorAll('[data-ann]').forEach(b => b.onclick = () => { const a = items.find(z => z.id === b.dataset.ann); if (!a) return; markSeenAnn(a.id); if (a.kind === 'general') showInfo(`<h2>📢 ${esc(a.member_name)}</h2><div class="story">${esc(a.body || '').replace(/\n/g, '<br>')}</div>`); else openCard({ full_name: a.member_name, gender: a.gender, phone: a.phone, body: a.body || undefined }, a.kind); });
  bar.querySelectorAll('[data-andel]').forEach(x => x.onclick = async e => {
    e.stopPropagation();
    if (!confirm('حذف هذا الإعلان نهائيًا؟')) return;
    const id = x.dataset.andel;
    try {
      if (!CFG.DEMO) { const r = await rpc('secure_delete_announcement', { p_passcode: S.code, p_id: id }); if (!r || !r.ok) throw new Error('delete failed'); }
      S.ann = (S.ann || []).filter(z => z.id !== id); renderNewsbar(); toast('تم حذف الإعلان');
    } catch (_) { toast('تعذر حذف الإعلان'); }
  });
  startNbCycle(items.length);
}

/* ---------- صور الأعضاء: ضغط بالمتصفح (~20KB)، تُجلب كسولًا بعد التحميل، وتحديث تلقائي ---------- */
async function fetchPhotos() {
  if (CFG.DEMO || !S.code || !S.members.length) return;
  try {
    const r = await rpc('get_photos', { p_code: S.code, p_ids: S.members.map(m => m.id) });
    if (!r.ok) return;
    const before = S.photos.size;
    S.photos = new Map((r.items || []).map(x => [x.member_id, x.photo]));
    if (S.photos.size !== before) render();
  } catch (_) {}
}
function compressPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let w = img.width, h = img.height; const k = Math.min(1, 360 / Math.max(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.82, out = cv.toDataURL('image/jpeg', q);
      while (out.length > 28000 && q > 0.4) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
      res(out);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
$('#ev-file').addEventListener('change', async e => {
  const file = e.target.files[0], eid = e.target.dataset.eid; e.target.value = '';
  if (!file || !eid) return;
  const ev = S.events.find(x => String(x.id) === String(eid)); if (!ev) return;
  try {
    const data = await compressEventPhoto(file);
    const cap = prompt('تعليق على الصورة (اختياري):') || '';
    if (CFG.DEMO) (ev._media = ev._media || []).push({ id: 'p' + Date.now(), kind: 'photo', url: data, caption: cap.trim() || null });
    else { const pc = canEdit() ? S.code : evDocCodes.get(String(eid)); const r = await rpc('secure_add_event_media', { p_passcode: pc, p_event_id: eid, p_kind: 'photo', p_url: data, p_caption: cap.trim() }); if (!r.ok) throw new Error(); ev.media_count = (ev.media_count || 0) + 1; }
    toast('تمت إضافة الصورة'); if ($('#evdoc')) loadEvDoc(ev, true);
  } catch (_) { toast('تعذر رفع الصورة'); }
});
$('#photo-file').addEventListener('change', async e => {
  const file = e.target.files[0], mid = e.target.dataset.mid; e.target.value = '';
  if (!file || !mid) return;
  try {
    const data = await compressPhoto(file);
    if (CFG.DEMO) { S.photos.set(mid, data); }
    else {
      const r = await rpc('secure_set_photo', { p_passcode: S.code, p_member_id: mid, p_photo: data });
      if (!r.ok) throw new Error(r.error || 'failed');
      S.photos.set(mid, data);
    }
    toast('تم حفظ الصورة'); profile(mid); render();
  } catch (_) { toast('تعذر حفظ الصورة'); }
});
async function silentRefresh() {
  if (CFG.DEMO || !S.code || document.hidden || document.querySelector('dialog[open]')) return;
  try {
    const b = await rpc('get_bundle', { p_code: S.code });
    if (!b.ok) return;
    S.members = b.members; S.wives = b.wives; S.events = b.events || []; S.role = b.role; S.branches = b.branches || []; S.branch = b.branch || null;
    S.womenVisible = b.women_names_visible !== false; S.accessStats = b.access_stats || null;
    if (Array.isArray(b.featured_sections)) S.featured = b.featured_sections;
    index(); render(); showEvent(); applyRole(); renderFeat(); inboxBadge();
    checkAnnouncements(true);
    fetchPhotos();
  } catch (_) {}
}

/* ---------- محرر العائلة: زوجات وأبناء الأب في شاشة واحدة، لصق جماعي، حفظ واحد ---------- */
async function saveMemberData(m, over) {
  const v = { full_name: m.full_name, nickname: m.nickname, gender: m.gender, is_alive: m.is_alive !== false, birth_year_text: m.birth_year_text, death_year_text: m.death_year_text, city: m.city, achievement_badge: m.achievement_badge, phone: m.phone, birth_order: m.birth_order, wife_mother_id: m.wife_mother_id, biography_story: m.biography_story || m.bio, name_public: !!m.name_public, name_hidden: !!m.name_hidden, ...over };
  const r = await op('secure_save_member', { p_id: m.id, p_full_name: v.full_name, p_nickname: v.nickname, p_gender: v.gender, p_father_id: m.father_id, p_wife_mother_id: v.wife_mother_id, p_birth_order: v.birth_order, p_phone: v.phone, p_is_alive: v.is_alive, p_birth_year_text: v.birth_year_text, p_death_year_text: v.death_year_text, p_biography_story: v.biography_story, p_passcode: S.code }, () => Object.assign(m, v));
  await op('secure_update_member_extras', { p_id: m.id, p_city: v.city, p_achievement_badge: v.achievement_badge, p_audio_url: m.audio_url || null, p_name_public: v.name_public, p_name_hidden: v.name_hidden, p_passcode: S.code }, () => {});
  return r;
}
function familyEditor(fid) {
  if (!fid) {
    const opts = [['', 'اختر…'], ...S.members.filter(m => m.gender !== 'female').sort(byName).map(m => [m.id, m.full_name])];
    return openForm('محرر العائلة: اختر الأب', [{ k: 'f', label: 'الأب', type: 'select', opts }], d => { if (!d.f) throw new Error('اختر الأب'); setTimeout(() => familyEditor(d.f), 0); });
  }
  const f = S.byId.get(fid); if (!f) return;
  const wives = S.wives.filter(w => w.husband_id === fid), kids = (S.kids.get(fid) || []);
  showInfo(`<h2>👨‍👩‍👧 عائلة ${esc(f.full_name)}</h2>
   <h3>الزوجات</h3>
   ${wives.map(w => `<div class="evrow"><div><b>${esc(w.full_name)}</b>${w.member_id ? '<small>مرتبطة بسجلها في الشجرة</small>' : ''}</div></div>`).join('') || '<p class="sub">لا زوجات مسجلات — أضف من ملف الأب.</p>'}
   <h3>الأبناء (${kids.length}) — عدّل الاسم أو الجنس في مكانه</h3>
   ${kids.map(k => `<div class="frow"><input data-kn="${k.id}" value="${esc(k.full_name)}"><select data-kg="${k.id}"><option value="male"${k.gender !== 'female' ? ' selected' : ''}>ذكر</option><option value="female"${k.gender === 'female' ? ' selected' : ''}>أنثى</option></select></div>`).join('') || '<p class="sub">لا أبناء بعد.</p>'}
   <h3>إضافة أبناء دفعة واحدة</h3>
   <p class="sub">اسم في كل سطر، وتُضاف كلها عند الحفظ. للبنات اختم السطر بكلمة «بنت».</p>
   <textarea id="fe-new" rows="4" placeholder="اسم الابن الأول&#10;اسم الابنة الثانية بنت"></textarea>
   <div class="frow"><label>أم المضافين</label><select id="fe-mom"><option value="">—</option>${wives.map(w => `<option value="${w.id}">${esc(w.full_name)}</option>`).join('')}</select></div>
   <div class="row adm"><button id="fe-save">💾 حفظ الكل</button></div>
   <p class="sub" id="fe-msg"></p>`);
  $('#fe-save').onclick = async () => {
    const msg = $('#fe-msg'); msg.textContent = 'جارٍ الحفظ…';
    let done = 0, fail = 0;
    for (const inp of document.querySelectorAll('[data-kn]')) {
      const k = S.byId.get(inp.dataset.kn); if (!k) continue;
      const name = inp.value.trim(), g = document.querySelector(`[data-kg="${k.id}"]`).value;
      if (!name || (name === k.full_name && g === k.gender)) continue;
      try { await saveMemberData(k, { full_name: name, gender: g }); done++; } catch (_) { fail++; }
    }
    const mom = $('#fe-mom').value || null;
    let order = kids.length;
    for (const raw of $('#fe-new').value.split('\n')) {
      let name = raw.trim(); if (!name) continue;
      let gender = 'male';
      if (/\s(بنت|أنثى)$/.test(name)) { gender = 'female'; name = name.replace(/\s(بنت|أنثى)$/, '').trim(); }
      try { await op('secure_save_member', { p_id: null, p_full_name: name, p_nickname: null, p_gender: gender, p_father_id: fid, p_wife_mother_id: mom, p_birth_order: ++order, p_phone: null, p_is_alive: true, p_birth_year_text: null, p_death_year_text: null, p_biography_story: null, p_passcode: S.code }, () => {}); done++; } catch (_) { fail++; }
    }
    msg.textContent = `تم حفظ ${done} تغيير${fail ? ` — وتعذّر ${fail} (راجعها من ملف كل فرد)` : ''}.`;
    if (!CFG.DEMO) await refresh(); else render();
  };
}
$('#m-family').onclick = menuClose(() => familyEditor(null));

/* ---------- البداية ---------- */
(async () => {
  try {
    if (CFG.DEMO) { $('#demo').hidden = false; await load(); return; }
    if (!(await load(sessionStorage.getItem('code')))) { sessionStorage.removeItem('code'); $('#chips').textContent = 'الشجرة محمية برمز العائلة'; showGate(S.locked ? 'محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم حاول من جديد.' : ''); }
  } catch { $('#chips').textContent = 'تعذر الاتصال بالخادم'; }
})();


/* ---------- الأقسام المُبرزة بالشريط العلوي (ann25) ---------- */
/* المالك والمحرر يفعّلان ⭐ من قائمة الأقسام نفسها، فتظهر كأزرار بارزة أعلى الصفحة لكل الزوار */
const FEAT = [
  ['cities', '📍 المدن والمحافظات', '#m-cities'], ['names', '📋 جميع الأسماء', '#m-names'],
  ['events', '🎉 مناسبات الأسرة', '#m-events'], ['honor', '🏅 لوحة الشرف', '#m-honor'],
  ['cards', '💌 بطاقات التهاني والتعازي', '#m-cards'], ['kin', '🧭 مستكشف القرابة', '#m-kin'],
  ['suggest', '📝 اقتراح وتصحيح', '#m-suggest'], ['csv', '📊 تصدير إكسل', '#m-csv']
];
function renderFeat() {
  const nav = $('#feat');
  if (nav) {
    const list = FEAT.filter(([k]) => (S.featured || []).includes(k) && (k !== 'cards' || ['owner', 'editor', 'branch'].includes(S.role))); /* ann44 */
    nav.hidden = !list.length;
    nav.innerHTML = list.map(([k, label, sel]) => `<button type="button" class="feat-btn" data-feat-go="${k}">${label}</button>`).join('');
    nav.querySelectorAll('[data-feat-go]').forEach(b => b.onclick = () => { const t = $(FEAT.find(([k]) => k === b.dataset.featGo)[2]); if (t) t.click(); });
  }
  document.querySelectorAll('.feat-tg').forEach(s => {
    const on = (S.featured || []).includes(s.dataset.featTg);
    s.textContent = on ? '⭐' : '☆'; s.classList.toggle('on', on);
    s.title = on ? 'مُبرز بالصفحة — اضغط للإخفاء' : 'إبراز بالصفحة';
  });
}
async function toggleFeat(key) {
  const cur = new Set(S.featured || []);
  cur.has(key) ? cur.delete(key) : cur.add(key);
  S.featured = FEAT.map(([k]) => k).filter(k => cur.has(k));
  renderFeat();
  try {
    await op('secure_set_featured_sections', { p_passcode: S.code, p_sections: S.featured }, () => {});
    toast('تم حفظ الأقسام المُبرزة');
  } catch (_) { toast('تعذر الحفظ — شغّل قسم 10 في SQL أولًا إن لم تفعل'); }
}
function initFeatToggles() {
  if (!canEdit()) return;
  FEAT.forEach(([key, , sel]) => {
    const btn = $(sel); if (!btn || btn.querySelector('.feat-tg')) return;
    const s = document.createElement('span');
    s.className = 'feat-tg'; s.dataset.featTg = key; s.textContent = '☆'; s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'إبراز بالصفحة');
    s.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggleFeat(key); });
    btn.appendChild(s);
  });
  renderFeat();
}
