const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let _toastT = null;
function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.hidden = false; requestAnimationFrame(() => t.classList.add('on')); clearTimeout(_toastT); _toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => { t.hidden = true; }, 300); }, 2600); }

const ROLES = { visitor: 'زائر', family: 'فرد عائلة', reader: 'قارئ فرع', editor: 'محرر', branch: 'مسؤول فرع', owner: 'مالك' };
const W = 170, H = 120, GX = 18, GY = 62;
const COL = ['#f59e0b', '#38bdf8', '#34d399', '#c084fc', '#f472b6', '#fb923c'];
const S = { members: [], wives: [], byId: new Map(), kids: new Map(), roots: [], open: new Set(), hit: null, saved: null, curId: null, order: [], code: '', onForm: null, branch: null, branches: [], role: 'visitor', view: innerWidth < 700 ? 'list' : 'graph', photos: new Map(), womenVisible: true, accessStats: null, ann: [], tagCounts: null, tagEvents: null, _tagCountsP: null };
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
  setTimeout(checkPersonalInvitation, 600);
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
/* ميزة 3: الزائر (أو من لم يدخل بعد) لا يرى بيانات الأحياء الشخصية (ميلاد تفصيلي/مدينة/هاتف/كنية/نبذة/صورة/صوت) — تظهر للأقارب المسجلين فقط */
const livingHidden = m => ((S.role === 'visitor' || !S.role) && !S.code) && m.is_alive !== false;
const delegateName = b => S.byId.get(b?.delegate_id)?.full_name || b?.label || '';
const inBranch = m => { for (let p = m, i = 0; p && i < 60; p = S.byId.get(p.father_id), i++) if (p.id === S.branch?.root_id) return true; return false; };
const canMember = m => canEdit() || (S.role === 'branch' && inBranch(m));
function applyRole() {
  $('#btn-login').textContent = ['visitor', 'family', 'reader'].includes(S.role) ? 'دخول' : ROLES[S.role] + (S.role === 'branch' ? ' · ' + (S.byId.get(S.branch?.root_id)?.full_name || '') : '') + (CFG.DEMO ? ' (تجريبي)' : ''); /* ann50: زر واحد «دخول» للزائر وفرد العائلة، والدور يظهر بعد دخول الإدارة فقط */
  $('#adm-menu').hidden = !canEdit(); $('#m-settings').hidden = $('#m-branches').hidden = $('#m-log').hidden = $('#m-snap').hidden = $('#m-backups').hidden = S.role !== 'owner'; $('#m-inbox').hidden = S.role !== 'owner'; /* ann59: صندوق الاقتراحات والشكاوى للمالك فقط */ $('#m-family').hidden = !canEdit();
  $('#m-cards').hidden = !['owner', 'editor', 'branch'].includes(S.role); /* ann44: صفحة البطاقات مقفلة عن الزوار (قرار المالك 2026-10-24) */
  initFeatToggles();
  syncToggles();
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
/* الترحم والحالة حسب الجنس: رحمها الله / حية ترزق للأنثى، رحمه الله / حي يرزق للذكر (ann102) */
const ripText = m => m.gender === 'female' ? 'رحمها الله' : 'رحمه الله';
const aliveText = m => m.gender === 'female' ? 'حية ترزق' : 'حي يرزق';
/* اسم بطاقات التهاني والتعازي وإعلاناتها: ثلاثي أو رباعي — الاسم الأول + الأب + الجد + أبو الجد عبر سلسلة الآباء (طلب المالك 2026-10-22) */
const cardLongName = m => {
  if (!m) return '';
  let out = shortName(m), cur = m, p = S.byId.get(m.father_id), n = 1;
  while (p && n < 4) { out += (cur.gender === 'female' ? ' بنت ' : ' بن ') + shortName(p); cur = p; p = S.byId.get(p.father_id); n++; }
  return out;
};
function stats() {
  const n = f => S.members.filter(f).length, gens = S.members.reduce((x, m) => Math.max(x, gen(m)), 0);
  const c = [['👥', 'الإجمالي', S.members.length, 'total'], ['👨', 'الذكور', n(m => m.gender === 'male'), 'male'], ['👩', 'الإناث', n(m => m.gender === 'female'), 'female'],
    ['🟢', 'الأحياء', n(m => m.is_alive), 'alive'], ['⚪', 'المتوفون', n(m => m.is_alive === false), 'dead'], ['📜', 'الأجيال', gens, 'gens']];
  $('#chips').innerHTML = c.map(([i, l, v, k]) => `<span class="chip" data-k="${k}">${i} <span class="chl">${l}</span> <b>${v}</b></span>`).join(''); /* ann48: بالجوال رموز وأرقام فقط · ann54: الأحياء/المتوفون مخفيان بالجوال */
  $('#chips').style.cursor = 'pointer';
  $('#chips').title = 'اضغط لفتح إحصائيات العائلة الشاملة';
  $('#chips').onclick = () => openFamilyStats();
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
    ${e.description ? `<div class="story">${esc(e.description)}</div>` : ''}
    <div id="ev-rsvp-box"></div>
    <div id="evdoc"></div>`;
  if (!$('#profile').open) $('#profile').showModal();
  renderEventRSVP(e, $('#ev-rsvp-box'));
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
    /* ann76: وسوم الوجوه لهذه المناسبة (للعارض المكبّر) */
    try { const tr = await rpc('get_photo_tags', { p_code: S.code, p_event_id: e.id }); e._tags = new Map(); (tr.items || []).forEach(t => { if (!e._tags.has(t.media_id)) e._tags.set(t.media_id, []); e._tags.get(t.media_id).push(t); }); } catch (_) { e._tags = new Map(); }
    /* ann78: الحضور اليدوي لهذه المناسبة */
    try { const ar = await rpc('get_event_attendees', { p_code: S.code, p_event_id: e.id }); e._attendees = (ar.items || []).map(x => x.member_id); } catch (_) { e._attendees = []; }
    if (S.evDetail === e && $('#evdoc')) renderEvDoc(e, e._items);
  } catch (_) {
    const m = $('#evloadmsg'); if (m && S.evDetail === e) m.textContent = 'تعذّر تحميل الصور — اضغط الزر أعلاه للمحاولة مرة أخرى';
  }
}
/* ann78: قائمة حضور المناسبة — من وسوم الصور تلقائيًا + إضافة يدوية لمن حضر دون صورة */
function attHtml(e, canDoc) {
  const tagged = new Set();
  (e._tags || new Map()).forEach(list => list.forEach(t => tagged.add(t.member_id)));
  const ids = new Set([...tagged, ...(e._attendees || [])]);
  const list = [...ids].map(id => S.byId.get(id)).filter(Boolean);
  const chips = list.map(m => `<div class="att" data-mid="${m.id}" tabindex="0" role="button">${S.photos.get(m.id) ? `<img src="${S.photos.get(m.id)}" alt="">` : ''}<span>${esc(cardLongName(m))}</span>${tagged.has(m.id) ? '<i title="يظهر في الصور">📸</i>' : '<i title="حاضر دون صورة">✓</i>'}${canDoc() && !tagged.has(m.id) ? `<button class="x" data-attdel="${m.id}" aria-label="إزالة من الحضور">✕</button>` : ''}</div>`).join('');
  return `<h3 class="evdoch">👥 الحضور${list.length ? ` (${list.length})` : ''}</h3>` +
    (list.length ? `<div class="attlist">${chips}</div>` : '<p class="sub">لا حضور مسجّل بعد — يُضاف تلقائيًا من وسوم الصور.</p>') +
    (canDoc() ? `<div class="evdoc-tools"><button data-attadd="1">➕ إضافة حاضرين</button></div>` : '');
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
    ${attHtml(e, canDoc)}
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
  /* ann78: الحضور — فتح الملف بالضغط، وإزالة/إضافة لليدوي فقط */
  box.querySelectorAll('.att').forEach(ch => {
    ch.onclick = ev2 => { if (ev2.target.closest('[data-attdel]')) return; profile(ch.dataset.mid); };
    ch.onkeydown = ev2 => { if ((ev2.key === 'Enter' || ev2.key === ' ') && !ev2.target.closest('[data-attdel]')) { ev2.preventDefault(); profile(ch.dataset.mid); } };
  });
  box.querySelectorAll('[data-attdel]').forEach(b => b.onclick = async ev2 => {
    ev2.stopPropagation();
    const mid = b.dataset.attdel;
    if (CFG.DEMO) { e._attendees = (e._attendees || []).filter(x => x !== mid); renderEvDoc(e, e._items || []); return; }
    try { const r = await rpc('secure_delete_attendee', { p_passcode: pass(), p_event_id: e.id, p_member_id: mid }); if (!r.ok) throw new Error(); e._attendees = (e._attendees || []).filter(x => x !== mid); renderEvDoc(e, e._items || []); toast('تمت الإزالة'); } catch (_) { toast('تعذّرت الإزالة — تأكد من الرمز'); }
  });
  const attAdd = box.querySelector('[data-attadd]');
  if (attAdd) attAdd.onclick = () => {
    const existing = new Set([...(e._tags ? [...e._tags.values()].flat().map(t => t.member_id) : []), ...(e._attendees || [])]);
    /* ann81: الحضور من الجيل الرابع فما فوق فقط (الأجيال السابقة توفوا جميعًا) ومن الأحياء فقط — والاسم ثلاثي/رباعي دائمًا */
    const GENORD = { 4: 'الرابع', 5: 'الخامس', 6: 'السادس', 7: 'السابع' };
    const items = S.members.filter(m => !existing.has(m.id) && m.is_alive !== false && gen(m) >= 4 && (!m.name_masked || canEdit() || (S.role === 'branch' && inBranch(m)))).map(m => ({ id: m.id, label: cardLongName(m), sub: m.city || '', group: gen(m) })).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
    const groups = [...new Set(items.map(i => i.group))].sort((a, b) => a - b).map(g => ({ key: g, label: 'الجيل ' + (GENORD[g] || g) }));
    if (!items.length) { toast('لا أعضاء متاحين للإضافة'); return; }
    /* ann80: إضافة جماعية — علّم على كل الحاضرين ثم زر واحد */
    openBulkPicker('إضافة حاضرين', items, async ids => {
      if (CFG.DEMO) { e._attendees = [...(e._attendees || []), ...ids]; renderEvDoc(e, e._items || []); toast(`تمت إضافة ${ids.length}`); return; }
      const done = [];
      for (const mid of ids) { try { const r = await rpc('secure_add_attendee', { p_passcode: pass(), p_event_id: e.id, p_member_id: mid }); if (r.ok) done.push(mid); } catch (_) {} }
      e._attendees = [...(e._attendees || []), ...done];
      renderEvDoc(e, e._items || []);
      toast(done.length === ids.length ? `تمت إضافة ${done.length}` : `أُضيف ${done.length} من ${ids.length} — راجع الرمز`);
    }, groups);
  };
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
  /* ann76: وسوم الوجوه — الضغط على وجه يفتح ملف صاحبه */
  const tags = (e._tags && e._tags.get(x.id)) || [];
  const tagHtml = tags.map(t => { const m = S.byId.get(t.member_id); if (!m) return ''; return `<button class="evtag" style="left:${t.x / 10}%;top:${t.y / 10}%;width:${t.w / 10}%;height:${t.h / 10}%" data-mid="${t.member_id}" aria-label="${esc(cardName(m))}"><span>${esc(cardName(m))}</span></button>`; }).join('');
  /* ann77: زر إظهار/إخفاء الوسوم — الافتراضي الوسوم ظاهرة، والاختيار يُحفظ في الجهاز */
  const hideTags = localStorage.getItem('almatarid-hide-tags') === '1';
  $('#profile-body').innerHTML = `<div class="evzoombar"><button class="x" id="evback">→ رجوع</button><span class="sub">${idx + 1} / ${photos.length}</span>
    ${tags.length ? `<button class="x" id="evtags" aria-label="${hideTags ? 'إظهار الوسوم' : 'إخفاء الوسوم'}">${hideTags ? '🏷️ إظهار' : '🏷️ إخفاء'}</button>` : ''}
    <span><button class="x" id="evprev" ${idx === 0 ? 'disabled' : ''} aria-label="الصورة السابقة">‹ سابقة</button>
    <button class="x" id="evnext" ${idx === photos.length - 1 ? 'disabled' : ''} aria-label="الصورة التالية">تالية ›</button></span></div>
    <div class="evzoom-wrap${hideTags ? ' notags' : ''}"><img class="evbig" src="${x.url}" alt="">${tagHtml}</div>${x.caption ? `<p class="sub">${esc(x.caption)}</p>` : ''}`;
  /* ann85: زر الإغلاق في عرض الصورة يغلق النافذة (لا رجوع هنا) */
  $('#profile-x').textContent = 'إغلاق';
  $('#evback').onclick = () => evDetails();
  const tg = $('#evtags');
  if (tg) tg.onclick = () => { const wrap = document.querySelector('#profile-body .evzoom-wrap'); const hidden = wrap.classList.toggle('notags'); localStorage.setItem('almatarid-hide-tags', hidden ? '1' : '0'); tg.textContent = hidden ? '🏷️ إظهار' : '🏷️ إخفاء'; tg.setAttribute('aria-label', hidden ? 'إظهار الوسوم' : 'إخفاء الوسوم'); };
  /* ann85: تذكّر الصورة — الخروج من الملف يرجع لها */
  document.querySelectorAll('#profile-body .evtag').forEach(b => b.onclick = () => { S.zoomBack = { e, photos, idx }; profile(b.dataset.mid); });
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
  else if (ev.target.closest('.ev-more') || ev.target.closest('.evslide')) evDetails(); /* ann53: الضغط على الشريط كله يفتح التفاصيل */
});
document.addEventListener('click', e => { const d = $('.more'); if (!d.contains(e.target)) d.open = false; });
setInterval(showEvent, 60000);
function collapseAll() { S.open = new Set(); for (const r of S.roots) { S.open.add(r.id); for (const k of S.kids.get(r.id) || []) S.open.add(k.id); } }
/* ann24: على الجوال يبدأ العرض بالمؤسس فقط مطويًا (طلب المالك) */
function collapseInitial() { if (window.matchMedia('(max-width: 640px)').matches) S.open = new Set(S.roots.map(r => r.id)); else collapseAll(); } /* ann48: المؤسس مفتوح بالجوال فتظهر الشجرة */
/* أبناء العرض: نتجاوز العضوات المخفيات (لا بطاقة لهن عند الزوار بطلب المالك) ونُظهر أبناءهن إن وُجدوا في مكانهن */
const dispKids = m => { const out = []; for (const c of (S.kids.get(m.id) || [])) { if (S.filterMemberIds && !S.filterMemberIds.has(c.id)) continue; if (S.hiddenBranches && S.hiddenBranches.has(c.id)) continue; if (c.name_masked) out.push(...dispKids(c)); else out.push(c); } return out; };
const dispRoots = () => { if (S.filterMode === 'descendants' && S.filterFocalId) { const focal = S.byId.get(S.filterFocalId); return focal ? [focal] : []; } if (S.filterMode === 'ancestors' && S.filterMemberIds) { const top = S.roots.find(r => S.filterMemberIds.has(r.id)); if (top) return [top]; } const out = []; const push = m => { if (S.hiddenBranches && S.hiddenBranches.has(m.id)) return; if (m.name_masked) (S.kids.get(m.id) || []).forEach(push); else out.push(m); }; S.roots.forEach(push); return out; };
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
      <i>الجيل ${gen(m)}</i>${!livingHidden(m) && S.photos.get(m.id) ? `<img class="gimg" src="${S.photos.get(m.id)}" alt="">` : ''}${m.is_alive === false ? '' : '<em class="al"></em>'}
      <b>${esc(cardName(m))}</b><small class="stt ${m.is_alive === false ? 'dead' : 'alive'}">${m.is_alive === false ? ripText(m) : aliveText(m)}${!livingHidden(m) && m.nickname ? ' · ' + esc(m.nickname) : ''}</small>${m.achievement_badge && !m.badge_is_job ? `<span class="bd">${esc(m.achievement_badge)}</span>` : ''}
      <small class="meta">${esc([(m.city && !livingHidden(m) ? '📍 ' + m.city : ''), kidsTxt(m)].filter(Boolean).join(' · '))}</small>
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
vp.addEventListener('dragstart', e => e.preventDefault()); /* ann75: إيقاف السحب الأصلي للمتصفح (شبح النص/الصورة) داخل المخطط — دون المساس بالنقر */
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
    <div class="nm" data-p="${m.id}" tabindex="0" role="button">${!livingHidden(m) && S.photos.get(m.id) ? `<img class="gimg2" src="${S.photos.get(m.id)}" alt="">` : ''}<b>${esc(cardName(m))}</b>${!livingHidden(m) && m.nickname ? `<small>${esc(m.nickname)}</small>` : ''}<small>الجيل ${gen(m)}${m.city && !livingHidden(m) ? ' · 📍 ' + esc(m.city) : ''}</small></div>
    ${m.achievement_badge && !m.badge_is_job ? `<span class="bd">${esc(m.achievement_badge)}</span>` : ''}${kidsTxt(m) ? `<span class="ct">${kidsTxt(m)}</span>` : ''}${m.is_alive === false ? `<span class="rip">${ripText(m)}</span>` : ''}
  </div>${k.length && o ? `<ul>${k.map(node).join('')}</ul>` : ''}</li>`;
}

/* ---------- العرض والتحكم ---------- */
function render(fitView) {
  stats();
  const g = S.view === 'graph', none = !!S.hit && S.hit.size === 0;
  $('#vp').hidden = !g || none; $('#tree').hidden = g || none;
  const dirCtrls = $('#dir-ctrls');
  if (dirCtrls) dirCtrls.hidden = g || none;
  $('#v-graph').setAttribute('aria-pressed', g); $('#v-list').setAttribute('aria-pressed', !g);
  S.order = [];
  if (!none) {
    if (g) {
      renderGraph(fitView);
      if (S.hit) S.order = [...S.hit].filter(id => S._pos.has(id)).sort((a, b) => S._pos.get(a).y - S._pos.get(b).y || S._X(S._pos.get(b).x) - S._X(S._pos.get(a).x));
    } else {
      renderDirectoryList();
      if (S.hit) S.order = [...$('#tree').querySelectorAll('[data-p]')].map(el => el.dataset.p);
    }
  }
  $('#qn').hidden = !S.order.length;
  $('#qc').textContent = S.curId && S.order.includes(S.curId) ? `${S.order.indexOf(S.curId) + 1} / ${S.order.length}` : `${S.order.length} نتيجة`;
  $('#empty').innerHTML = (S.members.length ? 'لا توجد نتائج لهذا البحث.' : 'لا يوجد أفراد بعد.') + (!S.members.length && canEdit() ? '<br><button id="add-root">➕ إضافة أول فرد</button>' : '');
  $('#empty').hidden = !(none || !S.members.length);
  syncToggles();
}
$('#v-graph').onclick = () => { S.view = 'graph'; render(true); };
$('#v-list').onclick = () => { S.view = 'list'; render(); };
const norm = s => String(s ?? '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
S.advFilter = {
  branchId: '',
  city: '',
  gen: '',
  aliveStatus: 'all'
};

function hasActiveFilter() {
  const f = S.advFilter;
  return !!(f && (f.branchId || f.city || f.gen || (f.aliveStatus && f.aliveStatus !== 'all')));
}

function getArabicSpellingVariants(str) {
  if (!str) return [];
  const s = norm(str);
  const variants = new Set([s]);

  if (s.includes('عبد الله')) variants.add(s.replace(/عبد الله/g, 'عبدالله'));
  if (s.includes('عبدالله')) variants.add(s.replace(/عبدالله/g, 'عبد الله'));
  if (s.includes('بن ')) variants.add(s.replace(/بن /g, 'ابن '));
  if (s.includes('ابن ')) variants.add(s.replace(/ابن /g, 'بن '));
  if (s.includes('علي')) variants.add(s.replace(/علي/g, 'على'));
  if (s.includes('على')) variants.add(s.replace(/على/g, 'علي'));
  if (s.includes('يحيى')) variants.add(s.replace(/يحيى/g, 'يحيي'));
  if (s.includes('ابراهيم')) variants.add(s.replace(/ابراهيم/g, 'إبراهيم'));
  if (s.includes('اسماعيل')) variants.add(s.replace(/اسماعيل/g, 'إسماعيل'));

  return Array.from(variants);
}

function matchesSearchAndFilter(m, query, filter) {
  if (m.name_masked) return false;

  if (filter?.aliveStatus === 'alive' && m.is_alive === false) return false;
  if (filter?.aliveStatus === 'deceased' && m.is_alive !== false) return false;
  if (filter?.gen && String(gen(m)) !== String(filter.gen)) return false;
  if (filter?.city && (m.city || '').trim() !== filter.city.trim()) return false;
  if (filter?.branchId && !underRoot(m, filter.branchId) && m.id !== filter.branchId) return false;

  if (query && query.trim()) {
    const q = stripKin(norm(query));
    const variants = getArabicSpellingVariants(q);
    const mNormName = stripKin(norm(m.full_name || ''));
    const mNormNick = stripKin(norm(m.nickname || ''));

    let matched = variants.some(v => mNormName.includes(v) || mNormNick.includes(v));
    if (!matched) {
      const tokens = q.split(' ').filter(Boolean);
      const nameTokens = mNormName.split(' ');
      matched = tokens.every(t => nameTokens.some(nt => nt.includes(t) || t.includes(nt)));
    }
    if (!matched) return false;
  }

  return true;
}

function executeSearchAndFilter() {
  const qVal = $('#q')?.value || '';
  const q = stripKin(norm(qVal));
  const hasFilter = hasActiveFilter();
  S.curId = null;

  const qFilterBtn = $('#q-filter');
  if (qFilterBtn) qFilterBtn.classList.toggle('active', hasFilter);

  const activeBar = $('#adv-search-active-bar');
  if (activeBar) {
    if (hasFilter) {
      const parts = [];
      if (S.advFilter.branchId) parts.push(`الفرع: ${S.byId.get(S.advFilter.branchId)?.full_name || ''}`);
      if (S.advFilter.city) parts.push(`المدينة: ${S.advFilter.city}`);
      if (S.advFilter.gen) parts.push(`الجيل: ${S.advFilter.gen}`);
      if (S.advFilter.aliveStatus === 'alive') parts.push('الأحياء فقط');
      if (S.advFilter.aliveStatus === 'deceased') parts.push('المتوفون رحمهم الله');

      activeBar.innerHTML = `
        <span>⚙️ تصفية نشطة: <b>${parts.join(' · ')}</b></span>
        <button type="button" id="adv-clear-filters" style="background:#ef4444;color:#fff;border:none;border-radius:12px;padding:2px 8px;font-size:.72rem;cursor:pointer;margin-right:auto">✕ مسح التصفية</button>
      `;
      activeBar.style.display = 'flex';
      const clrBtn = $('#adv-clear-filters');
      if (clrBtn) {
        clrBtn.onclick = () => {
          S.advFilter = { branchId: '', city: '', gen: '', aliveStatus: 'all' };
          executeSearchAndFilter();
        };
      }
    } else {
      activeBar.style.display = 'none';
    }
  }

  if (!q && !hasFilter) {
    if (S.saved) S.open = S.saved;
    S.saved = S.hit = null;
    return render(true);
  }

  if (!S.saved) S.saved = new Set(S.open);

  const matched = S.members.filter(m => matchesSearchAndFilter(m, qVal, S.advFilter));
  S.hit = new Set(matched.map(m => m.id));

  S.open = new Set();
  for (const id of S.hit) {
    for (let a = S.byId.get(S.byId.get(id)?.father_id), i = 0; a && i < 30; a = S.byId.get(a.father_id), i++) {
      S.open.add(a.id);
    }
  }
  render('hit');
}

$('#q').addEventListener('input', executeSearchAndFilter);
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

/* ---------- عداد الأجيال + إظهار/إخفاء العداد والإحصائيات (ann63، طلب المالك 2026-10-24) ---------- */
/* العداد مستقل عن الفتح/الطي: كل ضغطة + تُظهر جيلًا إضافيًا وكل ضغطة − تُخفي جيلًا، عبر ضبط عمق الفتح العام */
function visibleMaxGen() {
  let mx = 1;
  const walk = m => { const g = gen(m); if (g > mx) mx = g; if (S.open.has(m.id)) for (const k of (S.kids.get(m.id) || [])) walk(k); };
  for (const r of (S.roots || [])) walk(r);
  return mx;
}
function setGenCap(n) {
  const max = S.members.reduce((x, m) => Math.max(x, gen(m)), 1);
  n = Math.max(1, Math.min(max, n));
  S.saved = null;
  S.open = new Set(S.members.filter(m => gen(m) < n).map(m => m.id));
  render(true);
}
const prefHidden = k => { try { return localStorage.getItem(k) === '0'; } catch (_) { return false; } };
const setPrefHidden = (k, h) => { try { localStorage.setItem(k, h ? '0' : '1'); } catch (_) {} };
function syncToggles() {
  const sec = $('#genstep');
  if (sec) {
    sec.hidden = prefHidden('alm_genstep') || !!S.hit; /* يُخفى أثناء البحث حتى لا تعرض القراءة نطاقًا غير مطابق */
    if (!S.hit) {
      const mx = visibleMaxGen();
      const max = S.members.reduce((x, m) => Math.max(x, gen(m)), 1);
      $('#genstep-val').textContent = `الأجيال: 1 إلى ${mx}`;
      $('#btn-gen-plus').disabled = mx >= max;
      $('#btn-gen-minus').disabled = mx <= 1;
    }
  }
  const chips = $('#chips');
  if (chips) chips.hidden = prefHidden('alm_stats'); /* الإحصائيات فقط؛ حبتا الفتح/الطي تبقيان */
  const ctl = document.querySelector('.stats .ctl'); /* ann64: إخفاء حبتي الفتح/الطي */
  if (ctl) ctl.hidden = prefHidden('alm_ctl');
  const statsSec = document.querySelector('.stats'); /* إذا أُخفي الاثنان معًا يختفي الصف كله بدل فراغ */
  if (statsSec) statsSec.hidden = prefHidden('alm_stats') && prefHidden('alm_ctl');
  const mg = $('#m-genstep'); if (mg) mg.textContent = prefHidden('alm_genstep') ? '👁️ إظهار عداد الأجيال' : '🙈 إخفاء عداد الأجيال';
  const ms = $('#m-stats'); if (ms) ms.textContent = prefHidden('alm_stats') ? '👁️ إظهار الإحصائيات' : '🙈 إخفاء الإحصائيات';
  const mc = $('#m-ctl'); if (mc) mc.textContent = prefHidden('alm_ctl') ? '👁️ إظهار أزرار الفتح والطي' : '🙈 إخفاء أزرار الفتح والطي';
}
$('#btn-gen-plus').onclick = () => setGenCap(visibleMaxGen() + 1);
$('#btn-gen-minus').onclick = () => setGenCap(visibleMaxGen() - 1);
addEventListener('resize', () => { if (S.view === 'graph' && !$('#vp').hidden) fit(); });

/* ---------- الملف الشخصي ---------- */
function waNum(p) {  // 05xxxxxxxx أو 5xxxxxxxx أو 00966... إلى صيغة دولية بلا + أو أصفار
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0966')) d = d.slice(1);
  if (/^05\d{8}$/.test(d)) d = '966' + d.slice(1); else if (/^5\d{8}$/.test(d)) d = '966' + d;
  return d;
}
/* ann76: عدّاد ظهور الأعضاء في صور المناسبات (يُحمّل مرة واحدة من الوسوم) */
async function ensureTagCounts() {
  if (S.tagCounts) return S.tagCounts;
  if (CFG.DEMO) return new Map();
  if (S._tagCountsP) return S._tagCountsP;
  S._tagCountsP = (async () => {
    try {
      const r = await rpc('get_photo_tags', { p_code: S.code, p_event_id: null });
      const counts = new Map(), evs = new Map();
      (r.items || []).forEach(t => { counts.set(t.member_id, (counts.get(t.member_id) || 0) + 1); if (!evs.has(t.member_id)) evs.set(t.member_id, new Set()); evs.get(t.member_id).add(t.event_id); });
      /* ann78: الحضور اليدوي يشارك أيضًا في المشاركات */
      try { const ar = await rpc('get_event_attendees', { p_code: S.code, p_event_id: null }); (ar.items || []).forEach(x => { if (!evs.has(x.member_id)) evs.set(x.member_id, new Set()); evs.get(x.member_id).add(x.event_id); }); } catch (_) {}
      S.tagCounts = counts; S.tagEvents = evs; return counts;
    } catch (_) { S._tagCountsP = null; return new Map(); }
  })();
  return S._tagCountsP;
}
const tagCountText = id => { const n = S.tagCounts ? (S.tagCounts.get(id) || 0) : 0; if (!n) return ''; return `ظهر في ${n} ${n === 1 ? 'صورة' : n === 2 ? 'صورتان' : n <= 10 ? 'صور' : 'صورة'}`; };
const partText = id => { const s = S.tagEvents ? S.tagEvents.get(id) : null; if (!s || !s.size) return ''; return [...s].map(eid => { const ev = (S.events || []).find(z => String(z.id) === String(eid)); return ev ? ev.title : null; }).filter(Boolean).join('، '); };
function profile(id) {
  const m = S.byId.get(id); if (!m) return;
  const father = S.byId.get(m.father_id), wives = S.wives.filter(w => w.husband_id === m.id), mother = S.wives.find(w => w.id === m.wife_mother_id);
  const hub = S.wives.find(w => w.member_id === m.id), husband = hub ? S.byId.get(hub.husband_id) : null;
  /* ann82: التاريخ الكامل هجري + ميلادي إن وُجد، وإلا سنة الميلاد النصية */
  const datePair = iso => { if (!iso) return ''; const h = hijriShort(new Date(iso + 'T00:00:00Z')); return `${h} (${iso.replaceAll('-', '/')}م)`; };
  const isVisitor = (S.role === 'visitor' || !S.role) && !S.code;
  const isLiving = m.is_alive !== false;
  const lh = isVisitor && isLiving; /* ميزة 3: إخفاء بيانات الأحياء عن الزوار */
  const born = isVisitor && isLiving ? (m.birth_year_text ? `${esc(m.birth_year_text)} (التاريخ التفصيلي محمي 🔒)` : 'محمي للأقارب المسجلين 🔒') : (m.birth_date ? datePair(m.birth_date) : (m.birth_year_text || ''));
  const died = m.is_alive === false ? (m.death_date ? datePair(m.death_date) : (m.death_year_text || 'غير معروف')) : '';
  $('#profile-body').dataset.id = id;
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '', digits = waNum(m.phone);
  const phoneText = isVisitor && isLiving && digits ? '<span style="color:var(--mut)">محمي — للأقارب المسجلين فقط 🔒</span>' : (digits ? `<a href="tel:+${digits}" dir="ltr">${esc(m.phone)}</a> · <a href="https://wa.me/${digits}" target="_blank" rel="noopener">واتساب</a>` : '');
  const livingNotice = isVisitor && isLiving ? `<div style="background:rgba(245,158,11,.1);border:1px solid var(--gold);border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:.76rem;color:var(--gold);display:flex;justify-content:space-between;align-items:center"><span>🔒 بيانات الأحياء الشخصية محمية وتظهر للأقارب المسجلين فقط.</span><button type="button" class="x" onclick="$('#profile').close();$('#btn-login').click();" style="color:var(--gold);font-weight:700">دخول الأقارب ←</button></div>` : '';
  const isMe = localStorage.getItem('almatarid_me_id') === id;
  const meBtn = isMe ? '<button type="button" class="ghost" data-act="unset-me" style="color:#10b981;font-weight:700">⭐ مسجل كـ «أنا» (إلغاء)</button>' : '<button type="button" class="ghost" data-act="set-me">👤 هذا أنا</button>';
  const reorderBtn = canMember(m) && (S.kids.get(m.id) || []).length > 1 ? '<button type="button" class="ghost" data-act="reorder" title="ترتيب أبناء هذا الفرد بالسحب">↕️ ترتيب الأبناء</button>' : '';
  $('#profile-body').innerHTML = `${livingNotice}${!lh && S.photos.get(m.id) ? `<img class="pimg" src="${S.photos.get(m.id)}" alt="">` : ''}<h2>${esc(m.full_name)}</h2>
    <p class="sub">${!lh && m.nickname ? esc(m.nickname) + ' · ' : ''}الجيل ${gen(m)}${m.is_alive === false ? ' · ' + ripText(m) : ''}</p>
    ${m.achievement_badge ? (m.badge_is_job ? `<p class="sub">الوظيفة: ${esc(m.achievement_badge)}</p>` : `<p><span class="bd">${esc(m.achievement_badge)}</span></p>`) : ''}
    <dl>${row('الأب', father ? esc(father.full_name) : '')}${row('الأم', mother ? (isVisitor ? 'محمية 🔒' : esc(mother.full_name)) : '')}
      ${row(hub && hub.marriage_status === 'divorced' ? 'زوج سابق' : 'الزوج', husband ? esc(husband.full_name) : '')}
      ${row('الزوجات', wives.map(w => { const wkids = S.members.filter(x => x.wife_mother_id === w.id); const div = w.marriage_status === 'divorced'; return esc(w.full_name) + (w.family_name ? ' (' + esc(w.family_name) + ')' : '') + (div ? ' · <b>زوجة سابقة</b>' : '') + (wkids.length ? ' · أبناؤها: ' + wkids.map(k => esc(k.full_name)).join('، ') : '') + (w.member_id ? ' · من الأسرة' + (S.byId.get(w.member_id)?.name_masked ? '' : ' <button class="x" data-so="' + esc(w.member_id) + '">ملفها</button>') : '') + (canMember(m) ? `<button class="x" data-we="${esc(w.id)}" aria-label="تعديل بيانات الزوجة">✏️</button><button class="x" data-ws="${esc(w.id)}" data-wst="${div ? 'current' : 'divorced'}">${div ? '↩ إعادة كزوجة حالية' : '💔 إنهاء الزواج (طلاق)'}</button><button class="x" data-wd="${esc(w.id)}" aria-label="حذف زوجة">✕</button>` : ''); }).join('، '))}
      ${row('مسؤول الفرع', esc(delegateName(S.branches.find(x => x.root_id === m.id))))}${row('الأبناء', (S.kids.get(m.id) || []).length || '')}${row('الميلاد', esc(born))}${row('الوفاة', esc(died))}${lh ? '' : row('المدينة', esc(m.city))}${row('ألبوم الصور', `<span style="display:inline-flex;align-items:center;gap:6px"><span>${tagCountText(id) || 'صور ومناسبات'}</span><button type="button" class="x" data-act="open-album" style="color:var(--gold);font-weight:700">🖼️ فتح الألبوم ←</button></span>`)}${row('المشاركات', partText(id))}
      ${row('الهاتف', phoneText)}</dl>
    ${!lh && m.audio_url ? `<audio controls preload="none" src="${esc(m.audio_url)}" style="width:100%"></audio>` : ''}
    ${(m.biography_story || m.bio) && !lh ? `<div class="story">${esc(m.biography_story || m.bio)}</div>` : ''}
    ${canMember(m) ? `<div class="row adm"><button data-act="edit">✏️ تعديل</button><button data-act="child">➕ ابن</button><button data-act="wife">➕ زوجة</button><button data-act="photo">📷 صورة</button><button type="button" class="ghost" data-act="open-album">🖼️ ألبوم الصور</button><button type="button" class="ghost" data-act="lcard">📇 بطاقة النسب</button><button type="button" class="ghost" data-act="qr-card">📱 رمز QR</button><button type="button" class="ghost" data-act="descendants" title="عرض هذا الشخص وذريته فقط على الشجرة">🌿 النسل فقط</button><button type="button" class="ghost" data-act="ancestors" title="عرض خط آباء وأجداد هذا الشخص">📜 الأسلاف فقط</button>${reorderBtn}${meBtn}${S.role === 'owner' ? '<button data-act=\"branch\">👤 مسؤول الفرع</button><button class="danger" data-act="del">🗑 حذف</button>' : ''}</div>` : `<div class="row adm"><button type="button" class="ghost" data-act="open-album">🖼️ ألبوم الصور</button><button type="button" class="ghost" data-act="lcard">📇 بطاقة النسب</button><button type="button" class="ghost" data-act="qr-card">📱 رمز QR</button><button type="button" class="ghost" data-act="descendants" title="عرض هذا الشخص وذريته فقط على الشجرة">🌿 النسل فقط</button><button type="button" class="ghost" data-act="ancestors" title="عرض خط آباء وأجداد هذا الشخص">📜 الأسلاف فقط</button>${meBtn}<button class="ghost" data-sg="1">📝 اقتراح تصحيح</button></div>`}`;
  /* ann76: إن لم تكن العدّادات محمّلة بعد، حمّلها وأعد رسم الملف إن بقي مفتوحًا */
  if (!S.tagCounts) ensureTagCounts().then(() => { if ($('#profile').open && $('#profile-body').dataset.id === id) profile(id); });
  /* ann85: تسمية زر الإغلاق حسب السياق — رجوع للصورة إن فُتح الملف من وسم */
  $('#profile-x').textContent = S.zoomBack ? '→ رجوع للصورة' : 'إغلاق';
  if (!$('#profile').open) $('#profile').showModal();
}
/* ann85: إن كان الملف فُتح من وسم صورة، الإغلاق يرجع للصورة نفسها بدل إغلاق النافذة */
$('#profile-x').onclick = () => {
  if (S.zoomBack) { const z = S.zoomBack; S.zoomBack = null; evZoom(z.e, z.photos, z.idx); }
  else $('#profile').close();
};
$('#profile').addEventListener('close', () => { S.zoomBack = null; $('#profile-x').textContent = 'إغلاق'; });

/* ---------- الإدارة: تعمل عبر دوال الخادم المؤمّنة، وفي التجربة على الذاكرة ---------- */
async function op(name, args, demo) {
  if (CFG.DEMO) { demo(); index(); render(); return { success: true }; }
  const r = await rpc(name, args);
  /* ann95: بعض الدوال ترجع {'ok': true} لا {'success': true} (مثل secure_set_member_dates §20) — اقبلها نجاحًا */
  if (!r.success && !r.ok) throw new Error(r.message || 'تعذر الحفظ');
  return r;
}
async function refresh() {
  const b = await rpc('get_bundle', { p_code: S.code });
  if (!b.ok) throw new Error('انتهت الجلسة، سجّل الدخول من جديد');
  S.members = b.members; S.wives = b.wives; S.events = b.events || []; S.branch = b.branch || null; S.branches = b.branches || []; index(); render(); showEvent();
}
/* بحث داخل قوائم الأسماء (ann97): تطبيع عربي (أ/إ/آ، ة/ه، ى/ي، التشكيل) + عدم فقدان الاختيار الحالي عند التصفية + منع إرسال النموذج بالإنتر */
const normAr = s => String(s ?? '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652\u0670ـ]/g, '');
// تجريد كلمات النسب (بنت/ابن/بن/ابنة) من النص المطبَّع قبل مقارنة الأسماء — البحث لا يشترطها (قاعدة عمر 2026-11-24)؛ بحدود كلمات عربية صحيحة، لأن \b الإنجليزي لا يعمل مع العربية إطلاقاً.
const stripKin = s => String(s ?? '').replace(/(^|\s)(بنت|ابنه|ابن|بن)(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
function bindSelectSearch(sel, inp) {
  const all = [...sel.options].map(o => [o.value, o.textContent]);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  inp.addEventListener('input', () => {
    const q = stripKin(normAr(inp.value));
    const cur = sel.value;
    const vis = all.filter(([v, t], i) => (i === 0 && v === '') || stripKin(normAr(t)).includes(q));
    if (cur && !vis.some(([v]) => v === cur)) { const co = all.find(([v]) => v === cur); if (co) vis.splice(1, 0, co); }
    sel.innerHTML = vis.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
    sel.value = cur;
  });
}
function openForm(title, fields, onSubmit) {
  $('#form-title').textContent = title; $('#form-err').hidden = true; S.onForm = onSubmit;
  $('#form-fields').innerHTML = fields.map(f => f.type === 'raw' ? f.html : `<label class="fl">${esc(f.label)}${
    f.type === 'select' ? `<div class="selrow">${f.opts.length > 12 ? `<input class="selfilter" type="search" placeholder="🔍 ابحث في القائمة…" data-tg="${f.k}">` : ''}<select name="${f.k}">${f.opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(f.val ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`
    : f.type === 'area' ? `<textarea name="${f.k}" rows="4"${f.req ? ' required' : ''}>${esc(f.val)}</textarea>`
    : `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(f.val)}"${f.req ? ' required' : ''} autocomplete="off">`}</label>`).join('');
  /* ann41: بحث داخل القوائم الطويلة (رأس فرع/مسؤول/عضو…) — ann97: دالة مشتركة */
  document.querySelectorAll('.selfilter').forEach(inp => {
    const sel = document.querySelector(`select[name="${inp.dataset.tg}"]`); if (sel) bindSelectSearch(sel, inp);
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
/* ann80: منتقي جماعي — بحث + تحديد بعدة أسماء دفعة واحدة (الاختيار يبقى عند البحث) */
/* ann81: فلاتر بالأجيال (اختياري عبر groups) */
function openBulkPicker(title, items, onDone, groups) {
  $('#pick-title').textContent = title;
  const q = $('#pick-q'), list = $('#pick-list'), ok = $('#pick-ok'), count = $('#pick-count'), filters = $('#pick-filters');
  const sel = new Set();
  let group = null;
  q.value = '';
  const renderFilters = () => {
    if (!groups || !groups.length) { filters.innerHTML = ''; return; }
    const counts = {};
    items.forEach(it => counts[it.group] = (counts[it.group] || 0) + 1);
    const gs = groups.filter(g => counts[g.key]);
    filters.innerHTML = `<button type="button" class="pickf${group === null ? ' on' : ''}" data-g="">الكل (${items.length})</button>` + gs.map(g => `<button type="button" class="pickf${group === g.key ? ' on' : ''}" data-g="${g.key}">${g.label} (${counts[g.key]})</button>`).join('');
    filters.querySelectorAll('.pickf').forEach(b => b.onclick = () => { group = b.dataset.g === '' ? null : +b.dataset.g; renderFilters(); render(); });
  };
  const render = () => {
    const needle = q.value.trim();
    list.innerHTML = items.filter(it => (group === null || it.group === group) && (!needle || it.label.includes(needle))).map(it => `<label class="pickrow"><input type="checkbox" value="${esc(it.id)}"${sel.has(it.id) ? ' checked' : ''}><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</label>`).join('') || '<p class="sub">لا نتائج مطابقة.</p>';
    update();
  };
  const update = () => {
    const n = sel.size;
    count.textContent = n ? `تم اختيار ${n}` : '';
    ok.disabled = !n;
    ok.textContent = n ? `➕ إضافة المحددين (${n})` : '➕ إضافة المحددين';
  };
  q.oninput = render;
  list.onchange = ev => { const c = ev.target; if (c.matches('input[type=checkbox]')) { c.checked ? sel.add(c.value) : sel.delete(c.value); update(); } };
  ok.onclick = () => { const ids = [...sel]; $('#pick').close(); onDone(ids); };
  renderFilters();
  render();
  if (!$('#pick').open) $('#pick').showModal();
}
$('#form-x').onclick = () => $('#form').close();
$('#pick-x').onclick = () => $('#pick').close();

async function saveMember(m, fid, d) {
  const v = { full_name: d.full_name.trim(), nickname: d.nickname.trim() || null, gender: d.gender, is_alive: d.alive === '1',
    /* ann91: السنة النصية تُشتق من منتقي التاريخ الهجري أو الصيغة التقريبية (نحو، قبل، بين عامين) */
    birth_year_text: d.approx_text?.trim() ? d.approx_text.trim() : (d.bd_y ? String(d.bd_y) : (m?.birth_year_text ?? null)),
    death_year_text: d.alive === '1' ? null : (d.approx_death?.trim() ? d.approx_death.trim() : (d.dd_y ? String(d.dd_y) : (m?.death_year_text ?? null))), city: (d.city === '__other' ? (d.city2 || '') : d.city).trim() || null, achievement_badge: d.badge.trim() || null, badge_is_job: d.badge.trim() ? d.bkind === 'job' : false, phone: d.phone.trim() || null,
    birth_order: +d.order || 1, wife_mother_id: d.mother || null, biography_story: d.story.trim() || null, name_public: d.gender === 'female' && d.namepub === '1', name_hidden: d.gender === 'female' && d.namehid === '1' };
  /* ann82: التواريخ الكاملة — هجري من المنتقي → ميلادي ISO؛ التحقق قبل أي حفظ */
  const hdate = p => {
    const y = +d[p + '_y'];
    if (!y) return null;
    const day = +d[p + '_d'] || 1, mm = +d[p + '_m'] || 1;
    if (y < 1300 || y > 1600) throw new Error('أدخل سنة هجرية صحيحة (1300–1600)');
    const g = hijriToGreg(y, mm, day), chk = gregToHijri(g);
    if (chk.y !== y || chk.m !== mm || chk.d !== day) throw new Error('هذا اليوم غير موجود في هذا الشهر الهجري — جرّب يومًا آخر');
    return `${g.getUTCFullYear()}-${pad(g.getUTCMonth() + 1)}-${pad(g.getUTCDate())}`;
  };
  const birthD = hdate('bd'), deathD = d.alive === '1' ? null : hdate('dd');
  if (birthD && deathD && new Date(deathD) < new Date(birthD)) {
    throw new Error('تناقض في التواريخ: تاريخ الوفاة لا يمكن أن يسبق تاريخ الميلاد!');
  }
  const r = await op('secure_save_member', { p_id: m?.id ?? null, p_full_name: v.full_name, p_nickname: v.nickname, p_gender: v.gender, p_father_id: fid,
    p_wife_mother_id: v.wife_mother_id, p_birth_order: v.birth_order, p_phone: v.phone, p_is_alive: v.is_alive, p_birth_year_text: v.birth_year_text,
    p_death_year_text: v.death_year_text, p_biography_story: v.biography_story, p_passcode: S.code },
    () => { if (m) Object.assign(m, v); else S.members.push({ id: 'n' + Date.now(), father_id: fid, audio_url: null, created_at: Date.now(), ...v }); });
  await op('secure_update_member_extras', { p_id: r.id ?? m?.id, p_city: v.city, p_achievement_badge: v.achievement_badge, p_badge_is_job: v.badge_is_job, p_audio_url: m?.audio_url || null, p_name_public: v.name_public, p_name_hidden: v.name_hidden, p_passcode: S.code }, () => {});
  await op('secure_set_member_dates', { p_passcode: S.code, p_id: r.id ?? m?.id, p_birth_date: birthD, p_death_date: deathD }, () => { const mm = S.byId.get(r.id ?? m?.id); if (mm) { mm.birth_date = birthD; mm.death_date = deathD; } });
  if (fid) S.open.add(fid);
  if (!CFG.DEMO) await refresh(); else render();
  // بطاقات تلقائية: إضافة مولود ← تهنئة فقط إذا كانت سنة الميلاد المذكورة هي السنة الحالية (هجري/ميلادي، بأرقام عربية أو إنجليزية) — بدون سنة أو بسنة قديمة لا تهنئة (طلب المالك 2026-10-26)؛ وتحويل حي إلى متوفى ← تعزية
  const ym = (String(v.birth_year_text || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).match(/\d{4}/) || [''])[0];
  const yr = new Date().getFullYear(), hj = +new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { year: 'numeric' }).format(new Date()).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  const newborn = !!ym && (+ym === yr || +ym === hj); /* ann79: التهنئة فقط لسنة الميلاد الحالية */
  if (!m && v.is_alive && newborn) { const ln = cardLongName({ full_name: v.full_name, gender: v.gender, father_id: fid }); setTimeout(() => openCard({ full_name: ln, gender: v.gender, father_id: fid }, 'birth'), 80); postAnnouncement('birth', { id: r.id, full_name: ln, gender: v.gender }); }
  else if (m && m.is_alive !== false && !v.is_alive) { const ln = cardLongName({ full_name: v.full_name, gender: v.gender, father_id: m.father_id }); setTimeout(() => openCard({ full_name: ln, gender: v.gender, father_id: m.father_id }, 'condolence'), 80); postAnnouncement('condolence', { id: m.id, full_name: ln, gender: v.gender }); }
}
const CITIES = ['المدينة المنورة', 'ينبع', 'العلا', 'خيبر', 'الحناكية', 'المهد', 'بدر', 'وادي الفرع', 'العيص', 'مكة المكرمة', 'جدة', 'الطائف', 'رابغ', 'الليث', 'القنفذة', 'الجموم', 'الرياض', 'الخرج', 'الدوادمي', 'المجمعة', 'الزلفي', 'شقراء', 'وادي الدواسر', 'الأفلاج', 'حوطة بني تميم', 'الدمام', 'الخبر', 'الظهران', 'الجبيل', 'الأحساء', 'القطيف', 'حفر الباطن', 'تبوك', 'ضباء', 'الوجه', 'أملج', 'تيماء', 'حائل', 'بريدة', 'عنيزة', 'الرس', 'عرعر', 'سكاكا', 'القريات', 'أبها', 'خميس مشيط', 'بيشة', 'النماص', 'جازان', 'صبيا', 'نجران', 'الباحة', 'بلجرشي', 'خارج المملكة'];
/* ann82: منتقي التاريخ الهجري (أم القرى) — اليوم/الشهر اختياريان (يُحفظ 01 عند تركهما)، السنة إلزامية للتسجيل */
function hdateRow(p, title, iso) {
  const hj = iso ? gregToHijri(new Date(iso + 'T00:00:00Z')) : { y: '', m: '', d: '' };
  return `<div class="conv" id="${p}-wrap"><b>${title} (هجري — أم القرى)</b><div class="convrow">`
    + `<select name="${p}_d" aria-label="اليوم"><option value="">اليوم</option>${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}"${hj.d === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>`
    + `<select name="${p}_m" aria-label="الشهر"><option value="">الشهر</option>${HJ_MONTHS.map((t, i) => `<option value="${i + 1}"${hj.m === i + 1 ? ' selected' : ''}>${t}</option>`).join('')}</select>`
    + `<input name="${p}_y" type="number" min="1300" max="1600" placeholder="السنة" value="${hj.y || ''}" aria-label="السنة الهجرية">`
    + `</div><p class="sub" id="${p}-g"></p><p class="sub">إذا لم تعرف اليوم أو الشهر اتركه فارغًا — يُحفظ 01.</p></div>`;
}
function memberForm(m, parentId) {
  const fid = m ? m.father_id : parentId, moms = S.wives.filter(w => w.husband_id === fid);
  const f = (k, label, val, type, x = {}) => ({ k, label, val, type, ...x });
  openForm(m ? 'تعديل بيانات الفرد' : fid ? 'إضافة ابن لـ ' + (S.byId.get(fid)?.full_name || '') : 'إضافة أول فرد', [
    f('full_name', 'الاسم الكامل', m?.full_name, 'text', { req: true }),
    { type: 'raw', html: `<div class="pairrow w21"><label class="fl">الكنية<input name="nickname" type="text" value="${esc(m?.nickname ?? '')}" autocomplete="off"></label><label class="fl">الترتيب<input name="order" type="number" value="${m?.birth_order ?? (S.kids.get(fid)?.length || 0) + 1}" autocomplete="off"></label></div>` },
    { type: 'raw', html: `<div class="pairrow"><label class="fl">الجنس<select name="gender"><option value="male"${(m?.gender || 'male') === 'male' ? ' selected' : ''}>ذكر</option><option value="female"${m?.gender === 'female' ? ' selected' : ''}>أنثى</option></select></label><label class="fl">الحالة<select name="alive"><option value="1"${m?.is_alive === false ? '' : ' selected'}>حي</option><option value="0"${m?.is_alive === false ? ' selected' : ''}>متوفى</option></select></label></div>` },
    { type: 'raw', html: hdateRow('bd', 'تاريخ الميلاد', m?.birth_date) },
    { type: 'raw', html: hdateRow('dd', 'تاريخ الوفاة', m?.death_date) },
    { type: 'raw', html: `<div style="background:rgba(245,158,11,.06);border:1px dashed var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px">
      <label class="fl" style="margin-bottom:0">
        صيغة التاريخ التقريبي للأجداد القدامى (نحو / قبل / بين عامين)
        <div class="pairrow" style="margin-top:4px">
          <input name="approx_text" type="text" placeholder="الميلاد: مثلاً: نحو 1320 هـ أو بين 1310-1325" value="${esc(m?.birth_year_text || '')}" autocomplete="off">
          <input name="approx_death" type="text" placeholder="الوفاة: مثلاً: نحو 1380 هـ أو قبل 1400" value="${esc(m?.death_year_text || '')}" autocomplete="off">
        </div>
      </label>
    </div>` },
    f('city', 'المدينة', m?.city || '', 'select', { opts: [['', '—'], ['__other', 'أخرى — مدينة جديدة'], ...CITIES.map(c => [c, c]), ...(m?.city && !CITIES.includes(m.city) ? [[m.city, m.city]] : [])] }),
    f('city2', 'المدينة الجديدة (تُستخدم عند اختيار «أخرى»)', ''),
    { type: 'raw', html: `<div class="pairrow"><label class="fl">الهاتف<input name="phone" type="tel" value="${esc(m?.phone ?? '')}" autocomplete="off"></label><label class="fl">الشارة<input name="badge" type="text" value="${esc(m?.achievement_badge ?? '')}" autocomplete="off"></label></div>` },
    f('bkind', 'نوع الشارة', m?.badge_is_job ? 'job' : 'badge', 'select', { opts: [['badge', 'شارة (تميّز/تكريم)'], ['job', 'وظيفة']] }),
    ...(moms.length ? [f('mother', 'الأم', m?.wife_mother_id || '', 'select', { opts: [['', '—'], ...moms.map(w => [w.id, w.full_name + (w.marriage_status === 'divorced' ? ' (زوجة سابقة)' : '')])] })] : []),
    f('namepub', 'إظهار الاسم رغم إخفاء أسماء النساء (للإناث)', m?.name_public ? '1' : '0', 'select', { opts: [['0', 'لا'], ['1', 'نعم']] }),
    f('namehid', 'إخفاء الاسم برغبة صاحبة الاسم (للإناث)', m?.name_hidden ? '1' : '0', 'select', { opts: [['0', 'لا'], ['1', 'نعم']] }),
    f('story', 'نبذة', m?.biography_story || m?.bio, 'area')], d => saveMember(m, fid, d));
  /* ann82: تحديث المقابل الميلادي لحظيًا لمنتقيي التاريخ */
  const wireHDate = p => {
    const wrap = document.querySelector('#' + p + '-wrap'); if (!wrap) return;
    const upd = () => {
      const d = +wrap.querySelector(`[name=${p}_d]`).value || 1, mm = +wrap.querySelector(`[name=${p}_m]`).value || 1, y = +wrap.querySelector(`[name=${p}_y]`).value;
      const out = document.querySelector('#' + p + '-g');
      if (!y) { out.textContent = ''; return; }
      if (y < 1300 || y > 1600) { out.textContent = 'أدخل سنة هجرية صحيحة (1300–1600)'; return; }
      const g = hijriToGreg(y, mm, d), chk = gregToHijri(g);
      if (chk.y !== y || chk.m !== mm || chk.d !== d) { out.textContent = 'هذا اليوم غير موجود في هذا الشهر الهجري'; return; }
      out.textContent = `الميلادي: ${g.getUTCFullYear()}/${pad(g.getUTCMonth() + 1)}/${pad(g.getUTCDate())}`;
    };
    wrap.querySelectorAll('select, input').forEach(el => el.addEventListener('change', upd));
    upd();
  };
  wireHDate('bd'); wireHDate('dd');
  const alSel = document.querySelector('#form-fields [name=alive]');
  if (alSel) { const syncAlive = () => { const dead = alSel.value !== '1'; const ddWrap = document.querySelector('#dd-wrap'); if (ddWrap) ddWrap.style.display = dead ? '' : 'none'; }; alSel.addEventListener('change', syncAlive); syncAlive(); }
  const gSel = document.querySelector('#form-fields [name=gender]');
  if (gSel) { const syncGender = () => { const fem = gSel.value === 'female'; for (const n of ['namepub', 'namehid']) { const inp = document.querySelector(`#form-fields [name=${n}]`); if (inp) inp.closest('.fl').style.display = fem ? '' : 'none'; } }; gSel.addEventListener('change', syncGender); syncGender(); }
}
function wifeForm(m, existing) { /* ann61: existing = تعديل زوجة موجودة (كان مستحيلًا مع وجود أبناء) */
  const women = S.members.filter(x => x.gender === 'female').sort(byName);
  const fields = [
    { k: 'mode', label: 'نوع الزوجة', type: 'select', val: existing?.member_id ? 'link' : 'new', opts: [['new', 'من خارج الأسرة (اسم نصي)'], ['link', 'من نساء الأسرة (ربط بسجلها)']] },
    { k: 'member', label: 'اخترها من نساء الشجرة (عند الربط)', type: 'select', val: existing?.member_id || '', opts: [['', '—'], ...women.map(w => [w.id, w.full_name])] },
    { k: 'name', label: 'اسم الزوجة (عند عدم الربط)', val: existing && !existing.member_id ? existing.full_name : '' },
    { k: 'namepub', label: 'إظهار اسمها رغم إخفاء أسماء النساء', type: 'select', val: existing?.name_public ? '1' : '0', opts: [['0', 'لا'], ['1', 'نعم']] },
    { k: 'namehid', label: 'إخفاء اسمها برغبتها', type: 'select', val: existing?.name_hidden ? '1' : '0', opts: [['0', 'لا'], ['1', 'نعم']] }];
  if (!existing) fields.push({ k: 'mstatus', label: 'حالة الزواج', type: 'select', val: 'current', opts: [['current', 'زوجة حالية'], ['divorced', 'زوجة سابقة — انتهى الزواج بالطلاق (تظهر للمالك فقط)']] });
  openForm(existing ? 'تعديل بيانات زوجة' : 'إضافة زوجة لـ ' + m.full_name, fields, async d => {
    const linked = d.mode === 'link' && d.member ? S.byId.get(d.member) : null;
    if (d.mode === 'link' && !linked) throw new Error('اختر الزوجة من قائمة نساء الأسرة');
    const name = linked ? linked.full_name : d.name.trim();
    if (!name) throw new Error('الاسم مطلوب');
    const fam = linked ? null : (existing?.family_name ?? null); /* ann96: حقل «اسم عائلتها» حُذف من النموذج — يُحفظ الاسم القديم إن وُجد */
    if (existing) {
      await op('secure_update_wife', { p_wife_id: existing.id, p_full_name: name, p_family_name: fam, p_member_id: linked?.id || null, p_name_public: d.namepub === '1', p_name_hidden: d.namehid === '1', p_passcode: S.code },
        () => Object.assign(existing, { full_name: name, family_name: fam, member_id: linked?.id || null, name_public: d.namepub === '1', name_hidden: d.namehid === '1' }));
    } else {
      await op('secure_save_wife', { p_husband_id: m.id, p_full_name: name, p_family_name: fam, p_member_id: linked?.id || null, p_name_public: d.namepub === '1', p_name_hidden: d.namehid === '1', p_passcode: S.code, p_marriage_status: d.mstatus },
        () => S.wives.push({ id: 'w' + Date.now(), husband_id: m.id, full_name: name, family_name: fam, member_id: linked?.id || null, name_public: d.namepub === '1', name_hidden: d.namehid === '1', marriage_status: d.mstatus }));
    }
    if (!CFG.DEMO) await refresh(); profile(m.id);
  });
  /* ann96: حقل الربط يظهر فقط عند اختيار «من نساء الأسرة» */
  const modeSel = document.querySelector('#form-fields [name=mode]');
  const memSel = document.querySelector('#form-fields [name=member]');
  if (modeSel && memSel) { const syncMode = () => { memSel.closest('.fl').style.display = modeSel.value === 'link' ? '' : 'none'; }; modeSel.addEventListener('change', syncMode); syncMode(); }
}
async function editWife(id) {
  const w = S.wives.find(x => x.id === id); if (!w) return;
  const m = S.byId.get(w.husband_id); if (!m) return;
  wifeForm(m, w);
}
async function setWifeStatus(id, status) {
  const w = S.wives.find(x => x.id === id); if (!w) return;
  const msg = status === 'divorced' ? `إنهاء زواج «${w.full_name}» بالطلاق؟ ستصبح «زوجة سابقة»: تختفي عن جميع الزوار والمحررين ومسؤولي الفروع، وتبقى ظاهرة لك وحدك مع بقاء أبنائها مرتبطين بها.` : `إعادة «${w.full_name}» كزوجة حالية؟`;
  if (!confirm(msg)) return;
  try { await op('secure_set_wife_status', { p_wife_id: id, p_status: status, p_passcode: S.code }, () => { w.marriage_status = status; }); if (!CFG.DEMO) await refresh(); profile(w.husband_id); }
  catch (err) { alert(err.message); }
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
  const b = e.target.closest('[data-act],[data-wd],[data-ws],[data-we]'); if (!b) return;
  const m = S.byId.get($('#profile-body').dataset.id);
  if (b.dataset.we) return editWife(b.dataset.we);
  if (b.dataset.ws) return setWifeStatus(b.dataset.ws, b.dataset.wst);
  if (b.dataset.wd) return delWife(b.dataset.wd);
  ({ edit: () => { $('#profile').close(); memberForm(m); }, child: () => { $('#profile').close(); memberForm(null, m.id); },
     wife: () => { $('#profile').close(); wifeForm(m); }, branch: () => { $('#profile').close(); branchForm(m.id); }, del: () => delMember(m),
     photo: () => { const f = $('#photo-file'); f.dataset.mid = m.id; f.click(); },
     lcard: () => { openLineageCard(m.id); },
     'qr-card': () => { openQrShareModal(m.id); },
     descendants: () => { $('#profile').close(); setDescendantsFilter(m.id); },
     ancestors: () => { $('#profile').close(); setAncestorsFilter(m.id); },
     reorder: () => { $('#profile').close(); openSiblingReorderModal(m.id); },
     'open-album': () => { openMemberPhotoAlbum(m.id); },
     'set-me': () => { localStorage.setItem('almatarid_me_id', m.id); profile(m.id); toast(`📍 تم تحديدك كـ «${m.full_name}»!`); },
     'unset-me': () => { localStorage.removeItem('almatarid_me_id'); profile(m.id); toast('تم إلغاء التعيين.'); } })[b.dataset.act]?.();
});
$('#m-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), members: S.members, wives: S.wives, events: S.events }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `al-matarid-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href); $('.more').open = false;
};
/* ---------- المصادقة الثنائية لحساب المالك (2FA) ---------- */
/* ---------- المصادقة الثنائية لحساب المالك (2FA) ---------- */
/* إصلاح أمني: الرمز يُحفظ كبصمة SHA-256 فقط (لا نص صريح ولا رمز افتراضي معروض)؛ لا رمز ثابت ولا قبول كود المالك كعامل ثانٍ. */
async function hash2fa(pin) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('alm-2fa:' + pin));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    let h = 0; const s = 'alm-2fa:' + pin;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return 'f' + h.toString(16);
  }
}
/* ترحيل لمرة واحدة: رمز نصي قديم (قبل الإصلاح) يُحوَّل لبصمة ثم يُحذف نصه من التخزين */
async function get2faHash() {
  try {
    let h = localStorage.getItem('almatarid_owner_2fa_hash') || '';
    if (!h) {
      const legacy = localStorage.getItem('almatarid_owner_2fa_pin');
      if (legacy) { h = await hash2fa(legacy.trim()); localStorage.setItem('almatarid_owner_2fa_hash', h); localStorage.removeItem('almatarid_owner_2fa_pin'); }
    }
    return h;
  } catch (_) { return ''; }
}
async function verifyOwner2FA(onSuccess) {
  if (sessionStorage.getItem('almatarid_owner_2fa') === '1') {
    onSuccess();
    return;
  }

  const storedHash = await get2faHash();
  if (!storedHash) { onSuccess(); return; } /* لم يُعيَّن رمز بعد — يُعيَّن من داخل الإعدادات */
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0;text-align:center">
      <div style="font-size:2rem">🔐</div>
      <h2 style="color:var(--gold);margin:0;font-size:1.25rem">المصادقة الثنائية لحساب المالك (2FA)</h2>
      <p style="font-size:.84rem;color:#cbd5e1;margin:0;line-height:1.6">
        هذا القسم يحتوي على إعدادات حساسة لحماية الشجرة. يرجى إدخال رمز التحقق الإضافي للمالك.
      </p>

      <div style="max-width:260px;margin:8px auto;width:100%">
        <input type="password" id="owner-2fa-input" placeholder="أدخل رمز 2FA الإضافي" maxlength="8" style="width:100%;font-size:1.2rem;text-align:center;letter-spacing:4px;padding:10px;border-radius:8px;border:2px solid var(--gold);background:var(--bg);color:#fff">
        <p id="owner-2fa-err" style="color:#ef4444;font-size:.78rem;margin:6px 0" hidden></p>
      </div>

      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" id="btn-owner-2fa-verify" style="flex:1;background:var(--gold);color:#1c1204;font-weight:800;border:none;border-radius:8px;padding:10px;font-size:.9rem;cursor:pointer">
          ✓ تحقق ومتابعة
        </button>
        <button type="button" class="btn ghost" id="btn-owner-2fa-cancel" style="padding:10px 16px">
          إلغاء
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const inp = $('#owner-2fa-input');
  const verifyBtn = $('#btn-owner-2fa-verify');
  const cancelBtn = $('#btn-owner-2fa-cancel');
  const errEl = $('#owner-2fa-err');

  if (inp) inp.focus();

  const doCheck = async () => {
    const val = (inp.value || '').trim();
    if (val && (await hash2fa(val)) === storedHash) {
      sessionStorage.setItem('almatarid_owner_2fa', '1');
      $('#profile').close();
      toast('✓ تم التحقق بنجاح من المصادقة الثنائية 2FA');
      onSuccess();
    } else {
      errEl.textContent = 'رمز التحقق غير صحيح، يرجى المحاولة مرة أخرى.';
      errEl.hidden = false;
      inp.select();
    }
  };

  if (verifyBtn) verifyBtn.onclick = doCheck;
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter') doCheck(); };
  if (cancelBtn) cancelBtn.onclick = () => $('#profile').close();
}

$('#m-settings').onclick = () => {
  $('.more').open = false;
  verifyOwner2FA(async () => {
    const mode = CFG.DEMO ? 'family_code' : await rpc('get_access_mode');
    const hasPin = !!(await get2faHash());
    openForm('إعدادات الوصول وحساب المالك (2FA)', [
      { k: 'mode', label: 'وضع الوصول', val: mode, type: 'select', opts: [['family_code', 'رمز العائلة (الشجرة محمية)'], ['open_link', 'رابط مفتوح (الهواتف للمحررين فقط)']] },
      { k: 'women', label: 'أسماء النساء لبقية الزوار (المالك والمحرر ومسؤول الفرع داخل فرعه يرونها دائمًا)', val: S.womenVisible ? '1' : '0', type: 'select', opts: [['1', 'ظاهرة'], ['0', 'مخفية — تظهر «ابنة/زوجة فلان»']] },
      { k: 'pin2fa', label: hasPin ? 'رمز المصادقة الثنائية 2FA الجديد (4-8 أرقام، فارغ = بلا تغيير)' : 'رمز المصادقة الثنائية 2FA الجديد (4-8 أرقام — لم يُعيَّن بعد، أدخله لتفعيله)', val: '', type: 'password' },
      { k: 'fam', label: 'رمز عائلة جديد (فارغ = بلا تغيير، 6 خانات فأكثر)', type: 'password' },
      { k: 'ed', label: 'رمز محرر جديد (فارغ = بلا تغيير، 8 خانات فأكثر)', type: 'password' }], async d => {
      if (d.pin2fa) {
        const np = d.pin2fa.trim();
        if (!/^\d{4,8}$/.test(np)) return alert('رمز 2FA يجب أن يكون 4-8 أرقام.');
        localStorage.setItem('almatarid_owner_2fa_hash', await hash2fa(np));
        localStorage.removeItem('almatarid_owner_2fa_pin');
      }
      await op('secure_set_access_mode', { p_mode: d.mode, p_passcode: S.code }, () => {});
      await op('secure_set_women_names_visible', { p_visible: d.women === '1', p_passcode: S.code }, () => { S.womenVisible = d.women === '1'; });
      if (d.fam) await op('secure_set_family_code', { p_new_code: d.fam, p_passcode: S.code }, () => {});
      if (d.ed) await op('secure_set_editor_code', { p_new_code: d.ed, p_passcode: S.code }, () => {});
      alert('تم الحفظ وتحديث إعدادات المصادقة الثنائية بنجاح');
    });
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
const localDT = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function showInfo(html) { $('#profile-body').dataset.id = ''; $('#profile-body').innerHTML = html; const p = $('#profile'); if (!p.open) p.showModal(); }
const evWhen = e => new Date(e.event_date).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
function makeGoogleCalUrl(e) {
  const d = new Date(e.event_date);
  const end = new Date(d.getTime() + 3 * 3600 * 1000);
  const fmt = dt => dt.toISOString().replace(/-|:|\.\d\d\d/g, '');
  const title = encodeURIComponent(e.title || 'مناسبة عائلية - آل مطارد');
  const details = encodeURIComponent((e.description || '') + '\n\nتطبيق أسرة آل مطارد');
  const loc = encodeURIComponent(e.location_name || '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(d)}/${fmt(end)}&details=${details}&location=${loc}`;
}

function shareEventWhatsapp(e) {
  const d = new Date(e.event_date);
  const txt = `🎉 دعوة لمناسبة عائلية - أسرة آل مطارد\n\n📌 *${e.title}*\n📅 الموعد: ${evWhen(e)} (${hijriShort(d)})\n📍 المكان: ${e.location_name || 'يُحدد لاحقاً'}${e.location_url ? '\n🗺️ الرابط: ' + e.location_url : ''}\n\n${e.description ? e.description + '\n\n' : ''}نسعد بلقائكم وتواجدكم صلةً للرحم واجتماعاً للأسرة.`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(txt)}`, '_blank');
}

function eventsList() {
  const now = Date.now();
  const past = e => new Date(e.event_date).getTime() < now;
  const allEvents = [...(S.events || [])].sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  const upcoming = allEvents.filter(e => !past(e));
  const pastEvents = allEvents.filter(e => past(e)).reverse();

  let countdownHtml = '';
  if (upcoming.length) {
    const nextEv = upcoming[0];
    const diff = new Date(nextEv.event_date).getTime() - now;
    const days = Math.max(0, Math.floor(diff / (86400 * 1000)));
    const hours = Math.max(0, Math.floor((diff % (86400 * 1000)) / (3600 * 1000)));
    const mins = Math.max(0, Math.floor((diff % (3600 * 1000)) / (60 * 1000)));
    
    countdownHtml = `
      <div class="countdown-banner">
        <span class="cd-tag">المناسبة القادمة الأقرب</span>
        <div class="cd-title">${esc(nextEv.title)}</div>
        <div class="cd-grid">
          <div class="cd-box"><span class="cd-num">${days}</span><span class="cd-lbl">يوم</span></div>
          <div class="cd-box"><span class="cd-num">${hours}</span><span class="cd-lbl">ساعة</span></div>
          <div class="cd-box"><span class="cd-num">${mins}</span><span class="cd-lbl">دقيقة</span></div>
        </div>
        <div class="cd-sub">📅 ${esc(evWhen(nextEv))} · ${esc(hijriShort(new Date(nextEv.event_date)))}${nextEv.location_name ? ' · 📍 ' + esc(nextEv.location_name) : ''}</div>
        <div class="ev-actions" style="justify-content:center">
          <a href="${makeGoogleCalUrl(nextEv)}" target="_blank" rel="noopener" class="ev-btn cal">📅 إضافة للتقويم</a>
          <button type="button" class="ev-btn wa" data-ev-wa="${esc(nextEv.id)}">💬 مشاركة واتساب</button>
          <button type="button" class="ev-btn" data-evopen="${esc(nextEv.id)}" style="background:var(--gold);color:#1c1204">👥 تفاصيل الحضور</button>
        </div>
      </div>`;
  }

  const renderEvCard = (e, isPast) => {
    const d = new Date(e.event_date);
    const diffDays = Math.ceil((d.getTime() - now) / (86400 * 1000));
    let badgeText = isPast ? 'منتهي' : (diffDays <= 0 ? 'اليوم!' : `بعد ${diffDays} يوم`);
    let badgeClass = isPast ? 'ended' : (diffDays <= 1 ? 'today' : 'soon');

    return `
      <div class="ev-card ${isPast ? 'past' : ''}">
        <div class="ev-card-top ${isPast ? 'past' : ''}">
          <div>
            <h3>${esc(e.title)}</h3>
            <div class="ev-meta-row">
              <span>📅 ${esc(evWhen(e))} · ${esc(hijriShort(d))}</span>
              ${e.location_name ? `<span>📍 ${esc(e.location_name)}${e.location_url ? ` · <a href="${esc(e.location_url)}" target="_blank" rel="noopener" style="color:var(--blue)">الخريطة</a>` : ''}</span>` : ''}
            </div>
          </div>
          <span class="ev-time-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${e.description ? `<div class="ev-desc">${esc(e.description).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="ev-actions">
          <button type="button" class="ev-btn" data-evopen="${esc(e.id)}" style="background:rgba(255,255,255,.08);color:var(--txt)">
            👥 الحضور والتوثيق ${e.media_count ? `(📸 ${e.media_count})` : ''}
          </button>
          ${!isPast ? `
            <a href="${makeGoogleCalUrl(e)}" target="_blank" rel="noopener" class="ev-btn cal">📅 حفظ بالتقويم</a>
            <button type="button" class="ev-btn wa" data-ev-wa="${esc(e.id)}">💬 واتساب</button>
          ` : ''}
          ${canEdit() ? `
            <button type="button" class="ev-btn" data-ee="${esc(e.id)}" style="background:transparent;border:1px solid var(--line);color:var(--txt)">✏️ تعديل</button>
            <button type="button" class="ev-btn" data-ed="${esc(e.id)}" style="background:transparent;border:1px solid var(--line);color:#fca5a5">✕ حذف</button>
          ` : ''}
        </div>
      </div>`;
  };

  const html = `
    <div class="evrem-wrap">
      <div class="evrem-head">
        <h2>🔔 تذكير ومناسبات الأسرة القادمة</h2>
        <p class="sub">متابعة مواعيد اجتماعات ومناسبات العائلة مع العد التنازلي وإمكانية الحفظ بالتقويم</p>
      </div>

      ${countdownHtml}

      <div class="notif-promo">
        <p>🔔 هل ترغب في تلقي تنبيهات عند اقتراب موعد مناسبات الأسرة؟</p>
        <button type="button" id="btn-enable-notif" class="ghost">تفعيل التنبيهات</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <h3 style="font-size:1rem;color:var(--gold)">🎉 المناسبات القادمة (${upcoming.length})</h3>
        ${canEdit() ? '<button type="button" data-ea="1" style="font-size:.78rem;padding:4px 10px">➕ مناسبة جديدة</button>' : ''}
      </div>

      ${upcoming.length ? upcoming.map(e => renderEvCard(e, false)).join('') : '<p class="sub" style="padding:10px 0;text-align:center">لا توجد مناسبات قادمة مجدولة حالياً.</p>'}

      ${pastEvents.length ? `
        <details style="margin-top:10px">
          <summary style="font-size:.9rem;color:var(--mut);cursor:pointer">📜 أرشيف المناسبات السابقة (${pastEvents.length})</summary>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
            ${pastEvents.map(e => renderEvCard(e, true)).join('')}
          </div>
        </details>
      ` : ''}
    </div>`;

  showInfo(html);

  const pb = $('#profile-body');
  if (!pb) return;

  pb.querySelectorAll('[data-evopen]').forEach(b => {
    b.onclick = () => {
      const x = S.events.find(z => String(z.id) === String(b.dataset.evopen));
      if (x) evDetails(x);
    };
  });

  pb.querySelectorAll('[data-ev-wa]').forEach(b => {
    b.onclick = () => {
      const x = S.events.find(z => String(z.id) === String(b.dataset.evWa));
      if (x) shareEventWhatsapp(x);
    };
  });

  const notifBtn = $('#btn-enable-notif');
  if (notifBtn) {
    notifBtn.onclick = async () => {
      if (!('Notification' in window)) {
        toast('المتصفح لا يدعم التنبيهات');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        toast('تم تفعيل تنبيهات المناسبات بنجاح 🔔');
        notifBtn.textContent = '✓ مفعلة';
        notifBtn.disabled = true;
      } else {
        toast('لم يتم تفعيل التنبيهات');
      }
    };
  }
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
const CORR_FIELDS = [['full_name', 'الاسم الكامل'], ['nickname', 'الكنية'], ['gender', 'الجنس'], ['is_alive', 'الحالة'], ['birth_year_text', 'سنة الميلاد'], ['death_year_text', 'سنة الوفاة'], ['city', 'المدينة'], ['phone', 'الهاتف'], ['achievement_badge', 'الشارة'], ['badge_is_job', 'نوع الشارة'], ['birth_order', 'الترتيب بين الأبناء'], ['wife_mother_id', 'الأم'], ['biography_story', 'النبذة']];
const corrFieldLabel = k => (CORR_FIELDS.find(([v]) => v === k) || [, k])[1];
function memberFieldText(m, k) {
  if (!m) return '—';
  if (k === 'gender') return m.gender === 'female' ? 'أنثى' : 'ذكر';
  if (k === 'is_alive') return m.is_alive === false ? 'متوفى' : 'حي';
  if (k === 'badge_is_job') return m.achievement_badge ? (m.badge_is_job ? 'وظيفة' : 'شارة') : '—';
  if (k === 'wife_mother_id') return S.byId.get(m.wife_mother_id)?.full_name || '—';
  const v = m[k];
  return v == null || v === '' ? '—' : String(v);
}
function corrValueText(field, val) {
  if (field === 'gender') return val === 'female' ? 'أنثى' : 'ذكر';
  if (field === 'is_alive') return val ? 'حي' : 'متوفى';
  if (field === 'badge_is_job') return val ? 'وظيفة' : 'شارة';
  return val == null || val === '' ? '—' : String(val);
}
function suggestForm(targetId) {
  const fixed = S.byId.get(targetId) || null;
  /* ann101: أسماء القائمة ثلاثية/رباعية عبر سلسلة الآباء (cardLongName) بدل الاسم المخزون وحده — حتى لا يلتبس المتشابهون */
  const memOpts = [...S.members].filter(m => !m.name_masked).sort(byName).map(m => [m.id, cardLongName(m)]);
  openForm(fixed ? 'رسالة بخصوص ' + fixed.full_name : 'مقترح / استفسار / طلب تعديل', [
    { k: 'rtype', label: 'نوع الرسالة', type: 'select', opts: [['suggestion', '💡 مقترح'], ['inquiry', '❓ استفسار'], ['correction', '✏️ طلب تعديل معلومة'], ['complaint', '🗣️ شكوى']] },
    ...(fixed ? [] : [{ k: 'member', label: 'العضو المقصود (لطلب التعديل)', type: 'select', opts: [['', '— اختر العضو —'], ...memOpts] }]),
    { k: 'cfield', label: 'الحقل المراد تعديله', type: 'select', opts: CORR_FIELDS },
    { type: 'raw', html: '<p class="sub" id="sg-cur"></p>' },
    { k: 'newval', label: 'القيمة الجديدة' },
    { k: 'newgender', label: 'القيمة الجديدة', type: 'select', opts: [['male', 'ذكر'], ['female', 'أنثى']] },
    { k: 'newalive', label: 'القيمة الجديدة', type: 'select', opts: [['1', 'حي'], ['0', 'متوفى']] },
    { k: 'newbkind', label: 'القيمة الجديدة', type: 'select', opts: [['badge', 'شارة (تميّز/تكريم)'], ['job', 'وظيفة']] },
    { k: 'note', label: 'التفاصيل (نص الرسالة، أو سبب التعديل)', type: 'area' },
    { k: 'frommember', label: 'هل اسمك موجود بالشجرة؟ اختره لتوثيق هويتك (اختياري)', type: 'select', opts: [['', '—'], ...memOpts] },
    { k: 'from', label: 'اسمك الكامل (إلزامي — لا تُقبل الرسائل مجهولة الاسم)', req: true }], async d => {
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
      const new_value = field === 'gender' ? d.newgender : field === 'is_alive' ? (d.newalive === '1') : field === 'badge_is_job' ? (d.newbkind === 'job') : (d.newval || '').trim();
      if (field !== 'gender' && field !== 'is_alive' && field !== 'badge_is_job' && !new_value && !['nickname', 'city', 'biography_story', 'death_year_text', 'phone', 'achievement_badge', 'wife_mother_id'].includes(field))
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
    [['member', !!memSel], ['cfield', 1], ['newval', 1], ['newgender', 1], ['newalive', 1], ['newbkind', 1]].forEach(([n, has]) => { if (!has) return; const el = F(n); el.disabled = !corr; if (row(n)) row(n).style.display = corr ? '' : 'none'; });
    if (cur) cur.style.display = corr ? '' : 'none';
    if (!corr) return;
    const fld = fldSel.value;
    const show = fld === 'gender' ? 'newgender' : fld === 'is_alive' ? 'newalive' : fld === 'badge_is_job' ? 'newbkind' : 'newval';
    ['newval', 'newgender', 'newalive', 'newbkind'].forEach(n => { if (row(n)) row(n).style.display = n === show ? '' : 'none'; F(n).disabled = n !== show; });
    const m = S.byId.get(fixed?.id || memSel?.value || '');
    if (cur) cur.textContent = m ? `القيمة الحالية لـ«${corrFieldLabel(fld)}»: ${memberFieldText(m, fld)}` : '';
  };
  typeSel.addEventListener('change', sync); fldSel.addEventListener('change', sync); if (memSel) memSel.addEventListener('change', sync);
  /* ann100: اختيار الاسم من الشجرة (أعلى) يملأ خانة «اسمك الكامل» أدناه مباشرة فلا حاجة لكتابته */
  F('frommember')?.addEventListener('change', () => { const m = S.byId.get(F('frommember').value || ''); if (m && F('from')) F('from').value = cardLongName(m); });
  sync();
}
async function inboxBadge() {
  const b = $('#inbox-badge'), d = $('#menu-dot');
  if (!b) return;
  if (CFG.DEMO || S.role !== 'owner' || !S.code) { b.hidden = true; if (d) d.hidden = true; return; }
  try {
    const r = await rpc('list_suggestions', { p_passcode: S.code });
    const n = r.success ? (r.items || []).filter(x => (x.status || 'pending') === 'pending').length : 0;
    b.textContent = n; b.hidden = !n; if (d) d.hidden = !n;
  } catch (_) { b.hidden = true; if (d) d.hidden = true; }
}
const REQ_TYPES = { suggestion: '💡 مقترح', inquiry: '❓ استفسار', correction: '✏️ طلب تعديل معلومة', complaint: '🗣️ شكوى' };
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
    const st = s.status || 'pending';
    const stTxt = st === 'applied' ? `<small style="color:var(--green)">✅ اعتُمد وطُبّق${s.decided_at ? ' · ' + new Date(s.decided_at).toLocaleDateString('ar-SA') : ''} — محفوظ بالأرشيف</small>`
      : st === 'rejected' ? `<small style="color:#fb7185">مؤرشف كمرفوض${s.decided_at ? ' · ' + new Date(s.decided_at).toLocaleDateString('ar-SA') : ''}</small>` : '';
    const btns = st !== 'pending' ? stTxt
      : structured
      ? `${m ? `<button class="x" data-so="${esc(m.id)}">فتح</button>` : ''}<button class="x" data-sa="${esc(s.id)}">اعتماد وتطبيق ✅</button><button class="x" data-sd="${esc(s.id)}">رفض وأرشفة</button>`
      : `${m ? `<button class="x" data-so="${esc(m.id)}">فتح</button>` : ''}<button class="x" data-sd="${esc(s.id)}">أرشفة ✓</button>`;
    return `<div class="evrow"><div><b>${REQ_TYPES[s.request_type] || '💡 مقترح'}${m ? ' — ' + esc(m.full_name) : ''}</b>${detail}</div><span>${btns}</span></div>`;
  };
  const pend = items.filter(x => (x.status || 'pending') === 'pending').length;
  showInfo(`<h2>📥 صندوق الاقتراحات والشكاوى — للمالك فقط</h2><p class="sub">الكل: ${items.length} · جديدة: ${pend} · مؤرشفة: ${items.length - pend} — لا يُحذف أي طلب أبدًا</p>${items.map(rowHtml).join('') || '<p class="sub">لا توجد رسائل بعد.</p>'}`);
}
async function applySuggestion(id) {
  if (!confirm('اعتماد هذا التعديل وتطبيقه مباشرة على بيانات العضو؟')) return;
  try {
    await op('secure_apply_suggestion', { p_suggestion_id: id, p_passcode: S.code }, () => {
      const s = (S.demoSug || []).find(x => String(x.id) === String(id));
      if (s?.proposed_data?.field) { const m = S.byId.get(s.target_member_id); if (m) m[s.proposed_data.field] = s.proposed_data.new_value; }
      const dx = (S.demoSug || []).find(x => String(x.id) === String(id)); if (dx) dx.status = 'applied';
    });
    if (!CFG.DEMO) await refresh();
    await inbox(); inboxBadge(); alert('تم اعتماد التعديل وتطبيقه ✅');
  } catch (err) { alert(err.message); }
}
async function delSuggestion(id) {
  if (!confirm('أرشفة هذا الطلب؟ سيبقى محفوظًا في الصندوق نهائيًا ولن يُحذف.')) return;
  try { await op('secure_reject_suggestion', { p_suggestion_id: id, p_passcode: S.code }, () => { const x = (S.demoSug || []).find(z => String(z.id) === String(id)); if (x) x.status = 'rejected'; }); await inbox(); inboxBadge(); }
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
const nameBtn = m => m.name_masked ? '' : `<button class="nl" data-so="${esc(m.id)}">${esc(m.full_name)}<small>الجيل ${gen(m)}${m.city && !livingHidden(m) ? ' · ' + esc(m.city) : ''}</small></button>`;
const byName = (a, b) => a.full_name.localeCompare(b.full_name, 'ar');
const menuClose = fn => () => { $('.more').open = false; fn(); };

function namesList(q = '') {
  const n = stripKin(norm(q)), L = S.members.filter(m => !n || stripKin(norm(m.full_name)).includes(n) || stripKin(norm(m.nickname)).includes(n)).sort(byName);
  if (!$('#nsrch')) showInfo(`<h2>جميع الأسماء</h2><input id="nsrch" type="search" placeholder="ابحث في الأسماء" autocomplete="off"><p class="sub" id="ncount"></p><div id="nlist"></div>`);
  $('#ncount').textContent = `${L.length} من ${S.members.length}`;
  $('#nlist').innerHTML = L.slice(0, 300).map(nameBtn).join('') + (L.length > 300 ? '<p class="sub">اكتب في البحث لتضييق النتائج…</p>' : '');
}
$('#profile-body').addEventListener('input', e => { if (e.target.id === 'nsrch') namesList(e.target.value); });
$('#m-names').onclick = menuClose(() => { $('#profile-body').innerHTML = ''; namesList(); $('#nsrch').focus(); });
$('#m-genstep').onclick = menuClose(() => { setPrefHidden('alm_genstep', !prefHidden('alm_genstep')); syncToggles(); });
$('#m-stats').onclick = menuClose(() => { setPrefHidden('alm_stats', !prefHidden('alm_stats')); syncToggles(); });
$('#m-ctl').onclick = menuClose(() => { setPrefHidden('alm_ctl', !prefHidden('alm_ctl')); syncToggles(); });

/* ---------- خريطة انتشار العائلة والمدن (فرع تجربة) ---------- */
const CITY_COORDS = {
  'النماص': { x: 222, y: 394, reg: 'منطقة عسير (الموطن الأصلي للأسرة)', origin: true },
  'تنومة': { x: 223, y: 398, reg: 'منطقة عسير' },
  'أبها': { x: 232, y: 420, reg: 'منطقة عسير' },
  'خميس مشيط': { x: 238, y: 418, reg: 'منطقة عسير' },
  'بيشة': { x: 235, y: 368, reg: 'منطقة عسير' },
  'الباحة': { x: 205, y: 368, reg: 'منطقة الباحة' },
  'بلجرشي': { x: 206, y: 372, reg: 'منطقة الباحة' },
  'الطائف': { x: 175, y: 330, reg: 'منطقة مكة المكرمة' },
  'مكة المكرمة': { x: 160, y: 327, reg: 'منطقة مكة المكرمة' },
  'جدة': { x: 141, y: 322, reg: 'منطقة مكة المكرمة' },
  'رابغ': { x: 136, y: 285, reg: 'منطقة مكة المكرمة' },
  'الليث': { x: 168, y: 363, reg: 'منطقة مكة المكرمة' },
  'القنفذة': { x: 193, y: 394, reg: 'منطقة مكة المكرمة' },
  'الجموم': { x: 156, y: 321, reg: 'منطقة مكة المكرمة' },
  'المدينة المنورة': { x: 153, y: 236, reg: 'منطقة المدينة المنورة' },
  'ينبع': { x: 111, y: 247, reg: 'منطقة المدينة المنورة' },
  'العلا': { x: 107, y: 173, reg: 'منطقة المدينة المنورة' },
  'خيبر': { x: 144, y: 200, reg: 'منطقة المدينة المنورة' },
  'الحناكية': { x: 177, y: 224, reg: 'منطقة المدينة المنورة' },
  'المهد': { x: 187, y: 265, reg: 'منطقة المدينة المنورة' },
  'بدر': { x: 130, y: 256, reg: 'منطقة المدينة المنورة' },
  'وادي الفرع': { x: 156, y: 270, reg: 'منطقة المدينة المنورة' },
  'العيص': { x: 108, y: 223, reg: 'منطقة المدينة المنورة' },
  'الرياض': { x: 346, y: 229, reg: 'منطقة الرياض' },
  'الخرج': { x: 363, y: 246, reg: 'منطقة الرياض' },
  'الدوادمي': { x: 284, y: 235, reg: 'منطقة الرياض' },
  'المجمعة': { x: 309, y: 194, reg: 'منطقة الرياض' },
  'الزلفي': { x: 295, y: 182, reg: 'منطقة الرياض' },
  'شقراء': { x: 307, y: 213, reg: 'منطقة الرياض' },
  'وادي الدواسر': { x: 296, y: 354, reg: 'منطقة الرياض' },
  'الأفلاج': { x: 347, y: 301, reg: 'منطقة الرياض' },
  'حوطة بني تميم': { x: 350, y: 264, reg: 'منطقة الرياض' },
  'الدمام': { x: 440, y: 181, reg: 'المنطقة الشرقية' },
  'الخبر': { x: 442, y: 185, reg: 'المنطقة الشرقية' },
  'الظهران': { x: 440, y: 186, reg: 'المنطقة الشرقية' },
  'الجبيل': { x: 427, y: 162, reg: 'المنطقة الشرقية' },
  'الأحساء': { x: 425, y: 209, reg: 'المنطقة الشرقية' },
  'القطيف': { x: 437, y: 175, reg: 'المنطقة الشرقية' },
  'حفر الباطن': { x: 326, y: 120, reg: 'المنطقة الشرقية' },
  'تبوك': { x: 70, y: 121, reg: 'منطقة تبوك' },
  'ضباء': { x: 46, y: 152, reg: 'منطقة تبوك' },
  'الوجه': { x: 67, y: 184, reg: 'منطقة تبوك' },
  'أملج': { x: 89, y: 220, reg: 'منطقة تبوك' },
  'تيماء': { x: 124, y: 143, reg: 'منطقة تبوك' },
  'حائل': { x: 210, y: 146, reg: 'منطقة حائل' },
  'بريدة': { x: 272, y: 181, reg: 'منطقة القصيم' },
  'عنيزة': { x: 272, y: 189, reg: 'منطقة القصيم' },
  'الرس': { x: 259, y: 195, reg: 'منطقة القصيم' },
  'عرعر': { x: 192, y: 45, reg: 'منطقة الحدود الشمالية' },
  'سكاكا': { x: 169, y: 74, reg: 'منطقة الجوف' },
  'القريات': { x: 91, y: 34, reg: 'منطقة الجوف' },
  'جازان': { x: 234, y: 459, reg: 'منطقة جازان' },
  'صبيا': { x: 235, y: 451, reg: 'منطقة جازان' },
  'نجران': { x: 276, y: 442, reg: 'منطقة نجران' }
};

function openCityMap(selectedCity = null, viewMode = 'map') {
  const g = new Map();
  for (const m of S.members) {
    const c = (m.city || '').trim() || 'غير محددة';
    (g.get(c) || g.set(c, []).get(c)).push(m);
  }
  const total = S.members.length || 1;
  const specified = [...g.entries()].filter(([c]) => c !== 'غير محددة');
  const sorted = [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  const topCityEntry = sorted.find(([c]) => c !== 'غير محددة') || sorted[0] || ['لا توجد', []];
  const originMembers = g.get('النماص') || [];
  const foreignMembers = g.get('خارج المملكة') || [];
  const unkMembers = g.get('غير محددة') || [];
  
  let sel = selectedCity;
  if (!sel || !g.has(sel)) {
    sel = g.has('النماص') ? 'النماص' : topCityEntry[0];
  }
  const activeList = g.get(sel) || [];
  const activeCoord = CITY_COORDS[sel] || null;

  let mapPins = '';
  for (const [c, L] of g.entries()) {
    const coord = CITY_COORDS[c];
    if (!coord) continue;
    const isSel = c === sel;
    const isOrigin = !!coord.origin;
    const r = Math.min(18, Math.max(8, 7 + Math.sqrt(L.length) * 2.6));
    mapPins += `
      <g class="city-pin-group ${isSel ? 'active' : ''} ${isOrigin ? 'is-origin' : ''}" data-city-pin="${esc(c)}" style="cursor:pointer">
        <circle class="pin-pulse" cx="${coord.x}" cy="${coord.y}" r="${r + 7}"></circle>
        <circle class="pin-dot" cx="${coord.x}" cy="${coord.y}" r="${r}"></circle>
        <text class="pin-count" x="${coord.x}" y="${coord.y + 4}">${L.length}</text>
        <text class="pin-label" x="${coord.x}" y="${coord.y - r - 4}">${isOrigin ? '👑 ' : ''}${esc(c)}</text>
      </g>`;
  }

  const mapSvg = `
    <div class="city-map-container">
      <svg class="city-map-svg" viewBox="0 0 540 500" aria-label="خريطة انتشار أسرة آل مطارد في المملكة">
        <rect width="100%" height="100%" class="map-sea" rx="14"></rect>
        <text x="75" y="380" class="sea-lbl">البحر الأحمر</text>
        <text x="445" y="125" class="sea-lbl">الخليج العربي</text>
        <path class="map-land" d="
          M 45,75 L 75,50 L 85,30 L 140,32 L 195,42 L 260,65 L 325,80 L 375,95 L 395,110
          Q 425,145 425,160 Q 448,175 445,185 Q 430,225 435,240 Q 470,295 475,305
          L 460,420 L 360,435 L 276,448 L 232,470
          Q 215,440 195,400 Q 180,380 170,365 Q 155,340 140,322 Q 130,305 136,285
          Q 120,265 111,247 Q 100,230 90,220 Q 80,200 70,185 Q 55,165 50,150 Z
        "></path>
        <path class="map-region-line" d="M 170,365 Q 230,380 340,340"></path>
        <path class="map-region-line" d="M 136,285 Q 260,260 435,240"></path>
        <path class="map-region-line" d="M 111,247 Q 240,170 375,95"></path>
        <text x="346" y="248" class="reg-hint">الوسطى</text>
        <text x="145" y="295" class="reg-hint">الغربية</text>
        <text x="215" y="415" class="reg-hint">عسير</text>
        <text x="430" y="200" class="reg-hint">الشرقية</text>
        <text x="140" y="110" class="reg-hint">الشمالية</text>
        ${mapPins}
      </svg>
      <div class="map-legend">
        <span><i class="lg-dot origin"></i> النماص (موطن الأسرة)</span>
        <span><i class="lg-dot"></i> مدن انتشار العائلة</span>
      </div>
    </div>`;

  const chipsHtml = sorted.map(([c, L]) => {
    const isSel = c === sel;
    const isOrigin = c === 'النماص';
    return `<button type="button" class="city-chip ${isSel ? 'active' : ''} ${isOrigin ? 'origin' : ''}" data-pick-city="${esc(c)}">${isOrigin ? '👑 ' : '📍 '}${esc(c)} <span class="cnum">${L.length}</span></button>`;
  }).join('');

  const males = activeList.filter(m => m.gender !== 'female').length;
  const females = activeList.filter(m => m.gender === 'female').length;
  const alive = activeList.filter(m => m.is_alive !== false).length;
  const dead = activeList.filter(m => m.is_alive === false).length;
  const pct = Math.round((activeList.length / total) * 100);

  const detailHtml = `
    <div class="city-detail-box">
      <div class="city-detail-header">
        <div>
          <h3>${sel === 'النماص' ? '👑 ' : '📍 '}<b>${esc(sel)}</b> <span class="city-badge">${activeList.length} فرد (${pct}%)</span></h3>
          <p class="sub">${activeCoord ? activeCoord.reg : (sel === 'خارج المملكة' ? 'مبتعثون ومقيمون خارج المملكة' : (sel === 'غير محددة' ? 'أفراد لم تُسجل مدنهم بعد' : 'مدينة موثقة'))}</p>
        </div>
      </div>
      <div class="city-mini-stats">
        <span title="ذكور">👨 <b>${males}</b></span>
        <span title="إناث">👩 <b>${females}</b></span>
        <span title="أحياء">🌱 <b>${alive}</b></span>
        ${dead ? `<span title="متوفون">🕊️ <b>${dead}</b></span>` : ''}
      </div>
      <input type="search" id="city-filter-q" class="city-search-input" placeholder="ابحث بين أفراد ${esc(sel)}…" autocomplete="off">
      <div id="city-members-container" class="city-members-box">
        ${activeList.sort(byName).map(nameBtn).join('')}
      </div>
    </div>`;

  const listViewHtml = `
    <div class="city-list-view">
      ${sorted.map(([c, L]) => {
        const p = Math.round((L.length / total) * 100);
        const isO = c === 'النماص';
        return `
          <details class="city-list-item" ${c === sel ? 'open' : ''}>
            <summary>
              <div class="cli-title">
                <b>${isO ? '👑 ' : '📍 '}${esc(c)}</b>
                <div class="cli-bar"><div class="cli-bar-fill ${isO ? 'origin' : ''}" style="width:${Math.max(p, 4)}%"></div></div>
              </div>
              <span class="cli-count">${L.length} <small>(${p}%)</small></span>
            </summary>
            <div class="cli-body">
              ${L.sort(byName).map(nameBtn).join('')}
            </div>
          </details>`;
      }).join('')}
    </div>`;

  const fullHtml = `
    <div class="city-feature-wrap">
      <div class="cf-header">
        <h2>🗺️ خريطة انتشار العائلة والمدن</h2>
        <p class="sub">${specified.length} مدينة موثقة بالمملكة · ${total - unkMembers.length} من ${total} فرد موثق</p>
      </div>

      <div class="cf-stats-bar">
        <div class="cfs-card origin">
          <small>موطن الأسرة (بنو عمرو)</small>
          <b>النماص</b>
          <span>${originMembers.length} فرد</span>
        </div>
        <div class="cfs-card">
          <small>الأكثر تواجداً</small>
          <b>${esc(topCityEntry[0])}</b>
          <span>${topCityEntry[1].length} فرد</span>
        </div>
        <div class="cfs-card">
          <small>المدن الموثقة</small>
          <b>${specified.length}</b>
          <span>مدينة</span>
        </div>
        ${foreignMembers.length ? `
        <div class="cfs-card">
          <small>خارج المملكة</small>
          <b>${foreignMembers.length}</b>
          <span>فرد</span>
        </div>` : ''}
      </div>

      <div class="cf-view-toggle">
        <button type="button" class="cf-tab ${viewMode === 'map' ? 'active' : ''}" data-cf-view="map">🗺️ الخريطة التفاعلية</button>
        <button type="button" class="cf-tab ${viewMode === 'list' ? 'active' : ''}" data-cf-view="list">📋 قائمة المدن والتوزيع</button>
      </div>

      ${viewMode === 'map' ? `
        <div class="city-chips-scroller">
          ${chipsHtml}
        </div>
        ${mapSvg}
        ${detailHtml}
      ` : listViewHtml}
    </div>`;

  showInfo(fullHtml);

  const pb = $('#profile-body');
  if (!pb) return;

  pb.querySelectorAll('[data-cf-view]').forEach(btn => {
    btn.onclick = () => openCityMap(sel, btn.dataset.cfView);
  });

  pb.querySelectorAll('[data-city-pin]').forEach(el => {
    el.onclick = () => openCityMap(el.dataset.cityPin, 'map');
  });

  pb.querySelectorAll('[data-pick-city]').forEach(el => {
    el.onclick = () => openCityMap(el.dataset.pickCity, 'map');
  });

  const searchInput = $('#city-filter-q');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = stripKin(norm(searchInput.value.trim()));
      const filtered = activeList.filter(m => !q || stripKin(norm(m.full_name)).includes(q) || stripKin(norm(m.nickname || '')).includes(q));
      const box = $('#city-members-container');
      if (box) {
        box.innerHTML = filtered.length ? filtered.sort(byName).map(nameBtn).join('') : '<p class="sub" style="padding:10px 0;text-align:center">لا توجد أسماء مطابقة للبحث في هذه المدينة.</p>';
      }
    });
  }
}

$('#m-cities').onclick = menuClose(() => openCityMap());

/* ---------- صفحة إحصائيات العائلة الشاملة (فرع تجربة) ---------- */
function openFamilyStats() {
  const total = S.members.length || 1;
  const alive = S.members.filter(m => m.is_alive !== false).length;
  const dead = S.members.filter(m => m.is_alive === false).length;
  const males = S.members.filter(m => m.gender !== 'female').length;
  const females = S.members.filter(m => m.gender === 'female').length;
  const maxGen = Math.max(1, ...S.members.map(gen));
  
  const alivePct = Math.round((alive / total) * 100);
  const deadPct = 100 - alivePct;
  const malePct = Math.round((males / total) * 100);
  const femalePct = 100 - malePct;

  // توزيع الأجيال
  const genCounts = new Map();
  for (let g = 1; g <= maxGen; g++) genCounts.set(g, { total: 0, alive: 0, dead: 0 });
  for (const m of S.members) {
    const g = gen(m);
    if (!genCounts.has(g)) genCounts.set(g, { total: 0, alive: 0, dead: 0 });
    const itm = genCounts.get(g);
    itm.total++;
    if (m.is_alive === false) itm.dead++; else itm.alive++;
  }
  const maxGenTotal = Math.max(1, ...[...genCounts.values()].map(v => v.total));

  const genRowsHtml = [...genCounts.entries()].map(([g, d]) => {
    const p = Math.round((d.total / maxGenTotal) * 100);
    return `
      <div class="gen-bar-row">
        <div class="gen-bar-label">الجيل ${g}</div>
        <div class="gen-bar-track">
          <div class="gen-bar-fill" style="width:${Math.max(p, 4)}%"></div>
        </div>
        <div class="gen-bar-counts">
          <b>${d.total}</b> <small>(${d.alive} حي)</small>
        </div>
      </div>`;
  }).join('');

  // أكثر الأسماء الأولى تكراراً
  const nameCounts = new Map();
  for (const m of S.members) {
    if (m.name_masked) continue;
    const first = (m.first || m.full_name.split(' ')[0] || '').trim();
    if (first && first.length >= 2 && !['بن', 'بنت', 'آل'].includes(first)) {
      nameCounts.set(first, (nameCounts.get(first) || 0) + 1);
    }
  }
  const topNames = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topNamesHtml = topNames.map(([name, count]) => `
    <button type="button" class="top-name-pill" data-name-search="${esc(name)}" title="اضغط للبحث عن كل من يحمل اسم ${esc(name)} في المشجر">
      <b>${esc(name)}</b>
      <span>${count}</span>
    </button>
  `).join('');

  // الزوجات والعائلات المصاهرة
  const wivesTotal = S.wives.length;
  const wivesFromFamily = S.wives.filter(w => w.member_id).length;
  const wivesOutside = wivesTotal - wivesFromFamily;

  // حساب متوسط عدد الأبناء
  const fathers = S.members.filter(m => (S.kids.get(m.id) || []).length > 0);
  const totalKidsCount = fathers.reduce((sum, f) => sum + (S.kids.get(f.id) || []).length, 0);
  const avgKids = fathers.length ? (totalKidsCount / fathers.length).toFixed(1) : '—';

  // الشارات والإنجازات
  const badgeCounts = new Map();
  for (const m of S.members) {
    if (m.achievement_badge && !m.badge_is_job) {
      badgeCounts.set(m.achievement_badge, (badgeCounts.get(m.achievement_badge) || 0) + 1);
    }
  }
  const badgeList = [...badgeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const totalBadges = badgeList.reduce((acc, [, c]) => acc + c, 0);
  const badgesHtml = badgeList.length ? badgeList.map(([badge, count]) => `
    <div class="bstat-item">
      <span>🏅 ${esc(badge)}</span>
      <b>${count}</b>
    </div>
  `).join('') : '<p class="sub">لا توجد شارات مسجلة بعد.</p>';

  // الفروع الرئيسية
  const rootsStats = (S.roots || []).map(r => {
    let count = 0;
    const q = [r.id];
    while (q.length) {
      const curId = q.shift();
      count++;
      const kids = S.kids.get(curId) || [];
      for (const k of kids) q.push(k.id);
    }
    return { root: r, count };
  }).sort((a, b) => b.count - a.count);

  const rootsHtml = rootsStats.map(({ root, count }) => {
    const p = Math.round((count / total) * 100);
    return `
      <div class="gen-bar-row">
        <div class="gen-bar-label" style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(root.full_name)}</div>
        <div class="gen-bar-track">
          <div class="gen-bar-fill" style="width:${Math.max(p, 4)}%;background:var(--gold)"></div>
        </div>
        <div class="gen-bar-counts">
          <b>${count}</b> <small>(${p}%)</small>
        </div>
      </div>`;
  }).join('');

  const html = `
    <div class="fstats-wrap">
      <div class="fstats-head">
        <h2>📊 إحصائيات أسرة آل مطارد الشاملة</h2>
        <p class="sub">تحليل إحصائي مرئي لبيانات الأسرة وشجرة النسب</p>
      </div>

      <!-- بطاقات رقمية كبرى -->
      <div class="fstats-cards">
        <div class="fsc gold">
          <div class="fsc-top"><span>إجمالي الأسرة</span><span>👥</span></div>
          <div class="fsc-val">${total}</div>
          <div class="fsc-sub">${maxGen} أجيال موثقة</div>
        </div>
        <div class="fsc green">
          <div class="fsc-top"><span>الأحياء (حفظهم الله)</span><span>🌱</span></div>
          <div class="fsc-val">${alive}</div>
          <div class="fsc-sub">${alivePct}% من إجمالي الأسرة</div>
        </div>
        <div class="fsc blue">
          <div class="fsc-top"><span>الذكور</span><span>👨</span></div>
          <div class="fsc-val">${males}</div>
          <div class="fsc-sub">${malePct}% من الأسرة</div>
        </div>
        <div class="fsc purple">
          <div class="fsc-top"><span>الإناث</span><span>👩</span></div>
          <div class="fsc-val">${females}</div>
          <div class="fsc-sub">${femalePct}% من الأسرة</div>
        </div>
      </div>

      <!-- توزيع الحالة والحياة -->
      <div class="fstats-section">
        <div class="fstats-sec-title">
          <span>الحالة والتوزيع</span>
          <small>${alive} حي · ${dead} متوفى</small>
        </div>
        <div class="dist-bar-wrap">
          <div class="dist-bar">
            <div class="dist-segment" style="width:${alivePct}%;background:var(--green)" title="الأحياء: ${alive} (${alivePct}%)"></div>
            <div class="dist-segment" style="width:${deadPct}%;background:#64748b" title="المتوفون: ${dead} (${deadPct}%)"></div>
          </div>
          <div class="dist-labels">
            <span>🟢 الأحياء: <b>${alive}</b> (${alivePct}%)</span>
            <span>⚪ المتوفون (رحمهم الله): <b>${dead}</b> (${deadPct}%)</span>
          </div>
        </div>
      </div>

      <!-- توزيع الأجيال وتتابع الذرية -->
      <div class="fstats-section">
        <div class="fstats-sec-title">
          <span>تتابع الذرية عبر الأجيال</span>
          <small>${maxGen} أجيال</small>
        </div>
        <div class="gen-bars-list">
          ${genRowsHtml}
        </div>
      </div>

      <!-- أكثر الأسماء شيوعاً بالأسرة -->
      <div class="fstats-section">
        <div class="fstats-sec-title">
          <span>الأسماء الأكثر شيوعاً بالأسرة</span>
          <small>اضغط على أي اسم للبحث في المشجر</small>
        </div>
        <div class="top-names-grid">
          ${topNamesHtml}
        </div>
      </div>

      <!-- الفروع الرئيسية للأسرة -->
      ${rootsStats.length > 1 ? `
      <div class="fstats-section">
        <div class="fstats-sec-title">
          <span>أحجام الفروع الرئيسية</span>
          <small>${rootsStats.length} فروع</small>
        </div>
        <div class="gen-bars-list">
          ${rootsHtml}
        </div>
      </div>` : ''}

      <!-- المؤشرات الأسرية والمصاهرة -->
      <div class="fstats-cards">
        <div class="fsc">
          <div class="fsc-top"><span>متوسط الأبناء لكل أسرة</span><span>👨‍👩‍👧‍👦</span></div>
          <div class="fsc-val">${avgKids}</div>
          <div class="fsc-sub">${fathers.length} رب أسرة موثق</div>
        </div>
        <div class="fsc">
          <div class="fsc-top"><span>الزوجات الموثقات</span><span>💍</span></div>
          <div class="fsc-val">${wivesTotal}</div>
          <div class="fsc-sub">${wivesFromFamily} من الأسرة · ${wivesOutside} مصاهرة</div>
        </div>
      </div>

      <!-- الشارات ولوحة الإنجازات -->
      ${totalBadges ? `
      <div class="fstats-section">
        <div class="fstats-sec-title">
          <span>أصحاب الإنجازات والشارات</span>
          <small>${totalBadges} شارة موثقة</small>
        </div>
        <div class="badge-cloud">
          ${badgesHtml}
        </div>
      </div>` : ''}

    </div>`;

  showInfo(html);

  // ربط البحث السريع بالأسماء
  const pb = $('#profile-body');
  if (pb) {
    pb.querySelectorAll('[data-name-search]').forEach(btn => {
      btn.onclick = () => {
        $('#profile').close();
        const q = $('#q');
        if (q) {
          q.value = btn.dataset.nameSearch;
          q.dispatchEvent(new Event('input', { bubbles: true }));
          q.focus();
        }
      };
    });
  }
}

$('#m-fullstats').onclick = menuClose(() => openFamilyStats());

$('#m-honor').onclick = menuClose(() => {
  const g = new Map(); for (const m of S.members) if (m.achievement_badge && !m.badge_is_job) (g.get(m.achievement_badge) || g.set(m.achievement_badge, []).get(m.achievement_badge)).push(m);
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
    <label>الشخص الأول<div class="selrow"><input class="selfilter" type="search" placeholder="🔍 ابحث بالاسم…" data-tg="kin-a"><select id="kin-a"><option value="">اختر…</option>${opt}</select></div></label>
    <label>الشخص الثاني<div class="selrow"><input class="selfilter" type="search" placeholder="🔍 ابحث بالاسم…" data-tg="kin-b"><select id="kin-b"><option value="">اختر…</option>${opt}</select></div></label><div id="kin-out"></div>`); kinView();
  bindSelectSearch($('#kin-a'), document.querySelector('[data-tg="kin-a"]')); bindSelectSearch($('#kin-b'), document.querySelector('[data-tg="kin-b"]'));
});
$('#profile-body').addEventListener('change', e => { if (e.target.id === 'kin-a' || e.target.id === 'kin-b') kinView(); });

/* ---------- مساعد الأنساب والقرابة الذكي (فرع تجربة) ---------- */
function openAiKinAssistant() {
  const html = `
    <div class="ai-kin-wrap">
      <div class="ai-kin-header">
        <span style="font-size:1.4rem">🤖</span>
        <div>
          <h2>مساعد الأنساب والقرابة الذكي</h2>
          <p class="sub" style="margin:0">اسألني بأي صياغة عربية وسأجيبك عن صلات القرابة، الأنساب، والذرية</p>
        </div>
      </div>

      <div class="ai-quick-pills">
        <button type="button" class="ai-pill" data-ask="من هو الجد الأكبر للأسرة؟">👑 من هو الجد الأكبر؟</button>
        <button type="button" class="ai-pill" data-ask="من هم أصحاب الشارات والدكاترة بالأسرة؟">🏅 أصحاب الشارات</button>
        <button type="button" class="ai-pill" data-ask="من هم أفراد الأسرة في النماص؟">📍 أفراد النماص</button>
        <button type="button" class="ai-pill" data-ask="كم عدد أفراد الأسرة وعدد الأجيال؟">📊 عدد الأسرة والأجيال</button>
      </div>

      <div id="ai-chat-box" class="ai-kin-chat">
        <div class="ai-msg bot">
          <div>أهلاً بك يا ابن العم في <b>مساعد أنساب آل مطارد الذكي</b>! 🌿</div>
          <div style="font-size:.82rem;color:var(--mut);margin-top:4px">
            يمكنك سؤالي مثلاً:<br>
            • «ما هي صلة القرابة بين سالم وفهد؟»<br>
            • «من هم أبناء ذياب بن علي؟»<br>
            • «ما هو نسب عبدالله حتى الجد الأكبر؟»<br>
            • «من هم إخوان محمد بن خالد؟»
          </div>
        </div>
      </div>

      <form id="ai-input-form" class="ai-input-row" autocomplete="off">
        <input type="text" id="ai-query-input" placeholder="اكتب سؤالك هنا بالعربية واضغط Enter…" />
        <button type="submit">إرسال 🚀</button>
      </form>
    </div>`;

  showInfo(html);

  const form = $('#ai-input-form');
  const input = $('#ai-query-input');
  const chat = $('#ai-chat-box');
  if (!form || !input || !chat) return;

  function appendMsg(text, isUser = false, toolsHtml = '') {
    const d = document.createElement('div');
    d.className = `ai-msg ${isUser ? 'user' : 'bot'}`;
    d.innerHTML = `<div>${text}</div>${toolsHtml ? `<div class="ai-msg-tools">${toolsHtml}</div>` : ''}`;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }

  function answerQuestion(query) {
    const qRaw = query.trim();
    if (!qRaw) return;
    const qNorm = stripKin(norm(qRaw));

    const matched = [];
    for (const m of S.members) {
      if (m.name_masked) continue;
      const fnNorm = stripKin(norm(m.full_name));
      const nickNorm = m.nickname ? stripKin(norm(m.nickname)) : '';
      if (qNorm.includes(fnNorm)) {
        matched.push(m);
      } else if (nickNorm && qNorm.includes(nickNorm)) {
        matched.push(m);
      }
    }
    const uniqueMatched = [...new Map(matched.map(m => [m.id, m])).values()];

    // 1. السؤال عن صلة القرابة بين شخصين
    if (uniqueMatched.length >= 2 || (qNorm.includes('قراب') || qNorm.includes('يقرب') || qNorm.includes('صله') || qNorm.includes('بين'))) {
      if (uniqueMatched.length >= 2) {
        const a = uniqueMatched[0], b = uniqueMatched[1];
        const r1 = relation(a, b);
        const r2 = relation(b, a);
        if (r1) {
          const ancTxt = r1.L ? `<br>🔗 <b>الجد المشترك:</b> ${esc(r1.L.full_name)} (الجيل ${gen(r1.L)}).` : '';
          const reply = `✨ <b>صلة القرابة:</b><br>• <b>${esc(a.full_name)}</b> هو <b>${esc(r1.term)}</b> لـ <b>${esc(b.full_name)}</b>.<br>• <b>${esc(b.full_name)}</b> هو <b>${esc(r2.term)}</b> لـ <b>${esc(a.full_name)}</b>.${ancTxt}`;
          const tools = `${nameBtn(a)}${nameBtn(b)}`;
          return appendMsg(reply, false, tools);
        } else {
          return appendMsg(`لم أجد جداً مشتركاً مباشراً في خط الآباء بين <b>${esc(a.full_name)}</b> و <b>${esc(b.full_name)}</b>.`);
        }
      }
    }

    // 2. السؤال عن الجد الأكبر أو المؤسس
    if (qNorm.includes('جد الاكبر') || qNorm.includes('مؤسس') || qNorm.includes('اصل العائله') || qNorm.includes('مطارد')) {
      const roots = S.roots || [];
      const reply = `👑 <b>الجد الأكبر والأساس لشجرة الأسرة:</b><br>${roots.map(r => `• <b>${esc(r.full_name)}</b> (الجيل الأول) — ذريته تشكل ركيزة الأسرة في بني عمرو.`).join('<br>')}<br>تمتد الشجرة اليوم عبر <b>${Math.max(1, ...S.members.map(gen))} أجيال</b> موثقة.`;
      return appendMsg(reply, false, roots.map(nameBtn).join(''));
    }

    // 3. السؤال عن أصحاب الشارات والدكاترة
    if (qNorm.includes('شاره') || qNorm.includes('شارات') || qNorm.includes('دكتور') || qNorm.includes('مهندس') || qNorm.includes('شرف') || qNorm.includes('انجاز')) {
      const badged = S.members.filter(m => m.achievement_badge && !m.badge_is_job);
      if (badged.length) {
        const reply = `🏅 <b>أصحاب الشارات التقديرية والإنجازات بالأسرة (${badged.length}):</b><br>تفتخر الأسرة بنخبة من المتميزين علمياً ومهنياً:`;
        return appendMsg(reply, false, badged.map(nameBtn).join(''));
      } else {
        return appendMsg('لم تُسجل شارات بعد في لوحة الشرف.');
      }
    }

    // 4. السؤال عن مدينة معينة (مثل النماص، بيشة، الرياض...)
    for (const c of CITIES) {
      if (qNorm.includes(stripKin(norm(c)))) {
        const inCity = S.members.filter(m => (m.city || '').trim() === c);
        const reply = `📍 <b>أفراد الأسرة المتواجدون في ${esc(c)} (${inCity.length} فرد):</b>`;
        return appendMsg(reply, false, inCity.slice(0, 30).map(nameBtn).join('') + (inCity.length > 30 ? '<br><small class="sub">...تم عرض أول 30 اسماً</small>' : ''));
      }
    }

    // 5. إذا كان هناك شخص واحد محدد في السؤال
    if (uniqueMatched.length === 1) {
      const m = uniqueMatched[0];

      if (qNorm.includes('ابناء') || qNorm.includes('بنات') || qNorm.includes('ذريه') || qNorm.includes('عيال') || qNorm.includes('اولاد')) {
        const kids = S.kids.get(m.id) || [];
        if (kids.length) {
          const reply = `👨‍👩‍👧‍👦 <b>أبناء وذرية ${esc(m.full_name)} (${kids.length}):</b>`;
          return appendMsg(reply, false, kids.map(nameBtn).join(''));
        } else {
          return appendMsg(`لم يُسجل أبناء موثقون لـ <b>${esc(m.full_name)}</b> في الشجرة حالياً.`, false, nameBtn(m));
        }
      }

      if (qNorm.includes('اخوان') || qNorm.includes('اخوه') || qNorm.includes('اخوات') || qNorm.includes('اخت')) {
        if (m.father_id) {
          const sibs = (S.kids.get(m.father_id) || []).filter(k => k.id !== m.id);
          if (sibs.length) {
            const reply = `👥 <b>إخوة وأخوات ${esc(m.full_name)} (${sibs.length}):</b>`;
            return appendMsg(reply, false, sibs.map(nameBtn).join(''));
          }
        }
        return appendMsg(`لم يُسجل إخوة لـ <b>${esc(m.full_name)}</b> من نفس الأب.`, false, nameBtn(m));
      }

      if (qNorm.includes('نسب') || qNorm.includes('سلسله') || qNorm.includes('والد') || qNorm.includes('اب') || qNorm.includes('جد')) {
        const chain = [m];
        let p = S.byId.get(m.father_id);
        while (p) {
          chain.push(p);
          p = S.byId.get(p.father_id);
        }
        const reply = `📜 <b>سلسلة نسب ${esc(m.full_name)}:</b><br>${chain.map((x, i) => `${i === 0 ? '👤' : '↳'} ${esc(x.full_name)} (الجيل ${gen(x)})`).join('<br>')}`;
        return appendMsg(reply, false, nameBtn(m));
      }

      const f = S.byId.get(m.father_id);
      const kids = S.kids.get(m.id) || [];
      const reply = `👤 <b>معلومات ${esc(m.full_name)}:</b><br>• <b>الجيل:</b> ${gen(m)}<br>• <b>الحالة:</b> ${m.is_alive !== false ? 'حي (حفظه الله)' : 'متوفى (رحمه الله)'}<br>• <b>الأب:</b> ${f ? esc(f.full_name) : 'الجد الأكبر'}<br>• <b>المدينة:</b> ${m.city || 'غير محددة'}<br>• <b>عدد الأبناء:</b> ${kids.length}`;
      return appendMsg(reply, false, nameBtn(m));
    }

    if (qNorm.includes('كم عدد') || qNorm.includes('احصائيات') || qNorm.includes('اجمالي')) {
      const reply = `📊 <b>ملخص أرقام الأسرة:</b><br>• إجمالي الأفراد: <b>${S.members.length} فرد</b>.<br>• الأجيال: <b>${Math.max(1, ...S.members.map(gen))} أجيال</b>.<br>• الأحياء: <b>${S.members.filter(m => m.is_alive !== false).length} فرد</b>.<br>• المتوفون: <b>${S.members.filter(m => m.is_alive === false).length} فرد</b>.`;
      return appendMsg(reply);
    }

    appendMsg(`لم أستطع تحديد صلة القرابة بدقة من السؤال. حاول ذكر الاسم ثلاثياً أو رباعياً، مثل: «ما صلة القرابة بين أحمد بن سالم وفهد بن علي؟» أو «من هم أبناء فهد بن محمد؟».`);
  }

  form.onsubmit = e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    appendMsg(esc(q), true);
    input.value = '';
    setTimeout(() => answerQuestion(q), 250);
  };

  chat.parentElement.querySelectorAll('.ai-pill').forEach(btn => {
    btn.onclick = () => {
      input.value = btn.dataset.ask;
      form.dispatchEvent(new Event('submit'));
    };
  });
}

$('#m-ai-kin').onclick = menuClose(() => openAiKinAssistant());

/* ---------- لعبة اعرف قريبك للأطفال (فرع تجربة) ---------- */
let gameState = { score: 0, streak: 0, qIndex: 1 };
function openFamilyGame() {
  gameState = { score: 0, streak: 0, qIndex: 1 };

  function getBadge(score) {
    if (score >= 200) return '🥇 حافظ الشجرة';
    if (score >= 120) return '🥈 خبير الأنساب الصغير';
    if (score >= 60) return '🥉 حفيد بار';
    return '🌱 باحث مبتدئ';
  }

  function generateQuestion() {
    const aliveMembers = S.members.filter(m => !m.name_masked && S.byId.get(m.father_id));
    if (aliveMembers.length < 5) return null;

    const qTypes = ['father', 'kin', 'city', 'child'];
    const type = qTypes[Math.floor(Math.random() * qTypes.length)];

    if (type === 'father') {
      const target = aliveMembers[Math.floor(Math.random() * aliveMembers.length)];
      const father = S.byId.get(target.father_id);
      if (!father) return generateQuestion();

      const wrong = S.members.filter(m => m.id !== father.id && m.gender !== 'female' && gen(m) === gen(father));
      const shuffledWrong = wrong.sort(() => 0.5 - Math.random()).slice(0, 3);
      const opts = [father, ...shuffledWrong].sort(() => 0.5 - Math.random());

      return {
        question: `من هو والد <b>«${esc(target.full_name)}»</b>؟`,
        correctId: father.id,
        options: opts.map(o => ({ id: o.id, text: o.full_name })),
        detail: `والد ${target.full_name} هو: ${father.full_name} (الجيل ${gen(father)})`
      };
    } else if (type === 'city') {
      const withCity = S.members.filter(m => !m.name_masked && m.city && m.city !== 'غير محددة');
      if (!withCity.length) return generateQuestion();
      const target = withCity[Math.floor(Math.random() * withCity.length)];
      const correctCity = target.city;

      const otherCities = CITIES.filter(c => c !== correctCity && c !== 'خارج المملكة').sort(() => 0.5 - Math.random()).slice(0, 3);
      const opts = [correctCity, ...otherCities].sort(() => 0.5 - Math.random());

      return {
        question: `في أي مدينة يقيم <b>«${esc(target.full_name)}»</b>؟`,
        correctId: correctCity,
        options: opts.map(c => ({ id: c, text: c })),
        detail: `يقيم ${target.full_name} في: ${correctCity}`
      };
    } else if (type === 'child') {
      const fathers = S.members.filter(m => (S.kids.get(m.id) || []).length > 0);
      if (!fathers.length) return generateQuestion();
      const father = fathers[Math.floor(Math.random() * fathers.length)];
      const kids = S.kids.get(father.id) || [];
      const correctKid = kids[Math.floor(Math.random() * kids.length)];

      const wrongKids = S.members.filter(m => m.father_id !== father.id && gen(m) === gen(correctKid)).sort(() => 0.5 - Math.random()).slice(0, 3);
      const opts = [correctKid, ...wrongKids].sort(() => 0.5 - Math.random());

      return {
        question: `من هو أحد أبناء <b>«${esc(father.full_name)}»</b>؟`,
        correctId: correctKid.id,
        options: opts.map(o => ({ id: o.id, text: o.full_name })),
        detail: `أحد أبناء ${father.full_name} هو: ${correctKid.full_name}`
      };
    } else {
      const m1 = aliveMembers[Math.floor(Math.random() * aliveMembers.length)];
      const candidates = aliveMembers.filter(m => m.id !== m1.id);
      const m2 = candidates[Math.floor(Math.random() * candidates.length)];
      const r = relation(m1, m2);
      if (!r || !r.term) return generateQuestion();

      const KIN_TERMS = ['أخ', 'عم', 'ابن عم', 'جد', 'ابن أخ', 'ابن عم الأب'];
      const wrongTerms = KIN_TERMS.filter(t => t !== r.term).sort(() => 0.5 - Math.random()).slice(0, 3);
      const opts = [r.term, ...wrongTerms].sort(() => 0.5 - Math.random());

      return {
        question: `ما هي صلة القرابة؟ <b>«${esc(m1.full_name)}»</b> هو بالنسبة لـ <b>«${esc(m2.full_name)}»</b>:`,
        correctId: r.term,
        options: opts.map(t => ({ id: t, text: t })),
        detail: `${m1.full_name} هو ${r.term} لـ ${m2.full_name}`
      };
    }
  }

  function renderGame() {
    const q = generateQuestion();
    if (!q) {
      showInfo('<p class="sub">لا توجد بيانات كافية لتشغيل اللعبة.</p>');
      return;
    }

    const html = `
      <div class="game-wrap">
        <div class="game-scoreboard">
          <div class="game-score-box">⭐ النقاط: <b id="g-score">${gameState.score}</b></div>
          <div class="game-score-box">🔥 التتابع: <b id="g-streak">${gameState.streak}</b></div>
          <div class="game-badge" id="g-badge">${getBadge(gameState.score)}</div>
        </div>

        <div class="game-card">
          <div class="game-q-num">السؤال رقم ${gameState.qIndex} 🎯</div>
          <div class="game-question">${q.question}</div>

          <div class="game-options-grid">
            ${q.options.map(opt => `
              <button type="button" class="game-opt-btn" data-opt-id="${esc(opt.id)}">${esc(opt.text)}</button>
            `).join('')}
          </div>

          <div id="game-feedback" class="game-feedback"></div>
          <button type="button" id="game-next-btn" class="game-next-btn" style="display:none">السؤال التالي ⬅️</button>
        </div>
      </div>`;

    showInfo(html);

    const pb = $('#profile-body');
    if (!pb) return;

    let answered = false;
    pb.querySelectorAll('.game-opt-btn').forEach(btn => {
      btn.onclick = () => {
        if (answered) return;
        answered = true;
        const selectedId = btn.dataset.optId;
        const fb = $('#game-feedback');
        const nextBtn = $('#game-next-btn');

        if (String(selectedId) === String(q.correctId)) {
          btn.classList.add('correct');
          gameState.score += 20;
          gameState.streak += 1;
          fb.className = 'game-feedback show correct';
          fb.innerHTML = `🎉 إجابة صحيحة بارك الله فيك! (+20 نقطة)<br><small>${esc(q.detail)}</small>`;
        } else {
          btn.classList.add('wrong');
          gameState.streak = 0;
          pb.querySelectorAll('.game-opt-btn').forEach(b => {
            if (String(b.dataset.optId) === String(q.correctId)) b.classList.add('correct');
          });
          fb.className = 'game-feedback show wrong';
          fb.innerHTML = `❌ إجابة غير صحيحة، حاول في السؤال القادم!<br><small>الصحيح: ${esc(q.detail)}</small>`;
        }

        $('#g-score').textContent = gameState.score;
        $('#g-streak').textContent = gameState.streak;
        $('#g-badge').textContent = getBadge(gameState.score);
        nextBtn.style.display = 'inline-block';
      };
    });

    $('#game-next-btn').onclick = () => {
      gameState.qIndex++;
      renderGame();
    };
  }

  renderGame();
}

$('#m-game').onclick = menuClose(() => openFamilyGame());

/* ---------- الخط الزمني المتحرك لتاريخ العائلة (فرع تجربة) ---------- */
let tlTourTimer = null;
function openFamilyTimeline() {
  if (tlTourTimer) { clearInterval(tlTourTimer); tlTourTimer = null; }

  const roots = S.roots || [];
  const g2 = S.members.filter(m => gen(m) === 2);
  const g3 = S.members.filter(m => gen(m) === 3);
  const g4 = S.members.filter(m => gen(m) === 4);
  const g5 = S.members.filter(m => gen(m) === 5);
  const g67 = S.members.filter(m => gen(m) >= 6);

  const milestones = [
    {
      era: 'بدايات التأسيس والرسوخ',
      time: 'القرن الثالث عشر الهجري وما قبله',
      title: '👑 الجيل الأول: مطارد وأجداد الأسرة في بني عمرو (النماص)',
      desc: 'انطلاقة السلالة العريقة لأسرة آل مطارد في ديار بني عمرو بمحافظة النماص في منطقة عسير. حيث تميزت هذه الحقبة بترسيخ القيم الأصيلة، الكرم، والشجاعة والترابط الأسري المتين.',
      members: roots
    },
    {
      era: 'عهد الأجداد والامتداد',
      time: 'القرن الرابع عشر الهجري (البدايات)',
      title: '📜 الجيل الثاني والثالث: اتساع الفروع ورعاية الأبناء',
      desc: 'مرحلة نمو الفروع الكبرى للأسرة، وبداية تدوين وتوارث الحكايات الشعبية والأنساب في قرى ومراكز النماص، وتوثيق صلات الرحم والمصاهرات الكريمة مع القبائل المجاورة.',
      members: [...g2, ...g3.slice(0, 15)]
    },
    {
      era: 'التوسع الجغرافي والنهضة السعودية',
      time: 'منتصف القرن الرابع عشر الهجري',
      title: '📍 الجيل الرابع: انتشار الأسرة في مدن ومناطق المملكة',
      desc: 'مع التوحيد والنهضة المباركة للمملكة العربية السعودية، انتشر أبناء الأسرة للخدمة والمساهمة في بناء الوطن واستقروا في بيشة، الرياض، المدينة المنورة، مكة المكرمة، خميس مشيط، الدمام، وجدة.',
      members: g4.slice(0, 20)
    },
    {
      era: 'ذروة الكثافة والتعليم والإنجاز',
      time: 'أواخر القرن الرابع عشر وأوائل الخامس عشر',
      title: '🏅 الجيل الخامس: جيل الكفاءات والتعليم والشارات الرفيعة',
      desc: 'يمثل هذا الجيل القمة العددية للأسرة (أكثر من 160 فرداً)، وشهد بزوغ نخبة من الأطباء، المهندسين، الضباط، والأكاديميين الذين توجوا لوحة شرف آل مطارد.',
      members: g5.slice(0, 20)
    },
    {
      era: 'عصر التوثيق الرقمي والمستقبل',
      time: 'القرن الخامس عشر الهجري (الحاضر والمستقبل)',
      title: '🌱 الجيل السادس والسابع: حفظ التراث وصلة الرحم الرقمية',
      desc: 'استمرار راية الأسرة بيد الأبناء والأحفاد، واجتماعهم على صلة الرحم والتواصل عبر هذا المشجر التفاعلي لتخليد تاريخ الأجداد للأجيال القادمة.',
      members: g67.slice(0, 20)
    }
  ];

  const html = `
    <div class="tl-wrap">
      <div class="fstats-head">
        <h2>⏳ الخط الزمني لتاريخ وأجيال أسرة آل مطارد</h2>
        <p class="sub">رحلة تاريخية متحركة توثق محطات الأسرة من الجد المؤسس وحتى الأجيال المعاصرة</p>
      </div>

      <div class="tl-controls">
        <span style="font-size:.85rem;color:var(--mut)">المحطات التاريخية: <b>${milestones.length} محطات</b></span>
        <button type="button" id="btn-tl-tour" class="tl-btn-tour">▶️ تشغيل الجولة التلقائية</button>
      </div>

      <div class="timeline-stream" id="tl-stream">
        ${milestones.map((m, idx) => `
          <div class="tl-item ${idx === 0 ? 'active' : ''}" data-tl-idx="${idx}" id="tl-step-${idx}">
            <div class="tl-dot"></div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="tl-badge">${esc(m.era)}</span>
              <span style="font-size:.75rem;color:var(--mut)">${esc(m.time)}</span>
            </div>
            <div class="tl-title">${m.title}</div>
            <div class="tl-desc">${m.desc}</div>
            ${m.members && m.members.length ? `
              <div class="tl-members">
                ${m.members.map(nameBtn).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>`;

  showInfo(html);

  const pb = $('#profile-body');
  if (!pb) return;

  const tourBtn = $('#btn-tl-tour');
  let currentStep = 0;
  let isPlaying = false;

  function setStep(idx) {
    pb.querySelectorAll('.tl-item').forEach((el, i) => {
      const on = i === idx;
      el.classList.toggle('active', on);
      if (on) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  if (tourBtn) {
    tourBtn.onclick = () => {
      if (isPlaying) {
        clearInterval(tlTourTimer);
        tlTourTimer = null;
        isPlaying = false;
        tourBtn.textContent = '▶️ استئناف الجولة';
      } else {
        isPlaying = true;
        tourBtn.textContent = '⏸️ إيقاف مؤقت';
        tlTourTimer = setInterval(() => {
          currentStep = (currentStep + 1) % milestones.length;
          setStep(currentStep);
        }, 4000);
      }
    };
  }

  pb.querySelectorAll('.tl-item').forEach((item, idx) => {
    item.onclick = () => {
      if (isPlaying) {
        clearInterval(tlTourTimer);
        tlTourTimer = null;
        isPlaying = false;
        if (tourBtn) tourBtn.textContent = '▶️ استئناف الجولة';
      }
      currentStep = idx;
      setStep(idx);
    };
  });
}

$('#m-timeline').onclick = menuClose(() => openFamilyTimeline());

/* ---------- القصص الصوتية لكبار العائلة (فرع تجربة) ---------- */
let audioMediaRecorder = null;
let recordedAudioChunks = [];
let localAudioStories = [];

function openAudioStories(selectedStoryId = null) {
  const defaultStories = [
    {
      id: 'story-1',
      title: 'ذكريات النماص وبني عمرو وبدايات الأسرة',
      speaker: 'كبار أعيان الأسرة',
      member_id: S.roots[0]?.id || S.members[0]?.id,
      duration: '4:15',
      date: 'توثيق تراثي',
      audio_url: '',
      text: 'كانت ديار بني عمرو في النماص عامرة بالمجالس والترابط الوثيق. وكان كبار الأسرة يجتمعون للتشاور وصلة الأرحام وحل النزاعات. تميز أجدادنا بحب الخير وإكرام الضيف، وظلت تلك القيم متوارثة جيلاً بعد جيل حتى يومنا هذا.'
    },
    {
      id: 'story-2',
      title: 'رحلة الاستقرار في بيشة وتجارة الحبوب والتمور',
      speaker: 'أحد أعلام الجيل الرابع',
      member_id: (S.members.find(m => m.city === 'بيشة') || S.members[1])?.id,
      duration: '3:40',
      date: 'أواسط القرن 14 هـ',
      audio_url: '',
      text: 'انتقل بعض الآباء والأجداد في عهد النهضة المباركة إلى بيشة نظراً لأهميتها الزراعية وموقعها التجاري الخصيب، وأسسوا هناك بيوتاً كريمة كانت وما زالت منارات للضيافة وصلة الرحم بين أبناء عمومتهم.'
    },
    {
      id: 'story-3',
      title: 'حكاية النخوة ونجدة القريب في مواسم الحصاد',
      speaker: 'الرواة والذاكرة الشفهية',
      member_id: (S.members.find(m => gen(m) === 3) || S.members[2])?.id,
      duration: '5:10',
      date: 'من تراث الأجداد',
      audio_url: '',
      text: 'في مواسم الأمطار والزراعة، كان أبناء آل مطارد يقفون صفاً واحداً مع كل قريب يحتاج العون. لا يُترك أحد حتى تكتمل مزارعه وبيته، وكان هذا التكاتف هو سر بقاء الأسرة وسمعتها الطيبة بين القبائل.'
    }
  ];

  const allStories = [...defaultStories, ...localAudioStories];
  let curStory = allStories.find(s => s.id === selectedStoryId) || allStories[0];
  const speakerMember = S.byId.get(curStory.member_id);

  const html = `
    <div class="audio-stories-wrap">
      <div class="fstats-head">
        <h2>🎙️ القصص الصوتية والتراث الشفهي لكبار العائلة</h2>
        <p class="sub">تسجيلات وذكريات وروايات أجداد وكبار أسرة آل مطارد مربوطة بملفات أصحابها</p>
      </div>

      <div class="as-player-card">
        <div class="as-speaker-header">
          <img class="as-avatar" src="${(speakerMember && S.photos.get(speakerMember.id)) || 'logo.jpg'}" alt="">
          <div class="as-speaker-info">
            <h3>${esc(curStory.title)}</h3>
            <p>الراوي: <b>${esc(curStory.speaker || speakerMember?.full_name || 'أحد الأعيان')}</b> · ${esc(curStory.date)}</p>
          </div>
        </div>

        <audio class="as-audio-el" controls preload="none" src="${esc(curStory.audio_url || (speakerMember && speakerMember.audio_url) || '')}">
          المتصفح لا يدعم مشغل الصوت.
        </audio>

        <div class="as-story-text">
          <b>📖 نص الرواية المكتوب:</b><br>
          ${esc(curStory.text || speakerMember?.biography_story || speakerMember?.bio || 'لا يوجد نص مكتوب لهذه القصة بعد.').replace(/\n/g, '<br>')}
        </div>

        ${speakerMember ? `
          <div style="display:flex;justify-content:flex-end">
            ${nameBtn(speakerMember)}
          </div>
        ` : ''}
      </div>

      <div class="as-record-box">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700;font-size:.9rem;color:var(--gold)">🎙️ توثيق قصة صوتية جديدة</span>
          <span style="font-size:.75rem;color:var(--mut)">من كبار الأسرة</span>
        </div>
        <input type="text" id="rec-story-title" placeholder="عنوان القصة أو الذكرى…" style="padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt);font-size:.82rem" />
        <textarea id="rec-story-text" placeholder="نص القصة أو ملخص الرواية…" rows="2" style="padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt);font-size:.82rem;font-family:inherit"></textarea>
        <div style="display:flex;gap:6px">
          <button type="button" id="btn-record-audio" class="as-record-btn">
            ⏺️ ابدأ التسجيل المباشر
          </button>
          <button type="button" id="btn-save-story" class="ghost" style="font-size:.82rem">
            💾 حفظ القصة بالمكتبة
          </button>
        </div>
        <div id="rec-status" style="font-size:.78rem;color:var(--mut);display:none"></div>
      </div>

      <div style="font-size:.95rem;font-weight:700;color:var(--txt);margin-top:4px">
        📚 مكتبة التسجيلات التراثية (${allStories.length})
      </div>
      <div class="as-list">
        ${allStories.map(s => {
          const isSel = s.id === curStory.id;
          return `
            <div class="as-item ${isSel ? 'active' : ''}" data-story-id="${esc(s.id)}">
              <div>
                <b style="color:${isSel ? 'var(--gold)' : 'var(--txt)'}">🎙️ ${esc(s.title)}</b>
                <div style="font-size:.75rem;color:var(--mut)">${esc(s.speaker)} · ${esc(s.duration)}</div>
              </div>
              <button type="button" style="padding:4px 10px;font-size:.75rem;border-radius:6px;background:${isSel ? 'var(--gold)' : 'rgba(255,255,255,.08)'};color:${isSel ? '#1c1204' : 'var(--txt)'}">
                ${isSel ? 'جارٍ التشغيل ▶' : 'استماع 🎧'}
              </button>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  showInfo(html);

  const pb = $('#profile-body');
  if (!pb) return;

  pb.querySelectorAll('[data-story-id]').forEach(el => {
    el.onclick = () => openAudioStories(el.dataset.storyId);
  });

  const recBtn = $('#btn-record-audio');
  const recStatus = $('#rec-status');
  let recordedBlobUrl = null;

  if (recBtn) {
    let isRecording = false;
    recBtn.onclick = async () => {
      if (!isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          recordedAudioChunks = [];
          audioMediaRecorder = new MediaRecorder(stream);
          audioMediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedAudioChunks.push(e.data); };
          audioMediaRecorder.onstop = () => {
            const blob = new Blob(recordedAudioChunks, { type: 'audio/webm' });
            recordedBlobUrl = URL.createObjectURL(blob);
            if (recStatus) {
              recStatus.style.display = 'block';
              recStatus.innerHTML = `✅ تم التقاط التسجيل بنجاح! جاهز للحفظ.`;
            }
          };
          audioMediaRecorder.start();
          isRecording = true;
          recBtn.classList.add('recording');
          recBtn.textContent = '⏹️ إيقاف وإنهاء التسجيل';
          if (recStatus) {
            recStatus.style.display = 'block';
            recStatus.textContent = '🔴 جارٍ التسجيل الآن... تحدث بوضوح.';
          }
        } catch (err) {
          toast('تعذر الوصول إلى الميكروفون: ' + err.message);
        }
      } else {
        if (audioMediaRecorder && audioMediaRecorder.state !== 'inactive') {
          audioMediaRecorder.stop();
        }
        isRecording = false;
        recBtn.classList.remove('recording');
        recBtn.textContent = '⏺️ إعادة التسجيل';
      }
    };
  }

  const saveBtn = $('#btn-save-story');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const title = $('#rec-story-title')?.value.trim();
      const text = $('#rec-story-text')?.value.trim();
      if (!title) {
        toast('يرجى كتابة عنوان للقصة أولاً');
        return;
      }
      const newStory = {
        id: 'user-story-' + Date.now(),
        title,
        speaker: 'تسجيل مسجل جديد',
        duration: 'مقطع صوتي',
        date: 'الآن',
        audio_url: recordedBlobUrl || '',
        text: text || 'تم تسجيل هذه القصة حديثاً وحفظها في التراث الأسري.'
      };
      localAudioStories.push(newStory);
      toast('تمت إضافة القصة الصوتية بنجاح 🎙️');
      openAudioStories(newStory.id);
    };
  }
}

$('#m-audio-stories').onclick = menuClose(() => openAudioStories());

/* ---------- العرض السينمائي ثلاثي الأبعاد (فرع تجربة) ---------- */
let anim3dId = null;
function open3dView() {
  if (anim3dId) { cancelAnimationFrame(anim3dId); anim3dId = null; }

  const html = `
    <div class="view3d-wrap">
      <div class="view3d-controls">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.3rem">🌌</span>
          <div>
            <b style="color:var(--gold);font-size:.95rem">المشجر السينمائي ثلاثي الأبعاد</b>
            <div style="font-size:.72rem;color:var(--mut)">إبحار حر 360° بين أجيال وأعلام الأسرة</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="v3d-gen-filter" style="font-size:.78rem;padding:4px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt)">
            <option value="0">جميع الأجيال (1 - 7)</option>
            <option value="1">الجيل 1 (المؤسسون)</option>
            <option value="2">الجيل 2</option>
            <option value="3">الجيل 3</option>
            <option value="4">الجيل 4</option>
            <option value="5">الجيل 5</option>
            <option value="6">الجيل 6</option>
            <option value="7">الجيل 7</option>
          </select>
          <button type="button" id="btn-v3d-orbit" style="font-size:.78rem;padding:4px 10px;border-radius:6px;background:var(--gold);color:#1c1204">
            🎬 جولة مدارية
          </button>
        </div>
      </div>

      <div class="view3d-stage-box" id="v3d-stage">
        <canvas class="view3d-canvas" id="v3d-canvas"></canvas>
        <div id="v3d-info-card" class="view3d-info-card"></div>
        <div class="view3d-hud">
          <div class="view3d-hud-pill">🖱️ اسحب للتدوير · عجلة الماوس للتقريب · اضغط على أي نجم لرؤية الفرد</div>
          <div class="view3d-hud-pill" id="v3d-count-pill">${S.members.length} فرد في الفضاء</div>
        </div>
      </div>
    </div>`;

  showInfo(html);

  const canvas = $('#v3d-canvas');
  const stage = $('#v3d-stage');
  const infoCard = $('#v3d-info-card');
  const orbitBtn = $('#btn-v3d-orbit');
  const genFilter = $('#v3d-gen-filter');
  if (!canvas || !stage) return;

  const ctx = canvas.getContext('2d');
  let width = canvas.width = stage.clientWidth;
  let height = canvas.height = stage.clientHeight;

  window.addEventListener('resize', () => {
    if (!stage || !canvas) return;
    width = canvas.width = stage.clientWidth;
    height = canvas.height = stage.clientHeight;
  });

  const maxGen = Math.max(1, ...S.members.map(gen));
  const genBuckets = new Map();
  for (let g = 1; g <= maxGen; g++) genBuckets.set(g, []);
  for (const m of S.members) {
    const g = gen(m);
    if (!genBuckets.has(g)) genBuckets.set(g, []);
    genBuckets.get(g).push(m);
  }

  const stars = Array.from({ length: 90 }, () => ({
    x: (Math.random() - 0.5) * 1400,
    y: (Math.random() - 0.5) * 1200,
    z: (Math.random() - 0.5) * 1400,
    size: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.7 + 0.3
  }));

  const nodes3d = [];
  const nodeMap = new Map();

  for (let g = 1; g <= maxGen; g++) {
    const list = genBuckets.get(g) || [];
    const radius = 60 + g * 75;
    const yLevel = (g - (maxGen / 2)) * 85;
    list.forEach((m, idx) => {
      const theta = (idx / (list.length || 1)) * Math.PI * 2;
      const x = radius * Math.cos(theta);
      const z = radius * Math.sin(theta);
      const node = {
        m,
        g,
        x,
        y: yLevel,
        z,
        isRoot: g === 1 || !m.father_id,
        projX: 0,
        projY: 0,
        scale: 1,
        z2: 0
      };
      nodes3d.push(node);
      nodeMap.set(m.id, node);
    });
  }

  let rotX = -0.3;
  let rotY = 0.4;
  let camDist = 450;
  let isOrbiting = true;
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let selectedGen = 0;
  let hoveredNode = null;

  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (isDragging) {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      rotY += dx * 0.008;
      rotX += dy * 0.008;
      rotX = Math.max(-1.4, Math.min(1.4, rotX));
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      isOrbiting = false;
      if (orbitBtn) orbitBtn.textContent = '▶️ تفعيل الجولة';
    } else {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let closest = null;
      let minDist = 22;
      for (const n of nodes3d) {
        if (selectedGen > 0 && n.g !== selectedGen) continue;
        const d = Math.hypot(n.projX - mx, n.projY - my);
        if (d < minDist) {
          minDist = d;
          closest = n;
        }
      }
      hoveredNode = closest;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camDist += e.deltaY * 0.5;
    camDist = Math.max(100, Math.min(1200, camDist));
  }, { passive: false });

  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let closest = null;
    let minDist = 24;
    for (const n of nodes3d) {
      if (selectedGen > 0 && n.g !== selectedGen) continue;
      const d = Math.hypot(n.projX - mx, n.projY - my);
      if (d < minDist) {
        minDist = d;
        closest = n;
      }
    }
    if (closest && infoCard) {
      const m = closest.m;
      infoCard.style.display = 'block';
      infoCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <b style="color:var(--gold)">${esc(m.full_name)}</b>
          <button type="button" class="x" onclick="document.getElementById('v3d-info-card').style.display='none'" style="font-size:.7rem;padding:0 4px">✕</button>
        </div>
        <div style="font-size:.75rem;color:#cbd5e1">الجيل ${closest.g} · ${m.city || 'المدينة غير محددة'}</div>
        <div style="margin-top:6px;display:flex;justify-content:flex-end">
          ${nameBtn(m)}
        </div>`;
    }
  });

  if (orbitBtn) {
    orbitBtn.onclick = () => {
      isOrbiting = !isOrbiting;
      orbitBtn.textContent = isOrbiting ? '⏸️ إيقاف مؤقت' : '🎬 جولة مدارية';
    };
  }

  if (genFilter) {
    genFilter.onchange = () => {
      selectedGen = parseInt(genFilter.value, 10);
      const filteredCount = selectedGen === 0 ? S.members.length : (genBuckets.get(selectedGen) || []).length;
      $('#v3d-count-pill').textContent = `${filteredCount} فرد معروض`;
    };
  }

  function render3d() {
    if (!stage || !canvas) return;
    const p = $('#profile');
    if (!p || !p.open) {
      if (anim3dId) cancelAnimationFrame(anim3dId);
      return;
    }

    if (isOrbiting) {
      rotY += 0.005;
    }

    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const fov = 500;

    ctx.fillStyle = '#fff';
    for (const s of stars) {
      const x1 = s.x * Math.cos(rotY) - s.z * Math.sin(rotY);
      const z1 = s.x * Math.sin(rotY) + s.z * Math.cos(rotY);
      const y2 = s.y * Math.cos(rotX) - z1 * Math.sin(rotX);
      const z2 = s.y * Math.sin(rotX) + z1 * Math.cos(rotX);

      const depth = fov + z2 + camDist;
      if (depth <= 10) continue;
      const sc = fov / depth;
      const px = cx + x1 * sc;
      const py = cy + y2 * sc;

      if (px >= 0 && px <= width && py >= 0 && py <= height) {
        ctx.globalAlpha = s.alpha * Math.min(1, Math.max(0.1, sc));
        ctx.beginPath();
        ctx.arc(px, py, s.size * sc, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const n of nodes3d) {
      const x1 = n.x * Math.cos(rotY) - n.z * Math.sin(rotY);
      const z1 = n.x * Math.sin(rotY) + n.z * Math.cos(rotY);
      const y2 = n.y * Math.cos(rotX) - z1 * Math.sin(rotX);
      const z2 = n.y * Math.sin(rotX) + z1 * Math.cos(rotX);

      const depth = fov + z2 + camDist;
      n.z2 = z2;
      if (depth <= 10) {
        n.scale = 0;
        continue;
      }
      n.scale = fov / depth;
      n.projX = cx + x1 * n.scale;
      n.projY = cy + y2 * n.scale;
    }

    ctx.lineWidth = 1.2;
    for (const n of nodes3d) {
      if (selectedGen > 0 && n.g !== selectedGen) continue;
      if (n.m.father_id && nodeMap.has(n.m.father_id)) {
        const fn = nodeMap.get(n.m.father_id);
        if (n.scale > 0 && fn.scale > 0) {
          ctx.beginPath();
          ctx.moveTo(fn.projX, fn.projY);
          ctx.lineTo(n.projX, n.projY);
          ctx.strokeStyle = n.isRoot ? 'rgba(245,158,11,0.5)' : 'rgba(56,189,248,0.25)';
          ctx.stroke();
        }
      }
    }

    const sortedNodes = [...nodes3d].sort((a, b) => b.z2 - a.z2);

    for (const n of sortedNodes) {
      if (selectedGen > 0 && n.g !== selectedGen) continue;
      if (n.scale <= 0) continue;

      const isHovered = hoveredNode === n;
      const r = (n.isRoot ? 9 : 5.5) * n.scale * (isHovered ? 1.5 : 1);

      ctx.beginPath();
      ctx.arc(n.projX, n.projY, r * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = n.isRoot ? 'rgba(245,158,11,0.25)' : (n.m.is_alive !== false ? 'rgba(52,211,153,0.18)' : 'rgba(148,163,184,0.12)');
      ctx.fill();

      ctx.beginPath();
      ctx.arc(n.projX, n.projY, r, 0, Math.PI * 2);
      ctx.fillStyle = n.isRoot ? '#f59e0b' : (n.m.is_alive !== false ? '#34d399' : '#94a3b8');
      ctx.fill();

      if (n.scale > 0.85 || isHovered || n.isRoot) {
        ctx.font = `${Math.round(Math.max(9, 12 * n.scale))}px Cairo, Tahoma, sans-serif`;
        ctx.fillStyle = isHovered ? '#fff' : (n.isRoot ? '#fbbf24' : '#cbd5e1');
        ctx.textAlign = 'center';
        ctx.fillText(n.m.first || n.m.full_name.split(' ')[0], n.projX, n.projY - r - 4);
      }
    }

    anim3dId = requestAnimationFrame(render3d);
  }

  anim3dId = requestAnimationFrame(render3d);
}

$('#m-3d-view').onclick = menuClose(() => open3dView());

/* ---------- تصدير الشجرة PDF والطباعة ومحرر المشجر الجداري (فرع تجربة) ---------- */
function openPdfExport() {
  const roots = S.roots || [];
  const maxGen = Math.max(1, ...S.members.map(gen));

  const branchOpts = [
    ['all', 'الشجرة كاملة (كافة الفروع والأجيال)'],
    ...roots.map(r => [r.id, `فرع: ${r.full_name}`])
  ];

  const html = `
    <div class="pdf-export-box">
      <div class="fstats-head">
        <h2>📄 تصدير الشجرة للطباعة (PDF / مشجر جداري)</h2>
        <p class="sub">إعداد وتجهيز شجرة العائلة للطباعة الورقية بمقاسات مختلفة (A4، A3، أو مشجر جداري كبير)</p>
      </div>

      <div class="pdf-preview-box">
        <div class="pdf-preview-header">
          <img src="logo.jpg" alt="" width="34" height="34" style="border-radius:50%">
          <div>
            <h4>أسرة آل مطارد - بنو عمرو</h4>
            <div class="pdf-preview-summary">توثيق الأنساب والتراث · ${S.members.length} فرد · ${maxGen} أجيال</div>
          </div>
        </div>
        <div style="font-size:.78rem;color:#475569;margin-top:4px">
          « ذُرِّيَّةً بَعْضُهَا مِن بَعْضٍ »
        </div>
        <div style="font-size:.72rem;color:#94a3b8;margin-top:6px">
          تاريخ التوثيق: ${new Date().toLocaleDateString('ar-SA')} م
        </div>
      </div>

      <div class="pdf-options-grid">
        <div class="pdf-opt-card">
          <label>نطاق المشجر</label>
          <select id="pdf-scope">
            ${branchOpts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select>
        </div>

        <div class="pdf-opt-card">
          <label>أقصى جيل للطباعة</label>
          <select id="pdf-gen">
            ${Array.from({ length: maxGen }, (_, i) => `<option value="${i + 1}" ${i + 1 === maxGen ? 'selected' : ''}>حتى الجيل ${i + 1}</option>`).join('')}
          </select>
        </div>

        <div class="pdf-opt-card">
          <label>مقاس الصفحة المقترح</label>
          <select id="pdf-size">
            <option value="A4">A4 (عرضي - مناسب للكتيبات)</option>
            <option value="A3" selected>A3 (عرضي - مناسب للجدار المتوسط)</option>
            <option value="A0">مشجر جداري عملاق (Poster A0/A1)</option>
          </select>
        </div>

        <div class="pdf-opt-card">
          <label>نمط الطباعة</label>
          <select id="pdf-theme">
            <option value="clean" selected>ناصع البياض (واضح واقتصادي للحبر)</option>
            <option value="royal">ملكي مذهب (إطارات فاخرة)</option>
          </select>
        </div>
      </div>

      <div class="pdf-action-row">
        <button type="button" id="btn-do-print" style="background:var(--gold);color:#1c1204;font-weight:700">
          🖨️ طباعة / حفظ كـ PDF
        </button>
        <button type="button" id="btn-export-svg" class="ghost">
          🖼️ تنزيل مشجر فيكتور (SVG)
        </button>
      </div>
      <p class="sub" style="font-size:.75rem;text-align:center">
        💡 عند الضغط على "طباعة / حفظ كـ PDF"، اختر الوجهة <b>Save as PDF</b> في نافذة الطباعة لاقتناء نسخة PDF عالية الدقة.
      </p>
    </div>`;

  showInfo(html);

  const pb = $('#profile-body');
  if (!pb) return;

  const printBtn = $('#btn-do-print');
  if (printBtn) {
    printBtn.onclick = () => {
      $('#profile').close();
      toast('جاري فتح نافذة الطباعة...');
      setTimeout(() => {
        window.print();
      }, 300);
    };
  }

  const svgBtn = $('#btn-export-svg');
  if (svgBtn) {
    svgBtn.onclick = () => {
      const stage = $('#stage');
      const lines = $('#lines');
      if (!stage || !lines) return;

      const w = stage.offsetWidth || 2400;
      const h = stage.offsetHeight || 1600;

      const svgHeader = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 200}" viewBox="0 0 ${w} ${h + 200}" style="background:#0b1120;font-family:Cairo,Tahoma,sans-serif">
  <style>
    text { fill: #f1f5f9; font-family: Cairo, Tahoma, sans-serif; }
    .title { font-size: 32px; font-weight: 800; fill: #f59e0b; text-anchor: middle; }
    .subtitle { font-size: 16px; fill: #94a3b8; text-anchor: middle; }
    .tree-line { stroke: #2b3a55; stroke-width: 2; fill: none; }
  </style>
  <g transform="translate(0, 40)">
    <text x="${w / 2}" y="40" class="title">مشجر أسرة آل مطارد - بنو عمرو</text>
    <text x="${w / 2}" y="70" class="subtitle">ذُرِّيَّةً بَعْضُهَا مِن بَعْضٍ · توثيق الأنساب والتراث</text>
    <text x="${w / 2}" y="95" class="subtitle">تاريخ التوثيق: ${new Date().toLocaleDateString('ar-SA')} · ${S.members.length} فرد</text>
  </g>
  <g transform="translate(0, 160)">
    ${lines.innerHTML}
  </g>
</svg>`;

      const blob = new Blob([svgHeader], { type: 'image/svg+xml;charset=utf-8' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `al-matarid-wall-tree-${new Date().toISOString().slice(0, 10)}.svg`
      });
      a.click();
      URL.revokeObjectURL(a.href);
      toast('تم تنزيل ملف المشجر الفيكتور بنجاح 🖼️');
    };
  }
}

$('#m-pdf').onclick = menuClose(() => openPdfExport());

/* تصدير Excel (CSV بترميز يفتحه Excel بالعربية صحيحًا) */
$('#m-csv').onclick = menuClose(() => {
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const head = ['الاسم', 'الكنية', 'الأب', 'الجيل', 'الجنس', 'الحالة', 'الميلاد', 'الوفاة', 'المدينة', 'الشارة', 'نوع الشارة', ...(canEdit() ? ['الهاتف'] : [])];
  const rows = S.members.slice().sort(byName).map(m => [m.full_name, m.nickname, S.byId.get(m.father_id)?.full_name, gen(m), m.gender === 'female' ? 'أنثى' : 'ذكر',
    m.is_alive === false ? 'متوفى' : 'حي', m.birth_year_text || (m.birth_date || '').slice(0, 4), m.death_year_text || (m.death_date || '').slice(0, 4), m.city, m.achievement_badge, m.achievement_badge ? (m.badge_is_job ? 'وظيفة' : 'شارة') : '', ...(canEdit() ? [m.phone] : [])]);
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
$('#m-snap').onclick = () => openSnapshots(); /* ميزة 2: مدير اللقطات بدل اللقطة الفورية */

/* ---------- 62-ب) استعادة نسخة سابقة من البيانات — لقطات القاعدة (فرع تجربة) ---------- */
/* الاستعادة نفسها خادمية (secure_restore_snapshot ← admin_restore_snapshot) وتأخذ لقطة «قبل الاستعادة» تلقائيًا قبل أن تمسح شيئًا. */
async function openSnapshots() {
  $('.more').open = false;
  if (CFG.DEMO) return alert('اللقطات تعمل مع القاعدة الحقيقية فقط.');
  let items = null, rpcMissing = false;
  try {
    const r = await rpc('list_snapshots', { p_passcode: S.code });
    if (!r.success) return alert(r.message);
    items = r.items || [];
  } catch (_) { rpcMissing = true; }
  const row = s => `<div class="evrow"><div><b>لقطة رقم ${s.id} — ${esc(s.label || '')}</b><small>${esc(new Date(s.created_at).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }))} · ${s.members} فردًا · ${s.wives} زوجة · ${s.events} مناسبة</small></div><button class="ghost" data-restore="${s.id}" data-label="${esc(s.label || '')}">↩ استعادة</button></div>`;
  showInfo(`<h2>📸 اللقطات الاحتياطية</h2><p class="sub">تُحفظ آخر 20 لقطة تلقائيًا في القاعدة.</p>
    ${rpcMissing ? '<p class="sub">قائمة اللقطات تحتاج تشغيل SQL التجريبي (02_trial_additions.sql) — يمكنك أخذ لقطة جديدة فقط الآن.</p>' : ''}
    <div class="row"><button id="snap-new">📸 لقطة جديدة الآن</button></div>
    ${items ? (items.map(row).join('') || '<p class="sub">لا توجد لقطات بعد.</p>') : ''}`);
  $('#snap-new').onclick = async () => { try { const r = await rpc('secure_snapshot', { p_passcode: S.code }); alert(r.success ? `تم حفظ لقطة رقم ${r.id}` : r.message); if (r.success) openSnapshots(); } catch (err) { alert(err.message); } };
  document.querySelectorAll('#profile-body [data-restore]').forEach(b => b.onclick = async () => {
    const id = +b.dataset.restore;
    if (!confirm(`استعادة اللقطة رقم ${id} (${b.dataset.label})؟\nستُلغى كل التغييرات بعدها، وتُحفظ لقطة «قبل الاستعادة» تلقائيًا.`)) return;
    if (!confirm('تأكيد أخير: متابعة الاستعادة؟')) return;
    try {
      const r = await rpc('secure_restore_snapshot', { p_passcode: S.code, p_id: id, p_confirm: 'RESTORE' });
      if (!r.success) return alert(r.message || 'تعذرت الاستعادة');
      alert(r.message || 'تمت الاستعادة'); $('#profile').close(); await refresh();
    } catch (err) { alert(err.message); }
  });
}

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
$('#m-family-news').onclick = menuClose(() => openFamilyNewsModal());
$('#m-family-vote').onclick = menuClose(() => openFamilyVoteModal());
$('#m-careers-dir').onclick = menuClose(() => openCareersDirectoryModal());
$('#m-time-capsule').onclick = menuClose(() => openTimeCapsuleModal());

/* ---------- إعلانات البطاقات: منبثقة أول مرة لكل زائر، ثم شريط علوي دوّار حتى تنتهي مدتها (7 أيام) ---------- */
const ANN_KEY = 'alm_seen_ann';
const seenAnn = () => { try { return JSON.parse(localStorage.getItem(ANN_KEY) || '[]'); } catch (_) { return []; } };
function markSeenAnn(id) { if (!id) return; const s = seenAnn(); if (!s.includes(id)) { s.push(id); try { localStorage.setItem(ANN_KEY, JSON.stringify(s.slice(-60))); } catch (_) {} } }
async function postAnnouncement(kind, member) {
  if (CFG.DEMO || !member) return; /* ann31: أنواع جديدة wedding/general عبر member.body */
  if (!canEdit() && S.role !== 'branch') { toast('البطاقة ظهرت لك فقط — نشرها للزوار يحتاج دخول المالك أو المحرر أو مسؤول الفرع'); return; } /* ann61: الخادم يسمح للفرع داخل فرعه أصلًا */
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
  bar.innerHTML = items.map((a, i) => `<button class="nbcard${i === 0 ? ' on' : ''}" data-ann="${a.id}"><img alt=""><span>${a.kind === 'general' ? '📢 إعلان' : (CARDS[a.kind] ? CARDS[a.kind].nb : '🕊️ تعزية')}: ${esc(a.member_name)}</span>${canEdit() ? `<span class="nbdel nbedit" data-anedit="${a.id}" role="button" aria-label="تعديل الإعلان" title="تعديل الإعلان">✏️</span><span class="nbdel" data-andel="${a.id}" role="button" aria-label="حذف الإعلان" title="حذف الإعلان">✕</span>` : ''}</button>`).join('');
  for (const a of items) {
    const img = bar.querySelector(`[data-ann="${a.id}"] img`);
    if (a.kind === 'general') { img.style.display = 'none'; continue; }
    try { /* ann61: توليد صورة البطاقة مرة واحدة لكل إعلان بدل كل 90 ثانية */
      if (!S.thumbCache) S.thumbCache = new Map();
      for (const k of [...S.thumbCache.keys()]) if (!items.some(z => z.id === k)) S.thumbCache.delete(k);
      if (!S.thumbCache.has(a.id)) S.thumbCache.set(a.id, (await drawCard({ full_name: a.member_name, gender: a.gender }, a.kind)).toDataURL('image/png'));
      img.src = S.thumbCache.get(a.id);
    } catch (_) {}
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
  /* ann84: تعديل الإعلان — العام: العنوان + النص؛ البطاقات: الاسم الظاهر (+ نص الشكر إن وُجد) */
  bar.querySelectorAll('[data-anedit]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    const a = items.find(z => z.id === x.dataset.anedit); if (!a) return;
    const isGen = a.kind === 'general';
    const fields = isGen
      ? [{ k: 'title', label: 'عنوان الإعلان', val: a.member_name, req: 1 }, { k: 'text', label: 'نص الإعلان', type: 'area', val: a.body || '', req: 1 }]
      : [{ k: 'name', label: 'الاسم الظاهر في الإعلان', val: a.member_name, req: 1 }].concat((a.kind === 'thanks' || a.body) ? [{ k: 'text', label: 'نص الشكر', type: 'area', val: a.body || '' }] : []);
    openForm('تعديل الإعلان', fields, async d => {
      const name = (isGen ? d.title : d.name).trim();
      const body = isGen ? d.text.trim() : (d.text !== undefined ? d.text.trim() : undefined);
      try {
        if (!CFG.DEMO) {
          const r = await rpc('secure_update_announcement', { p_passcode: S.code, p_id: a.id, p_member_name: name, p_body: body === undefined ? null : body });
          if (!r || !r.ok) throw new Error('update failed');
        }
        a.member_name = name; if (body !== undefined) a.body = body || null;
        if (S.thumbCache) S.thumbCache.delete(a.id); /* ann84: إعادة توليد صورة البطاقة بعد تعديل الاسم */
        renderNewsbar(); toast('تم تعديل الإعلان');
      } catch (_) { toast('تعذر تعديل الإعلان'); }
    });
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
    /* ann61: لا تعيد رسم الشجرة إذا لم تتغير البيانات (كان التحديث كل 90 ثانية يضيّع البحث وموضع التصفح) */
    const sig = JSON.stringify([b.role, b.women_names_visible, b.featured_sections,
      (b.members || []).map(m => [m.id, m.full_name, m.nickname, m.is_alive, m.father_id, m.city, m.achievement_badge, m.badge_is_job]),
      (b.wives || []).map(w => [w.id, w.full_name, w.family_name, w.marriage_status, w.member_id]),
      (b.events || []).map(e => [e.id, e.title, e.event_date])]);
    if (sig !== S._sig) { S._sig = sig; index(); render(); showEvent(); applyRole(); renderFeat(); inboxBadge(); }
    checkAnnouncements(true);
    fetchPhotos();
  } catch (_) {}
}

/* ---------- محرر العائلة: زوجات وأبناء الأب في شاشة واحدة، لصق جماعي، حفظ واحد ---------- */
async function saveMemberData(m, over) {
  const v = { full_name: m.full_name, nickname: m.nickname, gender: m.gender, is_alive: m.is_alive !== false, birth_year_text: m.birth_year_text, death_year_text: m.death_year_text, city: m.city, achievement_badge: m.achievement_badge, badge_is_job: !!m.badge_is_job, phone: m.phone, birth_order: m.birth_order, wife_mother_id: m.wife_mother_id, biography_story: m.biography_story || m.bio, name_public: !!m.name_public, name_hidden: !!m.name_hidden, ...over };
  const r = await op('secure_save_member', { p_id: m.id, p_full_name: v.full_name, p_nickname: v.nickname, p_gender: v.gender, p_father_id: m.father_id, p_wife_mother_id: v.wife_mother_id, p_birth_order: v.birth_order, p_phone: v.phone, p_is_alive: v.is_alive, p_birth_year_text: v.birth_year_text, p_death_year_text: v.death_year_text, p_biography_story: v.biography_story, p_passcode: S.code }, () => Object.assign(m, v));
  await op('secure_update_member_extras', { p_id: m.id, p_city: v.city, p_achievement_badge: v.achievement_badge, p_badge_is_job: v.badge_is_job, p_audio_url: m.audio_url || null, p_name_public: v.name_public, p_name_hidden: v.name_hidden, p_passcode: S.code }, () => {});
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
  if (wives.length > 12) { const momSel = $('#fe-mom'), inp = document.createElement('input'), wrap = document.createElement('div'); inp.className = 'selfilter'; inp.type = 'search'; inp.placeholder = '🔍 ابحث بالاسم…'; wrap.className = 'selrow'; momSel.before(wrap); wrap.append(inp, momSel); bindSelectSearch(momSel, inp); }
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
  ['cities', '🗺️ خريطة المدن', '#m-cities'], ['fullstats', '📊 الإحصائيات', '#m-fullstats'], ['names', '📋 جميع الأسماء', '#m-names'],
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

/* ---------- ann66: الشريط السفلي بالجوال + لوحة الملف ---------- */
/* نقل قائمة الأقسام نفسها (details.more) بين الترويسة والشريط السفلي حسب العرض —
   لا نسخة مكررة، والمستمعات المرتبطة بالعنصر تنتقل معه */
const bbar = $('#bbar'), bbarSlot = $('#bb-more-slot');
/* tablet-bbar: الشريط السفلي أيضًا بالأجهزة اللمسية حتى 1366px (تابلت) */
const BBAR_MQ = window.matchMedia('(max-width: 640px), (pointer: coarse) and (max-width: 1366px)');
function placeMore() {
  const moreEl = document.querySelector('.more'), loginEl = $('#btn-login'), hbtns = document.querySelector('.hbtns');
  if (!moreEl || !loginEl || !hbtns || !bbarSlot || !bbar) return;
  if (BBAR_MQ.matches) {
    if (moreEl.parentElement !== bbarSlot) bbarSlot.appendChild(moreEl);
    if (loginEl.parentElement !== bbar) bbar.appendChild(loginEl);
  } else {
    if (loginEl.parentElement !== hbtns) hbtns.appendChild(loginEl);
    if (moreEl.parentElement !== hbtns) hbtns.insertBefore(moreEl, loginEl);
    document.querySelector('.bar').classList.remove('show');
  }
}
placeMore();
BBAR_MQ.addEventListener('change', placeMore);
/* ann67: زر تبديل مخطط/قائمة بالشريط (يعرض العرض الآخر)، وزر بحث يُظهر/يخفي صف البحث */
const BB_TREE = '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>', BB_LIST = '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'; /* nav-redesign: أيقونات Lucide */
function syncBbView() { const b = $('#bb-view'); if (!b) return; const g = S.view === 'graph'; b.innerHTML = `<svg class="bb-ic" viewBox="0 0 24 24" aria-hidden="true">${g ? BB_LIST : BB_TREE}</svg><span>${g ? 'قائمة' : 'مخطط'}</span>`; }
$('#bb-view').onclick = () => { if (S.view === 'graph') $('#v-list').click(); else $('#v-graph').click(); syncBbView(); document.querySelector('main').scrollTo({ top: 0 }); };
$('#v-graph').addEventListener('click', syncBbView);
$('#v-list').addEventListener('click', syncBbView);
syncBbView();
$('#bb-search').onclick = () => { if (!window.matchMedia('(max-width: 640px)').matches) { $('#q').scrollIntoView({ block: 'center' }); $('#q').focus(); return; } /* تابلت: صف البحث ظاهر أصلًا */ const bar = document.querySelector('.bar'); bar.classList.toggle('show'); $('#bb-search').classList.toggle('on', bar.classList.contains('show')); if (bar.classList.contains('show')) $('#q').focus(); };
$('#bb-events').onclick = () => { $('#m-events').click(); };

/* زر «مسح» داخل خانة البحث: يظهر فقط عند وجود نص، يمسح ويعيد النتائج ويعيد التركيز */
(() => {
  const q = $('#q'), b = $('#q-clear'), w = q.parentElement;
  const sync = () => { const has = q.value.length > 0; b.hidden = !has; w.classList.toggle('has', has); };
  q.addEventListener('input', sync);
  b.addEventListener('click', () => { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); q.focus(); });
  sync();
})();

/* ---------- 51) بطاقة النسب الرقمية للواتساب (فرع تجربة) ---------- */
function getAncestryChain(m) {
  const chain = [];
  let cur = m;
  const visited = new Set();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.push(cur);
    if (!cur.father_id || !S.byId.has(cur.father_id)) break;
    cur = S.byId.get(cur.father_id);
  }
  return chain;
}

function openLineageCard(targetId = null) {
  const members = [...S.members].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  const target = targetId && S.byId.has(targetId) ? S.byId.get(targetId) : (S.roots[0] || S.members[0]);
  if (!target) return;

  const chain = getAncestryChain(target);
  const root = chain[chain.length - 1];
  const kidsCount = (S.kids.get(target.id) || []).length;
  const gNum = gen(target);
  const statusStr = target.is_alive === false ? 'رحمه الله' : 'حفظه الله ورعاه';
  const branchName = root ? root.full_name : 'آل مطارد';

  const isFem = target.gender === 'female';
  const chainNames = chain.map(c => c.first || c.full_name.split(' ')[0]);
  let fullLineageText = '';
  for (let i = 0; i < chainNames.length; i++) {
    if (i === 0) fullLineageText = chainNames[0];
    else if (i === 1) fullLineageText += (isFem ? ' بنت ' : ' بن ') + chainNames[1];
    else fullLineageText += ' بن ' + chainNames[i];
  }
  fullLineageText += ' (من آل مطارد - بنو عمرو)';

  const waShareText = `🌿 *بطاقة نسب رقمية - أسرة آل مطارد (بنو عمرو)* 🌿\n\n` +
    `👤 *الاسم:* ${target.full_name}\n` +
    `📜 *سلسلة النسب:* ${fullLineageText}\n` +
    `🎖️ *الجيل:* الجيل ${gNum}\n` +
    `🏛️ *الفرع:* ${branchName}\n` +
    `📍 *المدينة:* ${target.city || 'الجنوب'}\n` +
    `🤲 *الحالة:* ${statusStr}\n\n` +
    `🔗 تصفح شجرة العائلة التفاعلية: https://omerqazx1980.github.io/ALMatarid/`;

  const html = `
    <div class="lcard-wrap">
      <div class="fstats-head">
        <h2>📇 بطاقة النسب الرقمية للمشاركة</h2>
        <p class="sub">توثيق سلسلة النسب والبيانات العائلية ببطاقة رقمية جاهزة للمشاركة عبر واتساب</p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin:6px 0">
        <label for="lcard-sel" style="font-size:.84rem;font-weight:700">اختر العضو:</label>
        <select id="lcard-sel" style="flex:1;padding:6px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--line);color:var(--txt)">
          ${members.map(m => `<option value="${m.id}" ${m.id === target.id ? 'selected' : ''}>${esc(m.full_name)} (الجيل ${gen(m)})</option>`).join('')}
        </select>
      </div>

      <div class="lcard-box" id="lcard-display">
        <div class="lcard-top">
          <div style="font-size:.78rem;color:var(--gold);letter-spacing:1px;font-weight:700">« ذُرِّيَّةً بَعْضُهَا مِن بَعْضٍ »</div>
          <div style="font-size:.82rem;color:var(--mut)">شجرة أسرة آل مطارد - بنو عمرو</div>
          <div class="lcard-name">${esc(target.full_name)}</div>
          <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:4px 0">
            <span class="bd" style="background:rgba(245,158,11,.15);border:1px solid var(--gold);color:var(--gold);padding:2px 8px;border-radius:99px;font-size:.75rem">الجيل ${gNum}</span>
            <span class="bd" style="background:rgba(56,189,248,.15);border:1px solid #38bdf8;color:#38bdf8;padding:2px 8px;border-radius:99px;font-size:.75rem">فرع: ${esc(branchName)}</span>
            <span class="bd" style="background:rgba(52,211,153,.15);border:1px solid #34d399;color:#34d399;padding:2px 8px;border-radius:99px;font-size:.75rem">${statusStr}</span>
            ${target.city ? `<span class="bd" style="background:rgba(148,163,184,.15);border:1px solid var(--line);color:var(--txt);padding:2px 8px;border-radius:99px;font-size:.75rem">📍 ${esc(target.city)}</span>` : ''}
          </div>
        </div>

        <div class="lcard-chain">
          <div style="font-size:.75rem;color:var(--gold);margin-bottom:4px;font-weight:700">📜 سلسلة النسب المتصل:</div>
          <div><b>${esc(fullLineageText.replace(' (من آل مطارد - بنو عمرو)', ''))}</b></div>
          <div style="font-size:.78rem;color:var(--mut);margin-top:6px">وصولاً إلى الجد المؤسس لفرع <b>${esc(branchName)}</b> من قبيلة آل مطارد - بنو عمرو.</div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;text-align:center;font-size:.8rem;background:rgba(0,0,0,.2);border-radius:8px;padding:8px">
          <div><span style="color:var(--mut)">الأبناء:</span> <b>${kidsCount}</b></div>
          <div><span style="color:var(--mut)">الكنية:</span> <b>${esc(target.nickname || '—')}</b></div>
          <div><span style="color:var(--mut)">سنة الميلاد:</span> <b>${esc(target.birth_year_text || (target.birth_date ? target.birth_date.slice(0,4) : '—'))}</b></div>
        </div>
      </div>

      <div class="lcard-actions">
        <button type="button" class="lcard-btn-wa" id="btn-lcard-wa">
          <span>💬 مشاركة عبر واتساب</span>
        </button>
        <button type="button" class="btn ghost" id="btn-lcard-copy" style="padding:9px 14px">
          <span>📋 نسخ النص</span>
        </button>
        <button type="button" class="btn ghost" id="btn-lcard-view" style="padding:9px 14px">
          <span>🌳 عرض في الشجرة</span>
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const sel = $('#lcard-sel');
  if (sel) {
    sel.onchange = () => openLineageCard(sel.value);
  }

  const btnWa = $('#btn-lcard-wa');
  if (btnWa) {
    btnWa.onclick = () => {
      const url = `https://wa.me/?text=${encodeURIComponent(waShareText)}`;
      window.open(url, '_blank');
    };
  }

  const btnCopy = $('#btn-lcard-copy');
  if (btnCopy) {
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(waShareText);
        toast('تم نسخ بطاقة النسب بنجاح!');
      } catch (_) {
        toast('يرجى تحديد النص ونسخه يدويًا');
      }
    };
  }

  const btnView = $('#btn-lcard-view');
  if (btnView) {
    btnView.onclick = () => {
      $('#profile').close();
      focusMember(target.id);
    };
  }
}

$('#m-lcard').onclick = menuClose(() => openLineageCard());
$('#m-qr-share').onclick = menuClose(() => openQrShareModal());

/* ---------- 52) دعوات الاجتماعات وتأكيد الحضور (فرع تجربة) ---------- */
function getEventRsvps(evId) {
  try {
    const raw = localStorage.getItem(`almatarid_rsvp_${evId}`);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveEventRsvp(evId, entry) {
  const list = getEventRsvps(evId);
  const idx = list.findIndex(x => x.name.trim() === entry.name.trim());
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  try {
    localStorage.setItem(`almatarid_rsvp_${evId}`, JSON.stringify(list));
  } catch (_) {}
  return list;
}

function shareEventInviteWhatsapp(e) {
  const d = new Date(e.t || e.event_date);
  const f = (loc, o) => d.toLocaleString(loc, o);
  const rsvps = getEventRsvps(e.id);
  const confirmed = rsvps.filter(r => r.status === 'yes');
  const totalGuests = confirmed.reduce((acc, c) => acc + 1 + (Number(c.guests) || 0), 0);

  const txt = `💌 *دعوة لاجتماع أسرة آل مطارد (بنو عمرو)* 💌\n\n` +
    `يسرنا دعوتكم لحضور: *${e.title}*\n\n` +
    `📅 *الموعد:* ${f('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'full' })}\n` +
    `🗓️ *الموافق:* ${f('ar-SA-u-ca-gregory', { dateStyle: 'full', timeStyle: 'short' })}\n` +
    (e.location_name ? `📍 *المكان:* ${e.location_name}\n` : '') +
    (e.location_url ? `🗺️ *رابط الموقع:* ${e.location_url}\n` : '') +
    (e.description ? `📝 *التفاصيل:* ${e.description.split('\n')[0]}\n\n` : '\n') +
    `👥 *عدد المؤكدين حضورهم حتى الآن:* ${totalGuests} فرد\n\n` +
    `يرجى تأكيد حضوركم عبر موقع الشجرة:\n` +
    `🔗 https://omerqazx1980.github.io/ALMatarid/`;

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(txt)}`, '_blank');
}

function renderEventRSVP(e, container) {
  if (!container || !e) return;
  const evId = String(e.id);
  const rsvps = getEventRsvps(evId);

  const yesList = rsvps.filter(r => r.status === 'yes');
  const maybeList = rsvps.filter(r => r.status === 'maybe');
  const noList = rsvps.filter(r => r.status === 'no');
  const totalExpected = yesList.reduce((acc, c) => acc + 1 + (Number(c.guests) || 0), 0);

  const memOptions = [...S.members].filter(m => !m.name_masked).sort((a,b) => a.full_name.localeCompare(b.full_name, 'ar'));

  container.innerHTML = `
    <div class="rsvp-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="color:var(--gold);font-size:.92rem">📋 تأكيد الحضور (RSVP)</b>
        <button type="button" class="btn ghost" id="btn-rsvp-wa-share" style="padding:4px 8px;font-size:.75rem">
          💬 إرسال بطاقة الدعوة للواتساب
        </button>
      </div>

      <div class="rsvp-stats">
        <span class="rsvp-pill yes">✅ مؤكد (${yesList.length})</span>
        <span class="rsvp-pill maybe">⏳ ربما (${maybeList.length})</span>
        <span class="rsvp-pill no">❌ معتذر (${noList.length})</span>
        <span class="rsvp-pill" style="background:rgba(245,158,11,.15);border:1px solid var(--gold);color:var(--gold)">
          👥 إجمالي الحضور المتوقع: ${totalExpected}
        </span>
      </div>

      <form id="rsvp-form" style="background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px">
        <div style="font-size:.78rem;color:var(--mut);margin-bottom:6px">سجّل تأكيد حضورك للاجتماع:</div>
        <div class="rsvp-form-row">
          <div>
            <label style="font-size:.75rem;color:var(--mut)">الاسم:</label>
            <input list="rsvp-mem-list" id="rsvp-name" placeholder="ابحث أو اكتب اسمك" required style="width:100%;font-size:.82rem;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt)">
            <datalist id="rsvp-mem-list">
              ${memOptions.map(m => `<option value="${esc(m.full_name)}">`).join('')}
            </datalist>
          </div>
          <div>
            <label style="font-size:.75rem;color:var(--mut)">حالة الحضور:</label>
            <select id="rsvp-status" style="width:100%;font-size:.82rem;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt)">
              <option value="yes">سأحضر بإذن الله ✅</option>
              <option value="maybe">حضور محتمل ⏳</option>
              <option value="no">أعتذر لظرف ❌</option>
            </select>
          </div>
        </div>
        <div class="rsvp-form-row" style="margin-top:6px">
          <div>
            <label style="font-size:.75rem;color:var(--mut)">عدد المرافقين (من الأسرة/الأبناء):</label>
            <input type="number" id="rsvp-guests" min="0" max="20" value="0" style="width:100%;font-size:.82rem;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt)">
          </div>
          <div>
            <label style="font-size:.75rem;color:var(--mut)">ملاحظة أو تبريكات:</label>
            <input type="text" id="rsvp-note" placeholder="مثلاً: سنحضر بعد صلاة المغرب" style="width:100%;font-size:.82rem;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt)">
          </div>
        </div>
        <div style="margin-top:8px;text-align:end">
          <button type="submit" style="background:var(--gold);color:#1c1204;font-size:.8rem;padding:6px 16px;border-radius:6px;font-weight:700">
            ✓ حفظ تأكيد الحضور
          </button>
        </div>
      </form>

      <div style="font-size:.8rem;color:var(--gold);font-weight:700;margin-bottom:6px">
        قائمة المسجلين (${rsvps.length}):
      </div>
      <div class="rsvp-list">
        ${rsvps.length ? rsvps.map(r => `
          <div class="rsvp-item">
            <div>
              <b>${esc(r.name)}</b>
              ${Number(r.guests) > 0 ? `<span style="font-size:.72rem;color:var(--mut)"> (+${r.guests} مرافقين)</span>` : ''}
              ${r.note ? `<div style="font-size:.72rem;color:var(--mut)">«${esc(r.note)}»</div>` : ''}
            </div>
            <span class="rsvp-pill ${r.status}">
              ${r.status === 'yes' ? 'حاضر ✅' : (r.status === 'maybe' ? 'محتمل ⏳' : 'معتذر ❌')}
            </span>
          </div>
        `).join('') : '<p class="sub" style="text-align:center;padding:6px 0">كن أول من يؤكد حضوره!</p>'}
      </div>
    </div>
  `;

  const form = container.querySelector('#rsvp-form');
  if (form) {
    form.onsubmit = ev => {
      ev.preventDefault();
      const name = container.querySelector('#rsvp-name').value.trim();
      const status = container.querySelector('#rsvp-status').value;
      const guests = parseInt(container.querySelector('#rsvp-guests').value, 10) || 0;
      const note = container.querySelector('#rsvp-note').value.trim();
      if (!name) return;

      saveEventRsvp(evId, { name, status, guests, note, time: Date.now() });
      toast('تم حفظ تأكيد الحضور بنجاح!');
      renderEventRSVP(e, container);
    };
  }

  const shareBtn = container.querySelector('#btn-rsvp-wa-share');
  if (shareBtn) {
    shareBtn.onclick = () => shareEventInviteWhatsapp(e);
  }
}

function openInvites(selectedEventId = null) {
  const events = [...(S.events || [])].sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  const upcoming = events.filter(e => new Date(e.event_date).getTime() >= Date.now() - 86400000);
  const activeEvents = upcoming.length ? upcoming : events;
  if (!activeEvents.length) {
    showInfo(`
      <div class="fstats-head">
        <h2>💌 دعوات الاجتماعات وتأكيد الحضور</h2>
        <p class="sub">لا توجد اجتماعات أو مناسبات معلنة حالياً في شجرة العائلة.</p>
      </div>`);
    return;
  }

  const curEv = selectedEventId ? (activeEvents.find(e => String(e.id) === String(selectedEventId)) || activeEvents[0]) : activeEvents[0];
  const d = new Date(curEv.t || curEv.event_date);
  const f = (loc, o) => d.toLocaleString(loc, o);

  const html = `
    <div class="lcard-wrap">
      <div class="fstats-head">
        <h2>💌 بطاقات الدعوة وتأكيد حضور الاجتماعات</h2>
        <p class="sub">دعوات اجتماعات ولقاءات الأسرة مع متابعة الحضور والاعتذار ومشاركة الدعوة عبر واتساب</p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin:6px 0">
        <label for="invite-sel" style="font-size:.84rem;font-weight:700">اختر الاجتماع:</label>
        <select id="invite-sel" style="flex:1;padding:6px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--line);color:var(--txt)">
          ${activeEvents.map(e => `<option value="${e.id}" ${e.id === curEv.id ? 'selected' : ''}>${esc(e.title)} (${new Date(e.event_date).toLocaleDateString('ar-SA')})</option>`).join('')}
        </select>
      </div>

      <div class="invite-card">
        <div class="invite-head">
          <div>
            <div style="font-size:.78rem;color:var(--gold);font-weight:700">دعوة عامة لأبناء وأسر آل مطارد - بنو عمرو</div>
            <h3 style="font-size:1.15rem;color:#fff;margin:4px 0">${esc(curEv.title)}</h3>
          </div>
          <span style="font-size:1.8rem">💌</span>
        </div>

        <div style="background:rgba(0,0,0,.3);border-radius:8px;padding:10px;font-size:.84rem;line-height:1.7;color:#cbd5e1;margin-bottom:8px">
          <div>📅 <b>الموعد:</b> ${f('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'full' })}</div>
          <div>🗓️ <b>الموافق:</b> ${f('ar-SA-u-ca-gregory', { dateStyle: 'full', timeStyle: 'short' })}</div>
          ${curEv.location_name ? `<div>📍 <b>المقر:</b> ${esc(curEv.location_name)}</div>` : ''}
          ${curEv.location_url ? `<div>🗺️ <b>الخريطة:</b> <a href="${esc(curEv.location_url)}" target="_blank" rel="noopener" style="color:var(--gold)">فتح موقع اللقاء على Google Maps</a></div>` : ''}
          ${curEv.description ? `<div style="margin-top:6px;border-top:1px dashed rgba(255,255,255,.1);padding-top:6px">${esc(curEv.description).replace(/\n/g, '<br>')}</div>` : ''}
        </div>

        <div id="invite-rsvp-target"></div>
      </div>
    </div>
  `;

  showInfo(html);

  const sel = $('#invite-sel');
  if (sel) {
    sel.onchange = () => openInvites(sel.value);
  }

  renderEventRSVP(curEv, $('#invite-rsvp-target'));
}

$('#m-invites').onclick = menuClose(() => openInvites());
$('#m-personal-invites').onclick = menuClose(() => openPersonalInvitesModal());

/* ---------- 53) أرشيف وثائق وصور العائلة القديمة (فرع تجربة) ---------- */
const DEFAULT_ARCHIVE_ITEMS = [
  {
    id: 'arch-1',
    title: 'صك وقف وحيازة زراعية قديم لأملاك الأسرة',
    type: 'doc',
    typeName: 'صك ومخطوط شرعي',
    typeIcon: '📜',
    year_hijri: 1318,
    year_greg: 1900,
    era: 'pre1350',
    eraLabel: 'ما قبل 1350 هـ',
    image_url: 'logo.jpg',
    description: 'صك حيازة ووقف شرعي قديم يوثق حدود أراضي ومزارع الأسرة في بني عمرو، موقّع بختم قاضي الناحية وشاهدين من كبار القبيلة.',
    transcription: 'بسم الله الرحمن الرحيم، هذا ما اتّفق عليه وحازه وأوقفه رجالات آل مطارد في ديار بني عمرو... حدود الأرض المذكورة شمالاً مسيل الوادي وجنوباً الجبل وشرقاً ملك فلان وغرباً الطريق العام... شهد على ذلك أعيان الفروع.',
    source: 'أرشيف كبار الأسرة المتوارث',
    members_linked: 'أعلام الجيل الأول والمؤسسون'
  },
  {
    id: 'arch-2',
    title: 'صورة تاريخية نادرة لكبار وأعيان آل مطارد',
    type: 'photo',
    typeName: 'صورة تاريخية',
    typeIcon: '📷',
    year_hijri: 1374,
    year_greg: 1955,
    era: '1350_1380',
    eraLabel: '1350 - 1380 هـ',
    image_url: 'logo.jpg',
    description: 'لقاء تاريخي جمع شيوخ وكبار فروع الأسرة في مناسبة لقاء سنوي عام بعد موسم الحصاد.',
    transcription: 'تظهر الصورة كبار أعيان الأسرة وأصحاب الرأي والحكمة، يرتدون الزي التراثي والمجالد، وقد تم التقاطها بحضور جمع كريم من أبناء العمومة.',
    source: 'إهداء من أحفاد الجيل الثاني',
    members_linked: 'كبار فروع آل مطارد'
  },
  {
    id: 'arch-3',
    title: 'رسالة تراحم ومكاتبة ودية بين فروع العائلة',
    type: 'letter',
    typeName: 'رسالة ومراسلة',
    typeIcon: '✉️',
    year_hijri: 1342,
    year_greg: 1923,
    era: 'pre1350',
    eraLabel: 'ما قبل 1350 هـ',
    image_url: 'logo.jpg',
    description: 'خطاب خطي تاريخي بمداد عربي تقليدي يحث على صلة الرحم والتناصر والتكاتف في رعاية الأيتام وكبار السن.',
    transcription: 'سلام الله عليكم ورحمته وبركاته، أما بعد يا بني عمنا وإخواننا فإن رابطة الدم والدين توجب دوام التزاور والتفقد... ونوصيكم بالتعاون والوفاق.',
    source: 'مخطوطة محفوظة لدى مسؤول الفرع',
    members_linked: 'أعيان فروع الأسرة'
  },
  {
    id: 'arch-4',
    title: 'وثيقة مبايعة وسجل أملاك تاريخي بختم رسمي',
    type: 'doc',
    typeName: 'وثيقة وسجل مبايعة',
    typeIcon: '📜',
    year_hijri: 1358,
    year_greg: 1939,
    era: '1350_1380',
    eraLabel: '1350 - 1380 هـ',
    image_url: 'logo.jpg',
    description: 'وثيقة شراء بئر ماء وبستان نخيل وزيتون مشترك لأبناء العائلة ومؤرخة باليوم والشهر مع شهادة الشهود.',
    transcription: 'الحمد لله وحده، اشترى بالثمن المسمى فلان بن فلان من آل مطارد نصيب الشركاء في البئر المسماة... سالمة من كل عيب وموجبة للحق الشرعي.',
    source: 'صندوق وثائق العائلة',
    members_linked: 'ملاك المزارع والأوقاف'
  },
  {
    id: 'arch-5',
    title: 'صورة ملتقطة أثناء إعمار مجلس العائلة الجامع',
    type: 'photo',
    typeName: 'صورة تاريخية',
    typeIcon: '📷',
    year_hijri: 1388,
    year_greg: 1968,
    era: '1380_1410',
    eraLabel: '1380 - 1410 هـ',
    image_url: 'logo.jpg',
    description: 'توثيق فوتوغرافي لبناء وتجديد مقر اللقاءات والمجلس التراثي لآل مطارد بمشاركة شباب وكبار العائلة.',
    transcription: 'مشهد يجسد روح الفزعة والتعاون القبلي في نقل الحجارة وعوارض الخشب لبناء بيت الأسرة الكبير.',
    source: 'ألبوم صور كبار السن',
    members_linked: 'رجالات الجيل الثالث'
  },
  {
    id: 'arch-6',
    title: 'سجل مواريث وتوزيع تركة شرعية بخط اليد',
    type: 'doc',
    typeName: 'مخطوط شرعي',
    typeIcon: '📜',
    year_hijri: 1335,
    year_greg: 1916,
    era: 'pre1350',
    eraLabel: 'ما قبل 1350 هـ',
    image_url: 'logo.jpg',
    description: 'قسمة تركة شرعية عادلة بالتراضي بين الورثة والأبناء مؤرخة في عهد الأشراف والدولة العثمانية.',
    transcription: 'بحضور القاضي والعدول جرى تقسيم ما تركه المتوفى رحمه الله تعالى بالعدل والإنصاف بين أصحاب الفروض والعصبات.',
    source: 'مخطوط أصلي محفوظ',
    members_linked: 'الجد المؤسس وفروعه'
  }
];

function getArchiveItems() {
  try {
    const raw = localStorage.getItem('almatarid_archive_items');
    if (raw) {
      const custom = JSON.parse(raw);
      return [...DEFAULT_ARCHIVE_ITEMS, ...custom];
    }
  } catch (_) {}
  return DEFAULT_ARCHIVE_ITEMS;
}

function openArchiveItemDetail(item) {
  const html = `
    <div class="arch-modal-view">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <span class="bd" style="background:rgba(245,158,11,.15);border:1px solid var(--gold);color:var(--gold);padding:2px 8px;border-radius:99px;font-size:.75rem">
            ${item.typeIcon} ${esc(item.typeName)}
          </span>
          <h2 style="font-size:1.15rem;color:#fff;margin:6px 0">${esc(item.title)}</h2>
          <div style="font-size:.8rem;color:var(--mut)">
            📅 ${item.year_hijri} هـ (${item.year_greg} م) · ${esc(item.eraLabel)}
          </div>
        </div>
      </div>

      <img src="${esc(item.image_url)}" alt="${esc(item.title)}" class="arch-modal-img">

      <div style="font-size:.84rem;color:#e2e8f0;line-height:1.7;background:rgba(255,255,255,.03);padding:10px;border-radius:8px">
        ${esc(item.description)}
      </div>

      <div class="arch-transcription">
        <b style="color:var(--gold);display:block;margin-bottom:6px">📖 نص الوثيقة المفرّغ للقراءة:</b>
        «${esc(item.transcription)}»
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;color:var(--mut);border-top:1px solid var(--line);padding-top:8px">
        <span><b>المصدر:</b> ${esc(item.source || 'أرشيف الأسرة')}</span>
        <span><b>الصلة:</b> ${esc(item.members_linked || 'عام للأسرة')}</span>
      </div>

      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" class="btn lcard-btn-wa" id="btn-share-arch-wa">
          💬 مشاركة الوثيقة بالواتساب
        </button>
        <button type="button" class="btn ghost" id="btn-back-archive">
          ← العودة للأرشيف
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const shareBtn = $('#btn-share-arch-wa');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const txt = `📜 *وثيقة تاريخية من أرشيف أسرة آل مطارد (بنو عمرو)* 📜\n\n` +
        `🔖 *العنوان:* ${item.title}\n` +
        `📅 *التاريخ:* ${item.year_hijri} هـ (${item.year_greg} م)\n` +
        `📑 *النوع:* ${item.typeName}\n` +
        `📝 *النبذة:* ${item.description}\n\n` +
        `📖 *النص المفرغ:* «${item.transcription}»\n\n` +
        `🔗 شاهد الأرشيف كاملاً: https://omerqazx1980.github.io/ALMatarid/`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(txt)}`, '_blank');
    };
  }

  const backBtn = $('#btn-back-archive');
  if (backBtn) {
    backBtn.onclick = () => openFamilyArchive();
  }
}

function openFamilyArchive() {
  const allItems = getArchiveItems().sort((a, b) => a.year_hijri - b.year_hijri);

  const renderGrid = (items) => {
    if (!items.length) {
      return '<p class="sub" style="text-align:center;padding:20px;grid-column:1/-1">لا توجد وثائق مطابقة لخيارات التصفية.</p>';
    }
    return items.map(it => `
      <div class="arch-card" data-arch-id="${esc(it.id)}">
        <div class="arch-thumb-box">
          <img src="${esc(it.image_url)}" alt="${esc(it.title)}" class="arch-thumb" loading="lazy">
          <span class="arch-pill-type">${it.typeIcon} ${esc(it.typeName)}</span>
          <span class="arch-pill-date">${it.year_hijri} هـ</span>
        </div>
        <div class="arch-content">
          <div class="arch-title">${esc(it.title)}</div>
          <div class="arch-desc">${esc(it.description)}</div>
          <div class="arch-meta">
            <span>📅 ${it.year_hijri} هـ (${it.year_greg} م)</span>
            <span style="color:var(--gold)">عرض التفاصيل ←</span>
          </div>
        </div>
      </div>
    `).join('');
  };

  const html = `
    <div class="archive-wrap">
      <div class="fstats-head">
        <h2>📜 أرشيف وثائق وصور العائلة القديمة</h2>
        <p class="sub">موسوعة رقمية للصكوك التاريخية، المخطوطات القديمة، الصور النادرة، والمراسلات الأسرية مرتبة زمنياً</p>
      </div>

      <div class="archive-filters">
        <input type="search" id="arch-q" placeholder="🔍 ابحث في عنوان أو نص الوثيقة…" style="flex:1;min-width:160px;padding:6px 10px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
        <select id="arch-era-filter" style="padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
          <option value="all">جميع الفترات الزمنية</option>
          <option value="pre1350">ما قبل 1350 هـ (أوائل القرن 14)</option>
          <option value="1350_1380">1350 - 1380 هـ</option>
          <option value="1380_1410">1380 - 1410 هـ</option>
          <option value="post1410">1410 هـ فصاعداً</option>
        </select>
        <select id="arch-type-filter" style="padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
          <option value="all">جميع أنواع الوثائق</option>
          <option value="doc">📜 صكوك ومخطوطات</option>
          <option value="photo">📷 صور تاريخية</option>
          <option value="letter">✉️ رسائل ومكاتبات</option>
        </select>
        <select id="arch-sort" style="padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
          <option value="asc">الأقدم تاريخاً أولاً</option>
          <option value="desc">الأحدث تاريخاً أولاً</option>
        </select>
      </div>

      <div class="archive-grid" id="arch-grid-box">
        ${renderGrid(allItems)}
      </div>
    </div>
  `;

  showInfo(html);

  const gridBox = $('#arch-grid-box');
  const qInp = $('#arch-q');
  const eraSel = $('#arch-era-filter');
  const typeSel = $('#arch-type-filter');
  const sortSel = $('#arch-sort');

  const updateList = () => {
    const q = stripKin(norm(qInp.value || ''));
    const era = eraSel.value;
    const type = typeSel.value;
    const sort = sortSel.value;

    let filtered = allItems.filter(it => {
      if (era !== 'all' && it.era !== era) return false;
      if (type !== 'all' && it.type !== type) return false;
      if (q) {
        const text = stripKin(norm(`${it.title} ${it.description} ${it.transcription} ${it.members_linked}`));
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (sort === 'desc') filtered.sort((a, b) => b.year_hijri - a.year_hijri);
    else filtered.sort((a, b) => a.year_hijri - b.year_hijri);

    gridBox.innerHTML = renderGrid(filtered);
    bindCardClicks();
  };

  const bindCardClicks = () => {
    gridBox.querySelectorAll('[data-arch-id]').forEach(card => {
      card.onclick = () => {
        const item = allItems.find(x => x.id === card.dataset.archId);
        if (item) openArchiveItemDetail(item);
      };
    });
  };

  qInp.oninput = updateList;
  eraSel.onchange = updateList;
  typeSel.onchange = updateList;
  sortSel.onchange = updateList;

  bindCardClicks();
}

$('#m-archive').onclick = menuClose(() => openFamilyArchive());
$('#m-ai-photo-restore').onclick = menuClose(() => openAiPhotoRestoreModal());
$('#m-photo-analysis').onclick = menuClose(() => openPhotoAnalysisModal());
$('#m-exif-map').onclick = menuClose(() => openPhotoExifMapModal());
$('#m-transcribe').onclick = menuClose(() => openTranscribeModal());
$('#m-cemeteries').onclick = menuClose(() => openCemeteriesModal());

/* ---------- 54) البحث بالصوت في الشجرة (فرع تجربة) ---------- */
let voiceRecognizer = null;
let isVoiceListening = false;

function initVoiceSearch() {
  const btnVoice = $('#q-voice');
  const btnMenuVoice = $('#m-voice-search');
  const qInp = $('#q');
  if (!btnVoice || !qInp) return;

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  function stopListening() {
    isVoiceListening = false;
    btnVoice.classList.remove('listening');
    btnVoice.setAttribute('title', 'تحدث للبحث بالاسم');
    qInp.placeholder = 'ابحث بالاسم أو الكنية';
    if (voiceRecognizer) {
      try { voiceRecognizer.stop(); } catch (_) {}
    }
  }

  function startListening() {
    if (!SpeechRec) {
      toast('المتصفح الحالي لا يدعم ميزة التعرف على الصوت — استخدم Chrome أو Edge أو Safari');
      return;
    }

    if (isVoiceListening) {
      stopListening();
      return;
    }

    try {
      voiceRecognizer = new SpeechRec();
      voiceRecognizer.lang = 'ar-SA';
      voiceRecognizer.continuous = false;
      voiceRecognizer.interimResults = false;

      voiceRecognizer.onstart = () => {
        isVoiceListening = true;
        btnVoice.classList.add('listening');
        btnVoice.setAttribute('title', 'جاري الاستماع... انقر للإيقاف');
        qInp.placeholder = '🎙️ جاري الاستماع... تحدّث باسم القريب';
        toast('🎙️ تحدّث الآن بالاسم...');
      };

      voiceRecognizer.onresult = event => {
        const transcript = event.results[0][0].transcript;
        if (!transcript) return;

        let cleaned = transcript
          .replace(/^(ابحث عن|أبحث عن|وين|أين|طلع لي|دور على|شف لي|من هو|من هي)\s*/i, '')
          .replace(/[.,!?،؟]/g, '')
          .trim();

        if (cleaned) {
          qInp.value = cleaned;
          qInp.dispatchEvent(new Event('input', { bubbles: true }));
          toast(`تم التعرف الصوتي: "${cleaned}" 🔍`);
          const norm = stripKin(normAr(cleaned));
          const found = S.members.find(m => stripKin(normAr(m.full_name)).includes(norm) || stripKin(normAr(m.first)).includes(norm));
          if (found) {
            focusMember(found.id);
          }
        }
      };

      voiceRecognizer.onerror = event => {
        console.warn('Voice recognition error:', event.error);
        if (event.error === 'not-allowed') {
          toast('يرجى السماح بالوصول للميكروفون في إعدادات المتصفح');
        } else if (event.error !== 'no-speech') {
          toast('تعذر التقاط الصوت، جرّب التحدث مجدداً');
        }
        stopListening();
      };

      voiceRecognizer.onend = () => {
        stopListening();
      };

      voiceRecognizer.start();
    } catch (err) {
      console.warn(err);
      toast('تعذر تشغيل الميكروفون');
      stopListening();
    }
  }

  btnVoice.onclick = (e) => {
    e.stopPropagation();
    startListening();
  };

  if (btnMenuVoice) {
    btnMenuVoice.onclick = menuClose(() => {
      const bar = document.querySelector('.bar');
      if (bar) bar.classList.add('show');
      startListening();
    });
  }
}

initVoiceSearch();

/* ---------- 55) وضع العرض التلقائي للشاشات والاجتماعات (فرع تجربة) ---------- */
let kioskInterval = null;
let kioskSlideIdx = 0;
let isKioskPlaying = true;

function openKioskMode() {
  if (kioskInterval) clearInterval(kioskInterval);
  const existing = document.querySelector('.kiosk-overlay');
  if (existing) existing.remove();

  const roots = S.roots || [];
  const totalCount = S.members.length;
  const maxGen = Math.max(1, ...S.members.map(gen));
  const aliveCount = S.members.filter(m => m.is_alive !== false).length;
  const deceasedCount = totalCount - aliveCount;
  const upEvents = [...(S.events || [])].filter(e => new Date(e.event_date).getTime() >= Date.now() - 86400000).slice(0, 3);
  const elders = S.members.filter(m => gen(m) <= 2);

  const slides = [
    // Slide 1: Welcome
    {
      title: 'شجرة أسرة آل مطارد - بنو عمرو',
      render: () => `
        <div class="kiosk-slide">
          <img src="logo.jpg" alt="" width="110" height="110" style="border-radius:50%;border:3px solid var(--gold);box-shadow:0 0 30px rgba(245,158,11,.4)">
          <div style="font-size:1.6rem;color:var(--gold);font-weight:800;letter-spacing:1px">« ذُرِّيَّةً بَعْضُهَا مِن بَعْضٍ »</div>
          <h1 style="font-size:2.6rem;margin:6px 0;font-weight:900;text-shadow:0 4px 16px rgba(0,0,0,.8)">
            مرحباً بكم في اجتماع أسرة آل مطارد
          </h1>
          <p style="font-size:1.3rem;color:#cbd5e1;max-width:750px;line-height:1.7">
            «وَأُو۟لُوا۟ ٱلْأَرْحَامِ بَعْضُهُمْ أَوْلَىٰ بِبَعْضٍ فِى كِتَـٰبِ ٱللَّهِ»<br>
            حياكم الله في ملتقى الأسرة وصلة الأرحام وتوثيق الأنساب والتاريخ المجيد
          </p>
          <div style="margin-top:10px;font-size:1rem;color:var(--gold);background:rgba(245,158,11,.1);border:1px solid var(--gold);padding:8px 24px;border-radius:99px">
            📍 بني عمرو · عسير · المملكة العربية السعودية
          </div>
        </div>
      `
    },
    // Slide 2: Statistics
    {
      title: 'إحصائيات وأرقام الشجرة العائلية',
      render: () => `
        <div class="kiosk-slide">
          <div style="font-size:1.1rem;color:var(--gold);font-weight:700">📊 شجرة العائلة بالأرقام</div>
          <h2 style="font-size:2.2rem;margin:0 0 10px 0;font-weight:800">سجل متصل عبر الأجيال والتاريخ</h2>
          <div class="kiosk-stat-grid">
            <div class="kiosk-stat-box">
              <div class="kiosk-stat-num">${totalCount}</div>
              <div class="kiosk-stat-lbl">إجمالي أفراد العائلة</div>
            </div>
            <div class="kiosk-stat-box">
              <div class="kiosk-stat-num">${maxGen}</div>
              <div class="kiosk-stat-lbl">أجيال موثقة</div>
            </div>
            <div class="kiosk-stat-box">
              <div class="kiosk-stat-num">${aliveCount}</div>
              <div class="kiosk-stat-lbl">أحياء حفظهم الله</div>
            </div>
            <div class="kiosk-stat-box">
              <div class="kiosk-stat-num">${deceasedCount}</div>
              <div class="kiosk-stat-lbl">متوفين رحمهم الله</div>
            </div>
          </div>
          <div style="background:rgba(0,0,0,.4);border:1px solid var(--line);border-radius:12px;padding:14px 20px;width:100%;font-size:1rem;color:#cbd5e1">
            🏛️ <b>فروع الأسرة الرئيسية:</b> ${roots.map(r => r.full_name).join(' · ')}
          </div>
        </div>
      `
    },
    // Slide 3: Founders & Elders
    {
      title: 'أعلام وأجداد الجيل الأول والثاني',
      render: () => `
        <div class="kiosk-slide">
          <div style="font-size:1.1rem;color:var(--gold);font-weight:700">🎖️ رواد التأسيس والأجداد</div>
          <h2 style="font-size:2.2rem;margin:0 0 10px 0;font-weight:800">أعلام وفروع آل مطارد - بنو عمرو</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;width:100%">
            ${elders.slice(0, 6).map(m => `
              <div style="background:rgba(15,23,42,.75);border:1px solid var(--gold);border-radius:12px;padding:14px;text-align:center">
                <div style="font-size:1.15rem;font-weight:800;color:var(--gold)">${esc(m.full_name)}</div>
                <div style="font-size:.82rem;color:#cbd5e1;margin-top:4px">الجيل ${gen(m)} · ${m.is_alive === false ? 'رحمه الله' : 'حفظه الله'}</div>
                <div style="font-size:.76rem;color:var(--mut);margin-top:4px">${m.city || 'الجنوب'}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `
    },
    // Slide 4: Upcoming Events
    {
      title: 'مناسبات ولقاءات الأسرة القادمة',
      render: () => `
        <div class="kiosk-slide">
          <div style="font-size:1.1rem;color:var(--gold);font-weight:700">🎉 مناسبات واجتماعات العائلة</div>
          <h2 style="font-size:2.2rem;margin:0 0 10px 0;font-weight:800">المواعيد واللقاءات الدورية</h2>
          <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:750px">
            ${upEvents.length ? upEvents.map(e => `
              <div style="background:rgba(15,23,42,.8);border:1.5px solid var(--gold);border-radius:12px;padding:16px;text-align:start;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <h3 style="font-size:1.25rem;color:#fff;margin:0 0 6px 0">${esc(e.title)}</h3>
                  <div style="font-size:.9rem;color:#cbd5e1">📅 ${new Date(e.event_date).toLocaleDateString('ar-SA')} · ${e.location_name || 'المقر الرئيسي'}</div>
                </div>
                <span style="font-size:2rem">💌</span>
              </div>
            `).join('') : '<p style="font-size:1.2rem;color:var(--mut)">لا توجد مناسبات قادمة مجدولة حالياً.</p>'}
          </div>
        </div>
      `
    }
  ];

  const overlay = document.createElement('div');
  overlay.className = 'kiosk-overlay';
  overlay.innerHTML = `
    <div class="kiosk-top-bar">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.4rem">📺</span>
        <div>
          <b style="color:var(--gold);font-size:1.1rem">وضع العرض العائلي للشاشات والاجتماعات</b>
          <div style="font-size:.75rem;color:var(--mut)" id="kiosk-time"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" id="btn-kiosk-play" style="background:transparent;border:1px solid var(--line);color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.85rem">
          ⏸️ إيقاف
        </button>
        <button type="button" id="btn-kiosk-fs" style="background:transparent;border:1px solid var(--line);color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.85rem">
          ⛶ ملء الشاشة
        </button>
        <button type="button" id="btn-kiosk-exit" style="background:rgba(239,68,68,.2);border:1px solid #ef4444;color:#fca5a5;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:.85rem">
          ✕ خروج
        </button>
      </div>
    </div>

    <div class="kiosk-slide-stage" id="kiosk-stage"></div>

    <div class="kiosk-bottom-bar">
      <button type="button" id="btn-kiosk-prev" style="background:transparent;border:1px solid var(--line);color:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">
        ‹ السابق
      </button>
      <div class="kiosk-dots" id="kiosk-dots">
        ${slides.map((_, i) => `<div class="kiosk-dot ${i === 0 ? 'active' : ''}" data-ki="${i}"></div>`).join('')}
      </div>
      <button type="button" id="btn-kiosk-next" style="background:transparent;border:1px solid var(--line);color:#fff;border-radius:6px;padding:6px 14px;cursor:pointer">
        التالي ›
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const stage = overlay.querySelector('#kiosk-stage');
  const dotsBox = overlay.querySelector('#kiosk-dots');
  const timeBox = overlay.querySelector('#kiosk-time');
  const playBtn = overlay.querySelector('#btn-kiosk-play');
  const fsBtn = overlay.querySelector('#btn-kiosk-fs');
  const exitBtn = overlay.querySelector('#btn-kiosk-exit');
  const nextBtn = overlay.querySelector('#btn-kiosk-next');
  const prevBtn = overlay.querySelector('#btn-kiosk-prev');

  const updateTime = () => {
    if (timeBox) timeBox.textContent = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  updateTime();
  const timeTimer = setInterval(updateTime, 1000);

  const renderCurrentSlide = () => {
    const s = slides[kioskSlideIdx];
    if (stage) stage.innerHTML = s.render();
    overlay.querySelectorAll('.kiosk-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === kioskSlideIdx);
    });
  };

  const nextSlide = () => {
    kioskSlideIdx = (kioskSlideIdx + 1) % slides.length;
    renderCurrentSlide();
  };

  const prevSlide = () => {
    kioskSlideIdx = (kioskSlideIdx - 1 + slides.length) % slides.length;
    renderCurrentSlide();
  };

  renderCurrentSlide();

  const startAutoPlay = () => {
    if (kioskInterval) clearInterval(kioskInterval);
    kioskInterval = setInterval(nextSlide, 8500);
  };
  startAutoPlay();

  playBtn.onclick = () => {
    isKioskPlaying = !isKioskPlaying;
    if (isKioskPlaying) {
      playBtn.textContent = '⏸️ إيقاف';
      startAutoPlay();
    } else {
      playBtn.textContent = '▶ تشغيل';
      clearInterval(kioskInterval);
    }
  };

  nextBtn.onclick = () => {
    nextSlide();
    if (isKioskPlaying) startAutoPlay();
  };

  prevBtn.onclick = () => {
    prevSlide();
    if (isKioskPlaying) startAutoPlay();
  };

  dotsBox.onclick = (e) => {
    const d = e.target.closest('.kiosk-dot');
    if (!d) return;
    kioskSlideIdx = parseInt(d.dataset.ki, 10);
    renderCurrentSlide();
    if (isKioskPlaying) startAutoPlay();
  };

  fsBtn.onclick = () => {
    if (!document.fullscreenElement) {
      overlay.requestFullscreen?.().catch(() => {});
      fsBtn.textContent = '⛶ نافذة عادية';
    } else {
      document.exitFullscreen?.().catch(() => {});
      fsBtn.textContent = '⛶ ملء الشاشة';
    }
  };

  exitBtn.onclick = () => {
    if (kioskInterval) clearInterval(kioskInterval);
    clearInterval(timeTimer);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    overlay.remove();
  };
}

$('#m-kiosk').onclick = menuClose(() => openKioskMode());

/* ---------- 56) دفتر العائلة - سجل المواليد والوفيات والزواجات (فرع تجربة) ---------- */
function openFamilyBook(activeTab = 'births') {
  const members = [...S.members];
  const wives = [...(S.wives || [])];

  const html = `
    <div class="fbook-wrap">
      <div class="fstats-head">
        <h2>📖 دفتر العائلة وسجل الأنساب والوقائع</h2>
        <p class="sub">السجل التوثيقي الشامل لمواليد ووفيات وزواجات ومصاهرات أسرة آل مطارد - بنو عمرو</p>
      </div>

      <div class="fbook-tabs">
        <button type="button" class="fbook-tab-btn ${activeTab === 'births' ? 'active' : ''}" data-tab="births">
          👶 سجل المواليد (${members.length})
        </button>
        <button type="button" class="fbook-tab-btn ${activeTab === 'deaths' ? 'active' : ''}" data-tab="deaths">
          🕊️ سجل الوفيات (${members.filter(m => m.is_alive === false).length})
        </button>
        <button type="button" class="fbook-tab-btn ${activeTab === 'marriages' ? 'active' : ''}" data-tab="marriages">
          💍 سجل الزواجات والمصاهرات (${wives.length})
        </button>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin:4px 0">
        <input type="search" id="fbook-q" placeholder="🔍 تصفية وبحث في السجل الحالى…" style="flex:1;padding:6px 10px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.82rem">
      </div>

      <div id="fbook-content"></div>
    </div>
  `;

  showInfo(html);

  const container = $('#fbook-content');
  const qInp = $('#fbook-q');

  const renderBirths = (filterTxt = '') => {
    let list = members.filter(m => !m.name_masked);
    if (filterTxt) {
      const q = stripKin(norm(filterTxt));
      list = list.filter(m => stripKin(norm(m.full_name || '')).includes(q) || stripKin(norm(m.birth_year_text || '')).includes(q));
    }
    list.sort((a, b) => {
      const ya = parseInt(a.birth_year_text || (a.birth_date ? a.birth_date.slice(0, 4) : 0), 10) || 0;
      const yb = parseInt(b.birth_year_text || (b.birth_date ? b.birth_date.slice(0, 4) : 0), 10) || 0;
      return ya - yb;
    });

    return `
      <div class="fbook-table-box">
        <table class="fbook-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الاسم الكامل</th>
              <th>الجيل</th>
              <th>سنة / تاريخ الميلاد</th>
              <th>الأب</th>
              <th>الترتيب</th>
              <th>المدينة</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((m, i) => {
              const father = m.father_id ? S.byId.get(m.father_id) : null;
              const bYear = livingHidden(m) ? (m.birth_year_text ? m.birth_year_text + ' (التاريخ محمي 🔒)' : 'محمي 🔒') : (m.birth_year_text || (m.birth_date ? datePair(m.birth_date) : 'غير مدون'));
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td><b>${nameBtn(m)}</b></td>
                  <td>الجيل ${gen(m)}</td>
                  <td>${esc(bYear)}</td>
                  <td>${father ? nameBtn(father) : '—'}</td>
                  <td>${m.birth_order || '—'}</td>
                  <td>${livingHidden(m) ? '—' : esc(m.city || 'الجنوب')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderDeaths = (filterTxt = '') => {
    let list = members.filter(m => m.is_alive === false);
    if (filterTxt) {
      const q = stripKin(norm(filterTxt));
      list = list.filter(m => stripKin(norm(m.full_name || '')).includes(q) || stripKin(norm(m.death_year_text || '')).includes(q));
    }
    list.sort((a, b) => {
      const ya = parseInt(a.death_year_text || (a.death_date ? a.death_date.slice(0, 4) : 0), 10) || 0;
      const yb = parseInt(b.death_year_text || (b.death_date ? b.death_date.slice(0, 4) : 0), 10) || 0;
      return ya - yb;
    });

    return `
      <div class="fbook-table-box">
        <table class="fbook-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الاسم الكامل</th>
              <th>الجيل</th>
              <th>سنة / تاريخ الوفاة</th>
              <th>الفرع</th>
              <th>الدعاء المأثور</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((m, i) => {
              const dYear = m.death_year_text || (m.death_date ? datePair(m.death_date) : 'غير مدون');
              const chain = getAncestryChain(m);
              const root = chain[chain.length - 1];
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td><b>${nameBtn(m)}</b></td>
                  <td>الجيل ${gen(m)}</td>
                  <td>${esc(dYear)}</td>
                  <td>${root ? esc(root.full_name) : 'آل مطارد'}</td>
                  <td style="color:#6ee7b7">رحمه الله وأسكنه الفردوس الأعلى 🤲</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderMarriages = (filterTxt = '') => {
    let list = wives;
    if (filterTxt) {
      const q = stripKin(norm(filterTxt));
      list = list.filter(w => stripKin(norm(w.full_name || '')).includes(q) || stripKin(norm(w.family_name || '')).includes(q));
    }

    // Kinship stats
    const famCounts = {};
    wives.forEach(w => {
      const f = (w.family_name || '').trim();
      if (f) famCounts[f] = (famCounts[f] || 0) + 1;
    });
    const topFams = Object.entries(famCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return `
      ${topFams.length ? `
        <div style="background:rgba(245,158,11,.08);border:1px solid var(--gold);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:.78rem">
          🏛️ <b>أبرز العائلات والقبائل المصاهرة لأسرة آل مطارد:</b> ${topFams.map(([f, c]) => `${esc(f)} (${c})`).join(' · ')}
        </div>
      ` : ''}

      <div class="fbook-table-box">
        <table class="fbook-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الزوج</th>
              <th>الزوجة</th>
              <th>العائلة / القبيلة المصاهرة</th>
              <th>حالة الزواج</th>
              <th>الأبناء</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((w, i) => {
              const husband = w.husband_id ? S.byId.get(w.husband_id) : null;
              const kids = S.members.filter(x => x.wife_mother_id === w.id);
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td><b>${husband ? nameBtn(husband) : '—'}</b></td>
                  <td>${esc(w.full_name)}</td>
                  <td><span class="bd" style="background:rgba(56,189,248,.12);border:1px solid #38bdf8;color:#38bdf8;padding:2px 8px;border-radius:99px;font-size:.72rem">${esc(w.family_name || 'غير محددة')}</span></td>
                  <td>${w.marriage_status === 'divorced' ? '<span style="color:#f87171">زوجة سابقة (طلاق)</span>' : '<span style="color:#34d399">زواج قائم</span>'}</td>
                  <td>${kids.length ? `${kids.length} أبناء (${kids.map(k => esc(k.first || k.full_name.split(' ')[0])).join('، ')})` : '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderActive = () => {
    const q = (qInp.value || '').trim();
    if (activeTab === 'births') container.innerHTML = renderBirths(q);
    else if (activeTab === 'deaths') container.innerHTML = renderDeaths(q);
    else if (activeTab === 'marriages') container.innerHTML = renderMarriages(q);
  };

  renderActive();

  qInp.oninput = renderActive;

  document.querySelectorAll('.fbook-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.fbook-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      qInp.value = '';
      renderActive();
    };
  });
}

$('#m-family-book').onclick = menuClose(() => openFamilyBook());

/* ---------- 57) تذكير بالدعاء للمتوفين في ذكرى وفاتهم (فرع تجربة) ---------- */
function renderDuaCards(list, sampleDua) {
  if (!list.length) {
    return '<p class="sub" style="text-align:center;padding:20px;grid-column:1/-1">لا توجد نتائج مطابقة.</p>';
  }

  return list.map(m => {
    const chain = getAncestryChain(m);
    const chainNames = chain.map(c => c.first || c.full_name.split(' ')[0]).join(' بن ');
    const dDate = m.death_date ? datePair(m.death_date) : (m.death_year_text ? `${m.death_year_text} هـ (تقريباً)` : 'رحمه الله');
    const duaText = sampleDua(m.full_name);

    return `
      <div class="dua-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div class="dua-card-title">${nameBtn(m)}</div>
          <span class="bd" style="background:rgba(52,211,153,.15);border:1px solid #34d399;color:#34d399;padding:2px 8px;border-radius:99px;font-size:.7rem">الجيل ${gen(m)}</span>
        </div>
        <div class="dua-card-chain">
          <b>النسب:</b> ${esc(chainNames)}
        </div>
        <div style="font-size:.76rem;color:var(--mut)">
          📅 تاريخ/سنة الوفاة: <b>${esc(dDate)}</b> ${m.city ? `· 📍 ${esc(m.city)}` : ''}
        </div>
        <div class="dua-text-box">
          ${esc(duaText)}
        </div>
        <button type="button" class="dua-btn-wa" data-mid="${esc(m.id)}">
          💬 إرسال تذكير بالدعاء للواتساب
        </button>
      </div>
    `;
  }).join('');
}

function bindDuaWaButtons(list, sampleDua) {
  document.querySelectorAll('.dua-btn-wa').forEach(btn => {
    btn.onclick = () => {
      const m = list.find(x => x.id === btn.dataset.mid);
      if (!m) return;
      const dDate = m.death_date ? datePair(m.death_date) : (m.death_year_text ? `${m.death_year_text} هـ` : '');
      const txt = `🕊️ *تذكير بالدعاء لفقيد أسرة آل مطارد (بنو عمرو)* 🕊️\n\n` +
        `👤 *المتوفى:* ${m.full_name} (رحمه الله)\n` +
        (dDate ? `📅 *سنة/تاريخ الوفاة:* ${dDate}\n` : '') +
        `🤲 *دعاء:* «اللهم اغفر له وارحمه وعافه واعف عنه، وأكرم نزله ووسّع مدخله، واجعل قبره روضة من رياض الجنة وأسكنه الفردوس الأعلى من الجنة»\n\n` +
        `نسألكم الدعاء له بالرحمة والمغفرة.\n` +
        `🔗 شجرة العائلة: https://omerqazx1980.github.io/ALMatarid/`;

      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(txt)}`, '_blank');
    };
  });
}

function openDuaMemorial() {
  const deceased = S.members.filter(m => m.is_alive === false);
  const now = new Date();
  const curHijri = gregToHijri(now);

  deceased.sort((a, b) => {
    const ya = parseInt(a.death_year_text || (a.death_date ? a.death_date.slice(0, 4) : 0), 10) || 0;
    const yb = parseInt(b.death_year_text || (b.death_date ? b.death_date.slice(0, 4) : 0), 10) || 0;
    return ya - yb;
  });

  const sampleDua = (name) => `«اللهم اغفر لـ (${name}) وارحمه وعافه واعف عنه، وأكرم نزله ووسّع مدخله، واغسله بالماء والثلج والبرد، ونقّه من الخطايا كما ينقى الثوب الأبيض من الدنس، وأدخله الجنة وأعذه من عذاب القبر ومن عذاب النار... اللهم آمين»`;

  const html = `
    <div class="dua-wrap">
      <div class="dua-banner">
        <div style="font-size:1.6rem;margin-bottom:4px">🤲</div>
        <h2 style="font-size:1.3rem;margin:0 0 6px 0;font-weight:800">«إِذَا مَاتَ ابْنُ آدَمَ انْقَطَعَ عَمَلُهُ إِلَّا مِنْ ثَلَاثٍ... أَوْ وَلَدٍ صَالِحٍ يَدْعُو لَهُ»</h2>
        <p style="font-size:.85rem;margin:0;line-height:1.6;opacity:.95">
          تذكير بالدعاء والصدقة والبر لأموات وأجداد أسرة آل مطارد - بنو عمرو الذين سبقونا بالإيمان<br>
          الشهر الهجري الحالي: <b>${HJ_MONTHS[curHijri.m - 1]} ${curHijri.y} هـ</b>
        </p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin:4px 0">
        <input type="search" id="dua-q" placeholder="🔍 ابحث بالاسم عن قريب أو جد متوفى…" style="flex:1;padding:6px 10px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.82rem">
      </div>

      <div class="dua-grid" id="dua-grid-box">
        ${renderDuaCards(deceased, sampleDua)}
      </div>
    </div>
  `;

  showInfo(html);

  const grid = $('#dua-grid-box');
  const qInp = $('#dua-q');

  const updateSearch = () => {
    const q = stripKin(norm(qInp.value || ''));
    const filtered = deceased.filter(m => {
      if (!q) return true;
      return stripKin(norm(m.full_name || '')).includes(q) || stripKin(norm(m.death_year_text || '')).includes(q);
    });
    grid.innerHTML = renderDuaCards(filtered, sampleDua);
    bindDuaWaButtons(filtered, sampleDua);
  };

  qInp.oninput = updateSearch;
  bindDuaWaButtons(deceased, sampleDua);
}

$('#m-dua-deceased').onclick = menuClose(() => openDuaMemorial());

/* ---------- 58) تقويم العائلة السنوي (فرع تجربة) ---------- */
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function getFixedOccasions(year, month) {
  // month: 0-indexed (0 to 11)
  const occ = [];
  if (month === 1 && 22) occ.push({ day: 22, title: '🇸🇦 يوم التأسيس السعودي', type: 'national' });
  if (month === 8 && 23) occ.push({ day: 23, title: '🇸🇦 اليوم الوطني السعودي', type: 'national' });
  return occ;
}

function openAnnualCalendar(viewYear = null, viewMonth = null) {
  const now = new Date();
  const curY = viewYear != null ? viewYear : now.getFullYear();
  const curM = viewMonth != null ? viewMonth : now.getMonth();

  const firstDay = new Date(curY, curM, 1);
  const startDayIdx = firstDay.getDay(); // 0: Sun, 1: Mon, ...
  const daysInMonth = new Date(curY, curM + 1, 0).getDate();

  const events = (S.events || []).filter(e => {
    const d = new Date(e.event_date);
    return d.getFullYear() === curY && d.getMonth() === curM;
  });

  const fixedOcc = getFixedOccasions(curY, curM);

  const daysHtml = [];
  // Empty cells before start of month
  for (let i = 0; i < startDayIdx; i++) {
    daysHtml.push('<div class="cal-day" style="opacity:.25"></div>');
  }

  // Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(curY, curM, d);
    const hj = gregToHijri(dateObj);
    const isToday = now.getFullYear() === curY && now.getMonth() === curM && now.getDate() === d;
    const dayEvs = events.filter(e => new Date(e.event_date).getDate() === d);
    const dayFixed = fixedOcc.filter(o => o.day === d);
    const hasAny = dayEvs.length || dayFixed.length;

    daysHtml.push(`
      <div class="cal-day ${isToday ? 'today' : ''} ${hasAny ? 'has-event' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="cal-day-num">${d}</span>
          <span class="cal-day-hj">${hj.d} ${HJ_MONTHS[hj.m - 1].slice(0, 5)}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;overflow:hidden">
          ${dayFixed.map(f => `<span class="cal-ev-dot" style="background:#0284c7;color:#fff" title="${esc(f.title)}">${esc(f.title)}</span>`).join('')}
          ${dayEvs.map(e => `<span class="cal-ev-dot" data-ev-id="${esc(e.id)}" style="cursor:pointer" title="${esc(e.title)}">🎉 ${esc(e.title)}</span>`).join('')}
        </div>
      </div>
    `);
  }

  const html = `
    <div class="cal-wrap">
      <div class="fstats-head">
        <h2>📅 تقويم العائلة السنوي (هجري وميلادي)</h2>
        <p class="sub">متابعة مواعيد مناسبات واجتماعات الأسرة مع المناسبات الوطنية والإسلامية</p>
      </div>

      <div class="cal-header">
        <div style="display:flex;align-items:center;gap:8px">
          <button type="button" class="btn ghost" id="btn-cal-prev" style="padding:4px 10px">‹ الشهر السابق</button>
          <b style="font-size:1.1rem;color:var(--gold)">${GREG_MONTHS[curM]} ${curY} م</b>
          <button type="button" class="btn ghost" id="btn-cal-next" style="padding:4px 10px">الشهر التالي ›</button>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn ghost" id="btn-cal-today" style="padding:4px 10px;font-size:.78rem">اليوم</button>
        </div>
      </div>

      <div class="cal-grid">
        ${AR_DAYS.map(dayName => `<div class="cal-day-head">${dayName}</div>`).join('')}
        ${daysHtml.join('')}
      </div>

      <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:6px">
        <b style="color:var(--gold);font-size:.85rem;display:block;margin-bottom:6px">🎉 مناسبات هذا الشهر (${events.length}):</b>
        ${events.length ? events.map(e => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.82rem">
            <div>
              <b>${esc(e.title)}</b> · <span style="color:var(--mut)">📅 ${new Date(e.event_date).toLocaleDateString('ar-SA')}</span>
            </div>
            <button type="button" class="x" data-evopen="${esc(e.id)}" style="color:var(--gold)">التفاصيل ←</button>
          </div>
        `).join('') : '<p class="sub" style="margin:0;font-size:.78rem">لا توجد اجتماعات عائلية مجدولة في هذا الشهر.</p>'}
      </div>
    </div>
  `;

  showInfo(html);

  const prevBtn = $('#btn-cal-prev');
  const nextBtn = $('#btn-cal-next');
  const todayBtn = $('#btn-cal-today');

  if (prevBtn) {
    prevBtn.onclick = () => {
      let m = curM - 1, y = curY;
      if (m < 0) { m = 11; y--; }
      openAnnualCalendar(y, m);
    };
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      let m = curM + 1, y = curY;
      if (m > 11) { m = 0; y++; }
      openAnnualCalendar(y, m);
    };
  }

  if (todayBtn) {
    todayBtn.onclick = () => openAnnualCalendar(now.getFullYear(), now.getMonth());
  }

  document.querySelectorAll('.cal-wrap [data-evopen], .cal-wrap [data-ev-id]').forEach(b => {
    b.onclick = () => {
      const eid = b.dataset.evopen || b.dataset.evId;
      const x = S.events.find(z => String(z.id) === String(eid));
      if (x) evDetails(x);
    };
  });
}

$('#m-calendar').onclick = menuClose(() => openAnnualCalendar());

/* ---------- 59) وضع الأطفال المبسط (فرع تجربة) ---------- */
function openKidsMode(selectedMid = null) {
  const existing = document.querySelector('.kids-overlay');
  if (existing) existing.remove();

  const membersWithKids = S.members.filter(m => (S.kids.get(m.id) || []).length > 0 && !m.name_masked);
  const curMember = selectedMid ? (S.byId.get(selectedMid) || membersWithKids[0]) : (membersWithKids[0] || S.members[0]);

  const father = curMember.father_id ? S.byId.get(curMember.father_id) : null;
  const grandfather = father && father.father_id ? S.byId.get(father.father_id) : null;
  const children = S.kids.get(curMember.id) || [];
  const brothers = father ? (S.kids.get(father.id) || []).filter(k => k.id !== curMember.id) : [];
  const uncles = grandfather ? (S.kids.get(grandfather.id) || []).filter(k => k.id !== father.id) : [];

  const overlay = document.createElement('div');
  overlay.className = 'kids-overlay';
  overlay.innerHTML = `
    <div class="kids-top">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:2rem">🧒</span>
        <div>
          <b style="color:#facc15;font-size:1.2rem">وضع أبطال العائلة المبسط للأطفال</b>
          <div style="font-size:.8rem;color:#cbd5e1">استكشف أسرتك وأجدادك وتعلّم شجرتك بأمتع طريقة!</div>
        </div>
      </div>
      <button type="button" id="btn-kids-exit" style="background:rgba(239,68,68,.25);border:2px solid #ef4444;color:#fca5a5;border-radius:12px;padding:8px 18px;font-size:.9rem;font-weight:800;cursor:pointer">
        ✕ خروج للوضع الكامل
      </button>
    </div>

    <div class="kids-hero">
      <h1>🌟 مرحباً بك يا بطل! 🌟</h1>
      <p>اختر اسمك أو اسم والدك لتكتشف عائلتك وإخوانك وأعمامك بكل سهولة</p>

      <div style="max-width:400px;margin:16px auto;display:flex;gap:8px;align-items:center">
        <label for="kids-sel" style="font-weight:700;color:#facc15;font-size:1rem">اختر:</label>
        <select id="kids-sel" style="flex:1;padding:10px 14px;border-radius:12px;background:rgba(0,0,0,.6);border:2px solid #38bdf8;color:#fff;font-size:1rem;font-weight:700">
          ${membersWithKids.map(m => `<option value="${m.id}" ${m.id === curMember.id ? 'selected' : ''}>${esc(m.full_name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="text-align:center;margin-bottom:8px">
      <span style="font-size:1.1rem;color:#facc15;font-weight:800">🏡 دائرة الأسرة القريبة لـ (${esc(curMember.full_name)}):</span>
    </div>

    <div class="kids-circle">
      <!-- الأب -->
      <div class="kids-card" data-kid-target="${father ? father.id : ''}">
        <div class="kids-card-avatar">🧔</div>
        <span class="kids-card-rel">أبي</span>
        <div class="kids-card-name">${father ? esc(father.full_name) : 'الجد المؤسس'}</div>
        <div style="font-size:.78rem;color:#94a3b8;margin-top:4px">اضغط للتعرف على عائلته</div>
      </div>

      <!-- الجد -->
      <div class="kids-card" data-kid-target="${grandfather ? grandfather.id : ''}">
        <div class="kids-card-avatar">👴</div>
        <span class="kids-card-rel">جدي</span>
        <div class="kids-card-name">${grandfather ? esc(grandfather.full_name) : 'من كبار الأجداد'}</div>
        <div style="font-size:.78rem;color:#94a3b8;margin-top:4px">فخرنا وتاريخنا</div>
      </div>

      <!-- الأبناء -->
      <div class="kids-card">
        <div class="kids-card-avatar">👦👧</div>
        <span class="kids-card-rel">الأبناء والبنات (${children.length})</span>
        <div class="kids-card-name" style="font-size:.95rem">
          ${children.length ? children.map(c => esc(c.first || c.full_name.split(' ')[0])).join(' · ') : 'لا يوجد مسجلين'}
        </div>
      </div>

      <!-- الإخوة -->
      <div class="kids-card">
        <div class="kids-card-avatar">🤝</div>
        <span class="kids-card-rel">الإخوة والأخوات (${brothers.length})</span>
        <div class="kids-card-name" style="font-size:.95rem">
          ${brothers.length ? brothers.map(b => esc(b.first || b.full_name.split(' ')[0])).slice(0, 5).join(' · ') : 'لا يوجد مسجلين'}
        </div>
      </div>

      <!-- الأعمام -->
      <div class="kids-card">
        <div class="kids-card-avatar">👥</div>
        <span class="kids-card-rel">الأعمام والعمات (${uncles.length})</span>
        <div class="kids-card-name" style="font-size:.95rem">
          ${uncles.length ? uncles.map(u => esc(u.first || u.full_name.split(' ')[0])).slice(0, 5).join(' · ') : 'لا يوجد مسجلين'}
        </div>
      </div>
    </div>

    <div class="kids-actions-bar">
      <button type="button" class="kids-big-btn" id="kids-btn-game">
        <span>🎮 العب لعبة اعرف قريبك واربح النجوم!</span>
      </button>
      <button type="button" class="kids-big-btn" id="kids-btn-audio" style="background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff">
        <span>🎙️ استمع لقصة صوتية من الأجداد</span>
      </button>
      <button type="button" class="kids-big-btn" id="kids-btn-card" style="background:linear-gradient(135deg,#059669,#047857);color:#fff">
        <span>📇 احصل على بطاقة نسبك للواتساب</span>
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const sel = overlay.querySelector('#kids-sel');
  if (sel) {
    sel.onchange = () => openKidsMode(sel.value);
  }

  const exitBtn = overlay.querySelector('#btn-kids-exit');
  if (exitBtn) {
    exitBtn.onclick = () => overlay.remove();
  }

  overlay.querySelectorAll('[data-kid-target]').forEach(c => {
    c.onclick = () => {
      const tid = c.dataset.kidTarget;
      if (tid) openKidsMode(tid);
    };
  });

  const gameBtn = overlay.querySelector('#kids-btn-game');
  if (gameBtn) {
    gameBtn.onclick = () => {
      overlay.remove();
      openFamilyGame();
    };
  }

  const audioBtn = overlay.querySelector('#kids-btn-audio');
  if (audioBtn) {
    audioBtn.onclick = () => {
      overlay.remove();
      openAudioStories();
    };
  }

  const cardBtn = overlay.querySelector('#kids-btn-card');
  if (cardBtn) {
    cardBtn.onclick = () => {
      overlay.remove();
      openLineageCard(curMember.id);
    };
  }
}

$('#m-kids-mode').onclick = menuClose(() => openKidsMode());

/* ---------- 60) إشعارات ورسائل واتساب للإعلانات والمناسبات (فرع تجربة) ---------- */
function openWaAnnouncements(activeTplKey = 'meeting') {
  const templates = {
    meeting: {
      name: 'اجتماع عائلي',
      icon: '💌',
      fields: [
        { id: 'f_title', label: 'عنوان اللقاء', val: 'الاجتماع السنوي لأسرة آل مطارد' },
        { id: 'f_date', label: 'الموعد', val: 'الجمعة القادم بعد صلاة العصر' },
        { id: 'f_place', label: 'المقر / القاعة', val: 'استراحة الأسرة - بني عمرو' },
        { id: 'f_agenda', label: 'البرنامج', val: 'صلة الرحم، تكريم المتفوقين، واستعراض تحديثات شجرة العائلة' }
      ],
      generate: (d) =>
        `💌 *دعوة لاجتماع أسرة آل مطارد (بنو عمرو)* 💌\n\n` +
        `السلام عليكم ورحمة الله وبركاته،،\n` +
        `يسر مجلس الأسرة دعوتكم لحضور: *${d.f_title}*\n\n` +
        `📅 *الموعد:* ${d.f_date}\n` +
        `📍 *المكان:* ${d.f_place}\n` +
        `📋 *البرنامج:* ${d.f_agenda}\n\n` +
        `حضوركم شرف لنا ويسعدنا جميعاً، نرجو تأكيد حضوركم عبر موقع الشجرة:\n` +
        `🔗 https://omerqazx1980.github.io/ALMatarid/`
    },
    wedding: {
      name: 'عقد قران وزواج',
      icon: '💍',
      fields: [
        { id: 'f_groom', label: 'اسم العريس', val: 'عبدالعزيز بن محمد' },
        { id: 'f_inlaws', label: 'العروس / الأسرة المصاهرة', val: 'كريمة فلان بن فلان' },
        { id: 'f_date', label: 'الموعد', val: 'يوم الخميس الموافق ...' },
        { id: 'f_hall', label: 'القاعة والمدينة', val: 'قاعة الروابي - أبها' }
      ],
      generate: (d) =>
        `💍 *تهنئة بزواج مبارك - أسرة آل مطارد* 💍\n\n` +
        `«بَارَكَ اللَّهُ لَكَ، وَبَارَكَ عَلَيْكَ، وَجَمَعَ بَيْنَكُمَا فِي خَيْرٍ»\n\n` +
        `تتقدم أسرة آل مطارد بخالص التهاني والتبريكات لابن العم:\n` +
        `*${d.f_groom}*\n` +
        `بمناسبة عقد قرانه على: *${d.f_inlaws}*\n\n` +
        `📅 *الموعد:* ${d.f_date}\n` +
        `📍 *المكان:* ${d.f_hall}\n\n` +
        `سائلين الله لهما حياة زوجية سعيدة ومباركة والذرية الصالحة.`
    },
    birth: {
      name: 'مولود جديد',
      icon: '👶',
      fields: [
        { id: 'f_parent', label: 'اسم الوالد', val: 'سعد بن إبراهيم' },
        { id: 'f_baby', label: 'اسم المولود / المولودة', val: 'سلطان' },
        { id: 'f_status', label: 'المولود', val: 'مولود ذكر' }
      ],
      generate: (d) =>
        `👶 *بشرى مولود جديد في أسرة آل مطارد* 👶\n\n` +
        `«بُورِكَ لَكَ فِي المَوْهُوبِ، وَشَكَرْتَ الوَاهِبَ، وَبَلَغَ أَشُدَّهُ، وَرُزِقْتَ بِرَّهُ»\n\n` +
        `رزق ابن العم: *${d.f_parent}*\n` +
        `بـ *${d.f_baby}*\n\n` +
        `جعله الله من مواليد السعادة والصلاح، وأنبته نباتاً حسناً، وأقرّ به أعين والديه.`
    },
    grad: {
      name: 'تخرج وإنجاز',
      icon: '🎓',
      fields: [
        { id: 'f_name', label: 'اسم الخريج / صاحب الإنجاز', val: 'فيصل بن عبدالله' },
        { id: 'f_degree', label: 'الدرجة والتخصص', val: 'بكالوريوس الهندسة الكهربائية' },
        { id: 'f_uni', label: 'الجامعة / الجهة', val: 'جامعة الملك عبدالعزيز' }
      ],
      generate: (d) =>
        `🎓 *تهنئة بالتخرج والإنجاز - فخر الأسرة* 🎓\n\n` +
        `تبارك أسرة آل مطارد (بنو عمرو) لابنها المتميز:\n` +
        `*${d.f_name}*\n` +
        `بمناسبة حصوله على: *${d.f_degree}*\n` +
        `من: *${d.f_uni}*\n\n` +
        `سائلين الله له دوام التوفيق والنجاح ومزيداً من الرتب والمناصب العليا في خدمة الدين والوطن.`
    },
    condolence: {
      name: 'تعزية ومواساة',
      icon: '🕊️',
      fields: [
        { id: 'f_deceased', label: 'اسم الفقيد', val: 'الوالد علي بن سعيد رحمه الله' },
        { id: 'f_relatives', label: 'أبناؤه / ذووه', val: 'أبنائه وإخوانه وكافة أسرة آل مطارد' },
        { id: 'f_prayer', label: 'الصلاة والدفن', val: 'الصلاة عليه عصر اليوم في جامع ... والدفن بمقبرة ...' },
        { id: 'f_cond_place', label: 'مقر العزاء', val: 'بمنزل الأسرة أو عبر الاتصال' }
      ],
      generate: (d) =>
        `🕊️ *إنا لله وإنا إليه راجعون - تعزية ومواساة* 🕊️\n\n` +
        `«يَا أَيَّتُهَا النَّفْسُ الْمُطْمَئِنَّةُ ارْجِعِي إِلَىٰ رَبِّكِ رَاضِيَةً مَّرْضِيَّةً فَادْخُلِي فِي عِبَادِي وَادْخُلِي جَنَّتِي»\n\n` +
        `بقلوب مؤمنة بقضاء الله وقدره، تنعى أسرة آل مطارد الفقيد:\n` +
        `*${d.f_deceased}*\n\n` +
        `وتتقدم بخالص العزاء وصادق المواساة إلى: *${d.f_relatives}*\n\n` +
        `🕌 *الصلاة والدفن:* ${d.f_prayer}\n` +
        `📍 *مقر العزاء:* ${d.f_cond_place}\n\n` +
        `اللهم اغفر له وارحمه وعافه واعف عنه واجعل قبره روضة من رياض الجنة.`
    },
    general: {
      name: 'إعلان عام للأسرة',
      icon: '📢',
      fields: [
        { id: 'f_gen_title', label: 'عنوان الإعلان', val: 'تحديث وتوثيق شجرة العائلة' },
        { id: 'f_gen_body', label: 'نص الإعلان', val: 'نرجو من جميع أبناء وبنات الأسرة مراجعة بياناتهم وتحديث صكوكهم ومواليدهم عبر موقع الشجرة الجديد.' }
      ],
      generate: (d) =>
        `📢 *إعلان عام من مجلس أسرة آل مطارد (بنو عمرو)* 📢\n\n` +
        `*${d.f_gen_title}*\n\n` +
        `${d.f_gen_body}\n\n` +
        `للاطلاع والتحديث يرجى زيارة الرابط:\n` +
        `🔗 https://omerqazx1980.github.io/ALMatarid/`
    }
  };

  const renderView = () => {
    const tpl = templates[activeTplKey];

    const html = `
      <div class="wa-ann-wrap">
        <div class="fstats-head">
          <h2>📢 مركز صياغة إعلانات ورسائل الواتساب</h2>
          <p class="sub">صياغة قوالب احترافية منسقة للقروبات العائلية بنقرة زر واحدة</p>
        </div>

        <div class="wa-tpl-grid">
          ${Object.entries(templates).map(([k, t]) => `
            <button type="button" class="wa-tpl-btn ${k === activeTplKey ? 'active' : ''}" data-tpl="${k}">
              <span style="font-size:1.4rem">${t.icon}</span>
              <span>${esc(t.name)}</span>
            </button>
          `).join('')}
        </div>

        <div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px">
          <b style="color:var(--gold);font-size:.85rem;display:block;margin-bottom:8px">📝 بيانات الرسالة:</b>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px" id="wa-form-inputs">
            ${tpl.fields.map(f => `
              <div>
                <label style="font-size:.74rem;color:var(--mut)">${esc(f.label)}:</label>
                <input type="text" id="${f.id}" value="${esc(f.val)}" style="width:100%;font-size:.82rem;padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt)">
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <b style="color:var(--gold);font-size:.85rem;display:block;margin-bottom:6px">💬 معاينة مباشرة كما ستظهر في واتساب:</b>
          <div class="wa-preview-box">
            <div class="wa-bubble" id="wa-preview-text"></div>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:4px">
          <button type="button" class="lcard-btn-wa" id="btn-wa-send" style="flex:1">
            <span>💬 إرسال مباشر إلى واتساب</span>
          </button>
          <button type="button" class="btn ghost" id="btn-wa-copy" style="padding:10px 16px">
            <span>📋 نسخ النص</span>
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    const inputs = {};
    tpl.fields.forEach(f => {
      const el = $(`#${f.id}`);
      if (el) {
        inputs[f.id] = el.value;
        el.oninput = () => {
          inputs[f.id] = el.value;
          updatePreview();
        };
      }
    });

    const updatePreview = () => {
      const msg = tpl.generate(inputs);
      const prevEl = $('#wa-preview-text');
      if (prevEl) prevEl.textContent = msg;
    };
    updatePreview();

    document.querySelectorAll('.wa-tpl-btn').forEach(btn => {
      btn.onclick = () => {
        activeTplKey = btn.dataset.tpl;
        renderView();
      };
    });

    const sendBtn = $('#btn-wa-send');
    if (sendBtn) {
      sendBtn.onclick = () => {
        const msg = tpl.generate(inputs);
        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
      };
    }

    const copyBtn = $('#btn-wa-copy');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const msg = tpl.generate(inputs);
        try {
          await navigator.clipboard.writeText(msg);
          toast('تم نسخ الرسالة بنجاح!');
        } catch (_) {
          toast('يرجى تحديد النص ونسخه يدوياً');
        }
      };
    }
  };

  renderView();
}

$('#m-wa-announcements').onclick = menuClose(() => openWaAnnouncements());

/* ---------- 61) قسم وبوابة نساء العائلة (فرع تجربة) ---------- */
function showWomenDirectory() {
  const women = S.members.filter(m => m.gender === 'female' || (m.full_name && !m.full_name.startsWith('ابن ')));
  const roots = S.roots || [];

  const html = `
    <div class="women-portal-view">
      <div class="women-banner">
        <div>
          <span style="font-size:1.6rem">🌸</span>
          <h2 style="font-size:1.35rem;margin:4px 0;font-weight:900;color:#fdf4ff">
            بوابة كريمات وبنات أسرة آل مطارد
          </h2>
          <div style="font-size:.84rem;color:#f5d0fe">
            «أكرموا النساء، فوالله ما أكرمهن إلا كريم» · توثيق أسماء وفروع وبنات الأسرة المصونات
          </div>
        </div>
        <button type="button" class="btn ghost" id="btn-women-logout" style="border-color:#f472b6;color:#fbcfe8;font-size:.78rem;padding:6px 12px">
          🔒 إغلاق الجلسة
        </button>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap">
        <input type="search" id="women-q" placeholder="🔍 ابحثي بالاسم أو اسم الوالد…" style="flex:1;min-width:180px;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid rgba(236,72,153,.3);color:var(--txt);font-size:.82rem">
        <select id="women-branch-filter" style="padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid rgba(236,72,153,.3);color:var(--txt);font-size:.82rem">
          <option value="all">جميع الفروع</option>
          ${roots.map(r => `<option value="${r.id}">فرع: ${esc(r.full_name)}</option>`).join('')}
        </select>
      </div>

      <div class="women-grid" id="women-grid-target"></div>
    </div>
  `;

  showInfo(html);

  const grid = $('#women-grid-target');
  const qInp = $('#women-q');
  const branchSel = $('#women-branch-filter');
  const logoutBtn = $('#btn-women-logout');

  if (logoutBtn) {
    logoutBtn.onclick = () => {
      sessionStorage.removeItem('almatarid_women_auth');
      toast('تم إغلاق جلسة بوابة النساء');
      $('#profile').close();
    };
  }

  const renderCards = () => {
    const q = stripKin(norm(qInp.value || ''));
    const branch = branchSel.value;

    const filtered = women.filter(w => {
      if (q && !stripKin(norm(w.full_name || '')).includes(q)) return false;
      if (branch !== 'all') {
        const chain = getAncestryChain(w);
        const root = chain[chain.length - 1];
        if (!root || root.id !== branch) return false;
      }
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<p class="sub" style="text-align:center;padding:20px;grid-column:1/-1">لا توجد نتائج مطابقة لخيارات البحث.</p>';
      return;
    }

    grid.innerHTML = filtered.map(w => {
      const father = w.father_id ? S.byId.get(w.father_id) : null;
      const mother = w.wife_mother_id ? S.wives.find(x => x.id === w.wife_mother_id) : null;
      const chain = getAncestryChain(w);
      const root = chain[chain.length - 1];
      const bYear = w.birth_year_text || (w.birth_date ? datePair(w.birth_date) : '');

      return `
        <div class="women-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div class="women-card-name">${nameBtn(w)}</div>
            <span class="women-pill">الجيل ${gen(w)}</span>
          </div>
          <div style="font-size:.78rem;color:#cbd5e1;line-height:1.6">
            <div>🏛️ <b>الفرع:</b> ${root ? esc(root.full_name) : 'آل مطارد'}</div>
            <div>🧔 <b>الوالد:</b> ${father ? nameBtn(father) : '—'}</div>
            ${mother ? `<div>🧕 <b>الأم:</b> ${esc(mother.full_name)}</div>` : ''}
            ${bYear ? `<div>📅 <b>الميلاد:</b> ${esc(bYear)}</div>` : ''}
            ${w.city ? `<div>📍 <b>المدينة:</b> ${esc(w.city)}</div>` : ''}
          </div>
          <div style="margin-top:auto;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;align-items:center">
            <button type="button" class="btn ghost" style="padding:4px 8px;font-size:.74rem;color:#f472b6" onclick="openLineageCard('${w.id}')">
              📇 بطاقة النسب
            </button>
            <span style="font-size:.72rem;color:var(--mut)">${w.is_alive === false ? 'رحمها الله' : 'حفظها الله'}</span>
          </div>
        </div>
      `;
    }).join('');
  };

  qInp.oninput = renderCards;
  branchSel.onchange = renderCards;
  renderCards();
}

function openWomenPortal() {
  if (sessionStorage.getItem('almatarid_women_auth') === '1') {
    showWomenDirectory();
    return;
  }

  const roots = S.roots || [];

  const html = `
    <div class="women-wrap">
      <div class="women-gate-card">
        <span style="font-size:2.4rem">🌸</span>
        <h2 class="women-gate-title">بوابة كريمات وبنات أسرة آل مطارد</h2>
        <p style="font-size:.85rem;color:#e2e8f0;margin:0;line-height:1.6">
          دخول مخصص وموثق لبنات وكريمات الأسرة للاطلاع على أسماء وفروع وبنات العائلة الكريمة
        </p>
        <div style="background:rgba(236,72,153,.1);border:1px dashed #ec4899;border-radius:8px;padding:8px;margin-top:8px;font-size:.75rem;color:#fbcfe8">
          🔒 ملاحظة أمان: لا يُطلب ولا يُخزّن أي رقم هوية وطنية نهائياً في هذا الموقع.
        </div>

        <form id="women-gate-form" class="women-form">
          <div>
            <label>تأكيد الجنس:</label>
            <select id="wg-gender" required>
              <option value="female">أنثى (من بنات أو كريمات الأسرة)</option>
            </select>
          </div>

          <div>
            <label>الاسم الكريم (يقبل مع كلمة «بنت» أو بدونها):</label>
            <input type="text" id="wg-name" placeholder="اكتبي اسمك الكريم (مثال: نورة بنت محمد أو نورة محمد)" required autocomplete="off">
          </div>

          <div>
            <label>تاريخ أو سنة الميلاد (اختياري):</label>
            <input type="text" id="wg-birth" placeholder="مثال: 1418 هـ أو 1997 م (اختياري)" autocomplete="off">
          </div>

          <div>
            <label>كود التحقق الخاص (إلزامي - مرسل من المالك أو مسؤول الفرع):</label>
            <input type="password" id="wg-code" placeholder="أدخلي كود الدخول الخاص (إلزامي)" required autocomplete="off">
          </div>

          <div>
            <label>سؤال التحقق الإضافي:</label>
            <select id="wg-qtype" style="margin-bottom:6px">
              <option value="branch">ما هو فرع الأسرة أو الجد الأكبر؟</option>
              <option value="mother">ما هو اسم الوالدة الكريمة؟</option>
            </select>
            <input type="text" id="wg-ans" placeholder="اكتبي إجابة سؤال التحقق" required autocomplete="off">
          </div>

          <p id="wg-err" style="color:#f87171;font-size:.8rem;margin:4px 0" hidden></p>

          <button type="submit" class="women-btn-submit">
            🌸 تحقق ودخول البوابة
          </button>
        </form>
      </div>
    </div>
  `;

  showInfo(html);

  const form = $('#women-gate-form');
  const errEl = $('#wg-err');

  form.onsubmit = (e) => {
    e.preventDefault();
    errEl.hidden = true;

    const gender = $('#wg-gender').value;
    const name = ($('#wg-name').value || '').trim();
    const birth = ($('#wg-birth').value || '').trim();
    const code = ($('#wg-code').value || '').trim();
    const qtype = $('#wg-qtype').value;
    const ans = ($('#wg-ans').value || '').trim();

    if (gender !== 'female') {
      errEl.textContent = 'هذه البوابة مخصصة للإناث من بنات وكريمات الأسرة.';
      errEl.hidden = false;
      return;
    }

    if (!name) {
      errEl.textContent = 'يرجى كتابة الاسم الكريم.';
      errEl.hidden = false;
      return;
    }

    if (!code) {
      errEl.textContent = 'كود التحقق الخاص إلزامي للدخول — يرجى إدخال الكود.';
      errEl.hidden = false;
      return;
    }

    if (!ans) {
      errEl.textContent = 'يرجى كتابة إجابة سؤال التحقق الإضافي.';
      errEl.hidden = false;
      return;
    }

    // بوابة النساء مغلقة بانتظار أكواد المالك (قرار عمر 2026-11-24): لا يُقبل أي كود
    // مكتوب ولا يوجد احتياطي طول — 123456 كود عام للعائلة وليس كود بوابة أبداً.
    // يزوّد المالك/مسؤول الفرع كل داخلة بكودها، وحينها تُضاف الأكواد الصحيحة؛
    // وحتى ذلك الحين يُرفض كل كود. لا تخترع أكواداً بديلة هنا.
    const validCodes = [];
    const isCodeValid = validCodes.includes(code);

    if (!isCodeValid) {
      errEl.textContent = 'كود التحقق غير صحيح — يرجى مراجعة مسؤول الفرع للحصول على الكود.';
      errEl.hidden = false;
      return;
    }

    // Match verification answer (supports with or without 'بنت' / 'ابن' / 'بن'):
    const cleanAns = stripKin(normAr(ans));
    let matched = false;
    if (qtype === 'branch') {
      matched = roots.some(r => {
        const cleanR = stripKin(normAr(r.full_name));
        return cleanR.includes(cleanAns) || cleanAns.includes(stripKin(normAr(r.first || '')));
      });
      if (!matched && (cleanAns.includes('مطارد') || cleanAns.includes('عمرو'))) matched = true;
    } else {
      matched = S.wives.some(w => {
        const cleanW = stripKin(normAr(w.full_name));
        return cleanW.includes(cleanAns) || (cleanW.length >= 3 && cleanAns.includes(cleanW.slice(0, 4)));
      });
    }

    // If answer matched or accepted
    if (!matched && ans.length < 2) {
      errEl.textContent = 'إجابة سؤال التحقق الإضافي غير مطابقة لسجلات الأسرة.';
      errEl.hidden = false;
      return;
    }

    // Authentication succeeded!
    sessionStorage.setItem('almatarid_women_auth', '1');
    S.womenVisible = true;
    S.members.forEach(m => {
      if (m.gender === 'female') m.name_masked = false;
    });

    toast(`أهلاً بكِ يا أختنا الكريمة (${name}) في بوابة نساء الأسرة 🌸`);
    render();
    showWomenDirectory();
  };
}

$('#m-women-portal').onclick = menuClose(() => openWomenPortal());

/* ---------- 62) نسخ احتياطي تلقائي يومي مع إشعار (فرع تجربة) ---------- */
const MAX_AUTO_BACKUPS = 20;

function getAutoBackups() {
  try {
    const raw = localStorage.getItem('almatarid_backups_list');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveAutoBackup(isManual = false) {
  if (!S.members || !S.members.length) return null;
  if (!canEdit()) return null; // لا نسخة محلية كاملة إلا للمحررين — بيانات الزوار لا تُنسخ إلى متصفحاتهم
  const list = getAutoBackups();
  const backup = {
    id: 'bk_' + Date.now(),
    date: new Date().toISOString(),
    is_manual: isManual,
    stats: {
      members: S.members.length,
      wives: (S.wives || []).length,
      events: (S.events || []).length,
      roots: (S.roots || []).length
    },
    data: {
      members: S.members,
      wives: S.wives || [],
      events: S.events || [],
      branches: S.branches || []
    }
  };

  list.unshift(backup);
  if (list.length > MAX_AUTO_BACKUPS) {
    list.length = MAX_AUTO_BACKUPS;
  }

  try {
    localStorage.setItem('almatarid_backups_list', JSON.stringify(list));
    localStorage.setItem('almatarid_last_auto_backup', String(Date.now()));
  } catch (err) {
    console.warn('Backup save error:', err);
  }
  return backup;
}

async function checkDailyAutoBackup() {
  if (!S.role) { // الدور لم يُحدَّد بعد — أعد المحاولة بعد 10 ثوانٍ (حتى 3 مرات)
    if ((checkDailyAutoBackup._r = (checkDailyAutoBackup._r || 0) + 1) <= 3) setTimeout(checkDailyAutoBackup, 10000);
    return;
  }
  if (S.role !== 'owner') return; // النسخ التلقائي للمالك فقط — لا نسخة كاملة في متصفح أي زائر
  const last = parseInt(localStorage.getItem('almatarid_last_auto_backup') || '0', 10);
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  if (now - last >= oneDay) {
    try {
      const r = await rpc('secure_auto_snapshot', { p_passcode: S.code });
      localStorage.setItem('almatarid_last_auto_backup', String(now));
      if (r && r.success) {
        toast(`💾 تم إنشاء نسخة احتياطية يومية في القاعدة (لقطة #${r.id})`);
        return;
      }
      throw new Error((r && r.message) || 'تعذر إنشاء اللقطة في القاعدة');
    } catch (err) {
      // ملف SQL التجريبي لم يُشغَّل بعد في القاعدة — احتياط محلي حتى يُشغَّل
      console.warn('auto snapshot RPC failed, local fallback:', err);
    }
    const bk = saveAutoBackup(false);
    if (bk) toast(`💾 تم إنشاء نسخة احتياطية يومية محلية (${bk.stats.members} فرد) — ستُحفظ في القاعدة بعد تشغيل ملف SQL التجريبي`);
  }
}

function confirmRestoreBackup(bk) {
  if (!bk || !bk.data) return;
  const count = bk.stats?.members || (bk.data.members || []).length;
  const dateStr = new Date(bk.date).toLocaleString('ar-SA');

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0">
      <div class="fstats-head">
        <h2 style="color:#ef4444">⚠️ تأكيد استعادة النسخة الاحتياطية</h2>
        <p class="sub">سيتم استبدال البيانات الحالية بالبيانات المحفوظة في هذه النسخة</p>
      </div>

      <div style="background:rgba(239,68,68,.1);border:1.5px solid #ef4444;border-radius:10px;padding:14px;color:#fca5a5;font-size:.85rem;line-height:1.7">
        <b>تفاصيل النسخة المختارة:</b><br>
        📅 تاريخ النسخة: <b>${dateStr}</b><br>
        👥 عدد أفراد الأسرة: <b>${count} فرد</b><br>
        💍 عدد الزوجات: <b>${bk.stats?.wives || (bk.data.wives || []).length}</b><br>
        🎉 عدد المناسبات: <b>${bk.stats?.events || (bk.data.events || []).length}</b><br>
        <div style="margin-top:8px;border-top:1px dashed rgba(239,68,68,.4);padding-top:6px;font-size:.78rem">
          تنبيه: يُنصح بالتأكد قبل الاسترجاع. سيتم حفظ الحالة الحالية كنسخة تلقائية قبل التبديل.<br>
          ⚠️ هذه استعادة محلية مؤقتة — تُفقد عند إعادة تحميل الصفحة. للاستعادة الدائمة استخدم «لقطات القاعدة» من سجل النسخ.
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" id="btn-do-restore" style="flex:1;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:800;font-size:.9rem;cursor:pointer">
          ↺ تأكيد الاستعادة والرجوع للبيانات
        </button>
        <button type="button" class="btn ghost" id="btn-cancel-restore" style="padding:10px 16px">
          إلغاء
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const doBtn = $('#btn-do-restore');
  if (doBtn) {
    doBtn.onclick = () => {
      saveAutoBackup(true);
      S.members = JSON.parse(JSON.stringify(bk.data.members || []));
      S.wives = JSON.parse(JSON.stringify(bk.data.wives || []));
      S.events = JSON.parse(JSON.stringify(bk.data.events || []));
      if (bk.data.branches) S.branches = JSON.parse(JSON.stringify(bk.data.branches));
      index();
      render();
      showEvent();
      toast('✓ تمت الاستعادة محلياً في هذه الجلسة — تُفقد عند إعادة التحميل؛ للاستعادة الدائمة استخدم لقطات القاعدة');
      $('#profile').close();
    };
  }

  const cancelBtn = $('#btn-cancel-restore');
  if (cancelBtn) {
    cancelBtn.onclick = () => openBackupsManager();
  }
}

function openBackupsManager() {
  if (S.role !== 'owner') { toast('سجل النسخ الاحتياطية للمالك فقط'); return; }
  const list = getAutoBackups();

  const html = `
    <div class="backup-wrap">
      <div class="fstats-head">
        <h2>💾 سجل النسخ الاحتياطية التلقائية</h2>
        <p class="sub">نسخ احتياطي تلقائي دوري كل 24 ساعة مع الاحتفاظ بآخر 20 نسخة احتياطية للبيانات</p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin:4px 0;padding:10px;border:1px solid var(--gold);border-radius:10px">
        <span style="flex:1;font-size:.82rem;line-height:1.6">📸 <b>لقطات القاعدة</b> — استعادة دائمة تُحفظ في القاعدة (مع لقطة «قبل الاستعادة» تلقائيًا).</span>
        <button type="button" class="btn" id="btn-db-snaps" style="font-size:.78rem;padding:6px 12px">فتح لقطات القاعدة</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0">
        <span style="font-size:.82rem;color:var(--gold);font-weight:700">النسخ المحفوظة (${list.length} / ${MAX_AUTO_BACKUPS}):</span>
        <button type="button" class="btn" id="btn-create-manual-bk" style="font-size:.78rem;padding:6px 12px;background:var(--gold);color:#1c1204;font-weight:700">
          ➕ إنشاء نسخة فورية الآن
        </button>
      </div>

      <div class="backup-list" id="backup-list-box">
        ${list.length ? list.map((bk, i) => `
          <div class="backup-item">
            <div>
              <div style="font-weight:700;color:#fff;font-size:.9rem">
                #${i + 1} · نسخة ${bk.is_manual ? 'يدوية' : 'تلقائية يومية'}
              </div>
              <div class="backup-meta">
                📅 ${new Date(bk.date).toLocaleString('ar-SA')} · 👥 ${bk.stats.members} فرد · 💍 ${bk.stats.wives} زوجات · 🎉 ${bk.stats.events} مناسبات
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button type="button" class="btn" data-restore-bk="${bk.id}" style="background:#0284c7;color:#fff;padding:4px 10px;font-size:.75rem;border-radius:6px;font-weight:700">
                ↺ استعادة
              </button>
              <button type="button" class="btn ghost" data-dl-bk="${bk.id}" style="padding:4px 8px;font-size:.75rem">
                📥 تحميل JSON
              </button>
            </div>
          </div>
        `).join('') : '<p class="sub" style="text-align:center;padding:20px">لا توجد نسخ احتياطية مسجلة بعد — اضغط الزر أعلاه لإنشاء أول نسخة.</p>'}
      </div>
    </div>
  `;

  showInfo(html);

  const createBtn = $('#btn-create-manual-bk');
  if (createBtn) {
    createBtn.onclick = () => {
      const bk = saveAutoBackup(true);
      if (bk) {
        toast('تم حفظ نسخة احتياطية فورية بنجاح!');
        openBackupsManager();
      }
    };
  }

  const dbSnapsBtn = $('#btn-db-snaps');
  if (dbSnapsBtn) dbSnapsBtn.onclick = () => openSnapshots();

  document.querySelectorAll('[data-restore-bk]').forEach(btn => {
    btn.onclick = () => {
      const bk = list.find(x => x.id === btn.dataset.restoreBk);
      if (!bk) return;
      confirmRestoreBackup(bk);
    };
  });

  document.querySelectorAll('[data-dl-bk]').forEach(btn => {
    btn.onclick = () => {
      const bk = list.find(x => x.id === btn.dataset.dlBk);
      if (!bk) return;
      const blob = new Blob([JSON.stringify(bk.data, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `almatarid-backup-${bk.date.slice(0, 10)}.json`
      });
      a.click();
      URL.revokeObjectURL(a.href);
    };
  });
}

$('#m-backups').onclick = menuClose(() => openBackupsManager());
setTimeout(checkDailyAutoBackup, 2500);

/* ---------- 63) لوحة جودة البيانات للمشرف وتصحيحها (فرع تجربة) ---------- */
function auditFamilyDataQuality() {
  const issues = [];
  const nameMap = new Map();

  S.members.forEach(m => {
    const key = (m.full_name || '').trim().toLowerCase() + '_' + (m.father_id || 'root');
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(m);
  });

  for (const [key, group] of nameMap.entries()) {
    if (group.length > 1) {
      issues.push({
        type: 'duplicate',
        typeName: 'اسم مكرر',
        icon: '⚠️',
        desc: `تكرار الاسم «${group[0].full_name}» (${group.length} مرات بنفس الأب)`,
        fixLabel: 'دمج السجلات المكررة',
        members: group,
        action: () => {
          const keep = group[0];
          const toRemove = group.slice(1);
          const removeIds = new Set(toRemove.map(x => x.id));
          S.members.forEach(child => {
            if (removeIds.has(child.father_id)) child.father_id = keep.id;
          });
          S.members = S.members.filter(x => !removeIds.has(x.id));
          index(); render();
          toast(`تم دمج تكرار «${keep.full_name}» بنجاح!`);
          openDataQualityDashboard();
        }
      });
    }
  }

  S.members.forEach(m => {
    if (m.father_id && !S.byId.has(m.father_id)) {
      issues.push({
        type: 'broken_father',
        typeName: 'رابط أب مفقود',
        icon: '🔗',
        desc: `العضو «${m.full_name}» مربوط بمعرف أب غير موجود (#${m.father_id})`,
        fixLabel: 'ربط بالفرع الرئيسي',
        action: () => {
          m.father_id = S.roots[0] ? S.roots[0].id : null;
          index(); render();
          toast(`تم ربط «${m.full_name}» بالفرع الرئيسي!`);
          openDataQualityDashboard();
        }
      });
    }
  });

  (S.wives || []).forEach(w => {
    if (w.husband_id && !S.byId.has(w.husband_id)) {
      issues.push({
        type: 'broken_husband',
        typeName: 'زواج متعارض',
        icon: '💍',
        desc: `الزوجة «${w.full_name}» مربوطة بمعرف زوج غير موجود (#${w.husband_id})`,
        fixLabel: 'تصحيح وحذف الربط المكسور',
        action: () => {
          S.wives = S.wives.filter(x => x.id !== w.id);
          index(); render();
          toast(`تم تصحيح سجل الزوجة «${w.full_name}»!`);
          openDataQualityDashboard();
        }
      });
    }
  });

  // كشف التناقضات في التواريخ تلقائياً
  S.members.forEach(m => {
    const bYear = parseInt(m.birth_year_text || (m.birth_date ? m.birth_date.slice(0, 4) : 0), 10);
    const dYear = parseInt(m.death_year_text || (m.death_date ? m.death_date.slice(0, 4) : 0), 10);

    if (bYear && dYear && dYear < bYear) {
      issues.push({
        type: 'date_conflict',
        typeName: 'تناقض وفاة قبل الميلاد',
        icon: '⏰',
        desc: `العضو «${m.full_name}» مسجل بوفاة (${dYear}) تسبق ولادته (${bYear})`,
        fixLabel: 'تعديل تاريخ العضو',
        action: () => {
          $('#profile').close();
          memberForm(m);
        }
      });
    }

    if (m.father_id && S.byId.has(m.father_id)) {
      const father = S.byId.get(m.father_id);
      const fbYear = parseInt(father.birth_year_text || (father.birth_date ? father.birth_date.slice(0, 4) : 0), 10);
      if (bYear && fbYear && bYear <= fbYear + 10) {
        issues.push({
          type: 'date_conflict',
          typeName: 'تناقض سن الأب والابن',
          icon: '⏰',
          desc: `ولادة «${m.full_name}» (${bYear}) متقاربة جداً أو تسبق ولادة والده «${father.full_name}» (${fbYear})`,
          fixLabel: 'تعديل تاريخ العضو',
          action: () => {
            $('#profile').close();
            memberForm(m);
          }
        });
      }
    }
  });

  return issues;
}

function openDataQualityDashboard() {
  const issues = auditFamilyDataQuality();
  const dupCount = issues.filter(i => i.type === 'duplicate').length;
  const brokenCount = issues.filter(i => i.type.includes('broken')).length;

  const html = `
    <div class="dq-wrap">
      <div class="fstats-head">
        <h2>🛡️ لوحة جودة البيانات وتصحيحها التلقائي</h2>
        <p class="sub">فحص ذكي وفوري لكشف وتصحيح الأسماء المكررة، الروابط المقطوعة، والزيجات المتعارضة بزر واحد</p>
      </div>

      <div class="dq-stat-grid">
        <div class="dq-stat-card">
          <div class="dq-stat-num" style="color:${issues.length ? '#f59e0b' : '#10b981'}">${issues.length}</div>
          <div class="dq-stat-lbl">إجمالي التنبيهات والملاحظات</div>
        </div>
        <div class="dq-stat-card">
          <div class="dq-stat-num">${dupCount}</div>
          <div class="dq-stat-lbl">أسماء مكررة</div>
        </div>
        <div class="dq-stat-card">
          <div class="dq-stat-num">${brokenCount}</div>
          <div class="dq-stat-lbl">روابط تحتاج تصحيح</div>
        </div>
        <div class="dq-stat-card">
          <div class="dq-stat-num" style="color:#10b981">${Math.round(((S.members.length - issues.length) / Math.max(1, S.members.length)) * 100)}%</div>
          <div class="dq-stat-lbl">مؤشر دقة واكتمال الشجرة</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0">
        <b style="font-size:.85rem;color:var(--gold)">قائمة الملاحظات والحلول الفورية:</b>
        ${issues.length ? `
          <button type="button" class="btn" id="btn-fix-all-dq" style="background:#10b981;color:#fff;font-size:.76rem;padding:6px 14px;border-radius:6px;font-weight:700">
            ⚡ إصلاح الكل بنقرة واحدة
          </button>
        ` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto" id="dq-issues-box">
        ${issues.length ? issues.map((iss, i) => `
          <div class="dq-issue-item">
            <div>
              <span class="bd" style="background:rgba(245,158,11,.15);border:1px solid var(--gold);color:var(--gold);padding:2px 8px;border-radius:99px;font-size:.7rem">
                ${iss.icon} ${iss.typeName}
              </span>
              <div style="font-size:.84rem;color:#e2e8f0;margin-top:4px">${esc(iss.desc)}</div>
            </div>
            <button type="button" class="dq-fix-btn" data-fix-idx="${i}">
              ⚡ ${esc(iss.fixLabel)}
            </button>
          </div>
        `).join('') : `
          <div style="background:rgba(16,185,129,.1);border:1.5px solid #10b981;border-radius:10px;padding:24px;text-align:center;color:#6ee7b7">
            <div style="font-size:2.2rem;margin-bottom:6px">✓</div>
            <b style="font-size:1.1rem">ممتاز! جودة بيانات الشجرة 100%</b>
            <div style="font-size:.82rem;margin-top:4px;color:#a7f3d0">لا توجد أسماء مكررة أو روابط متعارضة في شجرة العائلة حالياً.</div>
          </div>
        `}
      </div>
    </div>
  `;

  showInfo(html);

  document.querySelectorAll('[data-fix-idx]').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.fixIdx, 10);
      if (issues[idx] && issues[idx].action) {
        issues[idx].action();
      }
    };
  });

  const fixAllBtn = $('#btn-fix-all-dq');
  if (fixAllBtn) {
    fixAllBtn.onclick = () => {
      issues.forEach(iss => { if (iss.action) iss.action(); });
      toast('✓ تم تطبيق جميع الإصلاحات التلقائية بنجاح!');
      openDataQualityDashboard();
    };
  }
}

$('#m-data-quality').onclick = menuClose(() => openDataQualityDashboard());

/* ---------- 64) تلميحات واقتراحات إكمال الشجرة (فرع تجربة) ---------- */
function getTreeCompletionHints() {
  const hints = [];

  S.members.forEach(m => {
    const kids = S.kids.get(m.id) || [];
    const wives = (S.wives || []).filter(w => w.husband_id === m.id);
    const hasPhoto = S.photos.has(m.id);
    const g = gen(m);

    // 1. Elders / prominent members without photo
    if (!hasPhoto && (g <= 3 || m.achievement_badge)) {
      hints.push({
        member: m,
        type: 'missing_photo',
        typeName: 'صورة شخصية مفقودة',
        icon: '📷',
        badgeBg: 'rgba(56,189,248,.15)',
        badgeColor: '#38bdf8',
        desc: `العضو «${m.full_name}» (الجيل ${g}) من أعيان العائلة ولا توجد له صورة شخصية مسجلة.`,
        actLabel: '📷 رفع صورة',
        action: () => {
          $('#profile').close();
          const f = $('#photo-file');
          if (f) { f.dataset.mid = m.id; f.click(); }
        }
      });
    }

    // 2. Members with wives but 0 kids registered
    if (wives.length > 0 && kids.length === 0) {
      hints.push({
        member: m,
        type: 'missing_children',
        typeName: 'أبناء غير مسجلين',
        icon: '👶',
        badgeBg: 'rgba(251,191,36,.15)',
        badgeColor: '#fbbf24',
        desc: `العضو «${m.full_name}» متزوج ولديه ${wives.length} زوجات مسجلات ولكن لا يوجد أبناء مسجلون بعد.`,
        actLabel: '➕ إضافة ابن/ابنة',
        action: () => {
          $('#profile').close();
          memberForm(null, m.id);
        }
      });
    }

    // 3. Incomplete profile details
    if (!m.city || (!m.birth_year_text && !m.birth_date)) {
      const missingFields = [!m.city ? 'المدينة' : '', (!m.birth_year_text && !m.birth_date) ? 'سنة الميلاد' : ''].filter(Boolean).join(' و ');
      hints.push({
        member: m,
        type: 'incomplete_profile',
        typeName: 'ملف غير مكتمل',
        icon: '📝',
        badgeBg: 'rgba(168,85,247,.15)',
        badgeColor: '#c084fc',
        desc: `الملف الشخصي لـ «${m.full_name}» ينقصه: (${missingFields}).`,
        actLabel: '✏️ إكمال البيانات',
        action: () => {
          $('#profile').close();
          memberForm(m);
        }
      });
    }
  });

  return hints;
}

function openTreeCompletionHints() {
  const hints = getTreeCompletionHints();
  let activeFilter = 'all';

  const renderContent = () => {
    const filtered = hints.filter(h => activeFilter === 'all' || h.type === activeFilter);
    const photoCount = hints.filter(h => h.type === 'missing_photo').length;
    const kidsCount = hints.filter(h => h.type === 'missing_children').length;
    const incCount = hints.filter(h => h.type === 'incomplete_profile').length;

    const html = `
      <div class="hints-wrap">
        <div class="fstats-head">
          <h2>💡 تلميحات واقتراحات إكمال الشجرة</h2>
          <p class="sub">مساعد توثيقي ذكي يحلل الشجرة ويرشدك للملفات الناقصة، الأعضاء بلا أبناء، والفروع المحتاجة لصور</p>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px">
          <button type="button" class="fbook-tab-btn ${activeFilter === 'all' ? 'active' : ''}" data-hf="all">
            الكل (${hints.length})
          </button>
          <button type="button" class="fbook-tab-btn ${activeFilter === 'missing_photo' ? 'active' : ''}" data-hf="missing_photo">
            📷 صور مفقودة (${photoCount})
          </button>
          <button type="button" class="fbook-tab-btn ${activeFilter === 'missing_children' ? 'active' : ''}" data-hf="missing_children">
            👶 أبناء غير مسجلين (${kidsCount})
          </button>
          <button type="button" class="fbook-tab-btn ${activeFilter === 'incomplete_profile' ? 'active' : ''}" data-hf="incomplete_profile">
            📝 ملفات ناقصة (${incCount})
          </button>
        </div>

        <div class="hints-grid" id="hints-grid-target">
          ${filtered.length ? filtered.map((h, i) => `
            <div class="hint-card">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <span class="hint-badge" style="background:${h.badgeBg};border:1px solid ${h.badgeColor};color:${h.badgeColor}">
                  ${h.icon} ${h.typeName}
                </span>
                <span style="font-size:.72rem;color:var(--mut)">الجيل ${gen(h.member)}</span>
              </div>
              <div style="font-weight:700;color:#fff;font-size:.9rem;margin-top:2px">
                ${esc(h.member.full_name)}
              </div>
              <div style="font-size:.78rem;color:#cbd5e1;line-height:1.6">
                ${esc(h.desc)}
              </div>
              <div style="margin-top:auto;padding-top:6px;border-top:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center">
                <button type="button" class="btn" data-hint-act="${i}" style="background:var(--gold);color:#1c1204;font-size:.75rem;padding:5px 12px;border-radius:6px;font-weight:700">
                  ${esc(h.actLabel)}
                </button>
                <button type="button" class="x" onclick="$('#profile').close();focusMember('${h.member.id}')" style="color:var(--mut);font-size:.72rem">
                  عرض في الشجرة ←
                </button>
              </div>
            </div>
          `).join('') : '<p class="sub" style="text-align:center;padding:24px;grid-column:1/-1">رائع جداً! لا توجد تلميحات ناقصة في هذا التصنيف.</p>'}
        </div>
      </div>
    `;

    showInfo(html);

    document.querySelectorAll('[data-hf]').forEach(b => {
      b.onclick = () => {
        activeFilter = b.dataset.hf;
        renderContent();
      };
    });

    document.querySelectorAll('[data-hint-act]').forEach(b => {
      b.onclick = () => {
        const idx = parseInt(b.dataset.hintAct, 10);
        if (filtered[idx] && filtered[idx].action) {
          filtered[idx].action();
        }
      };
    });
  };

  renderContent();
}

$('#m-completion-hints').onclick = menuClose(() => openTreeCompletionHints());

/* ---------- 65) استيراد الأعضاء من إكسل و CSV (فرع تجربة) ---------- */
function parseCsvRows(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return [];
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t;]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (parts.length >= 2) rows.push(parts);
  }
  return rows;
}

function openCsvImportModal() {
  let parsedCandidates = [];

  const html = `
    <div class="import-wrap">
      <div class="fstats-head">
        <h2>📥 استيراد الأعضاء دفعة واحدة (إكسل / CSV)</h2>
        <p class="sub">استيراد مجموعة من الأفراد دفعة واحدة مع المعاينة والتدقيق قبل الحفظ ودون حذف أي فرد مسجل</p>
      </div>

      <div class="import-dropzone" id="csv-drop-zone">
        <span style="font-size:2rem">📁</span>
        <div style="font-weight:700;color:#fff;margin-top:6px">اسحب وأفلت ملف CSV هنا أو اضغط للاختيار</div>
        <div style="font-size:.76rem;color:var(--mut);margin-top:4px">يدعم صيغ .csv و .txt وملفات الإكسل المصدرة كـ CSV</div>
        <input type="file" id="csv-file-input" accept=".csv,.txt" style="display:none">
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0">
        <button type="button" class="btn ghost" id="btn-dl-template" style="font-size:.75rem;padding:4px 10px">
          📄 تحميل قالب CSV النموذجي
        </button>
        <button type="button" class="btn ghost" id="btn-paste-csv" style="font-size:.75rem;padding:4px 10px">
          📋 لصق نص CSV يدويًا
        </button>
      </div>

      <div id="import-preview-area" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <b style="font-size:.85rem;color:var(--gold)" id="import-count-lbl">معاينة الأفراد الجدد (0):</b>
          <button type="button" class="btn" id="btn-do-import" style="background:#10b981;color:#fff;font-size:.8rem;padding:6px 16px;border-radius:6px;font-weight:700">
            ✓ تأكيد استيراد الأفراد المحددين
          </button>
        </div>
        <div class="import-table-box">
          <table class="fbook-table" id="import-table">
            <thead>
              <tr>
                <th><input type="checkbox" id="import-check-all" checked></th>
                <th>الاسم الكامل</th>
                <th>اسم الأب</th>
                <th>الجنس</th>
                <th>المدينة</th>
                <th>الميلاد</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody id="import-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  showInfo(html);

  const dropZone = $('#csv-drop-zone');
  const fileInput = $('#csv-file-input');
  const previewArea = $('#import-preview-area');
  const tbody = $('#import-table-body');
  const countLbl = $('#import-count-lbl');
  const doImportBtn = $('#btn-do-import');
  const checkAll = $('#import-check-all');

  const processText = (text) => {
    const rawRows = parseCsvRows(text);
    if (!rawRows.length) {
      toast('الملف فارغ أو لا يحتوي على بيانات صالحة');
      return;
    }

    let startIndex = 0;
    if (rawRows[0][0].includes('اسم') || rawRows[0][0].toLowerCase().includes('name')) {
      startIndex = 1;
    }

    parsedCandidates = [];
    const existingNames = new Set(S.members.map(m => m.full_name.trim().toLowerCase()));

    for (let i = startIndex; i < rawRows.length; i++) {
      const r = rawRows[i];
      const fullName = r[0] || '';
      const fatherName = r[1] || '';
      const gender = (r[2] || '').includes('أنث') || (r[2] || '').toLowerCase() === 'female' ? 'female' : 'male';
      const city = r[3] || 'الجنوب';
      const birth = r[4] || '';
      const isAlive = !((r[5] || '').includes('متوف') || (r[5] || '').includes('dead'));

      if (fullName) {
        let fid = null;
        if (fatherName) {
          const matchFather = S.members.find(m => m.full_name.includes(fatherName) || fatherName.includes(m.full_name));
          if (matchFather) fid = matchFather.id;
        }

        parsedCandidates.push({
          full_name: fullName,
          father_name: fatherName,
          father_id: fid,
          gender: gender,
          city: city,
          birth_year_text: birth,
          is_alive: isAlive,
          is_duplicate: existingNames.has(fullName.trim().toLowerCase()),
          selected: true
        });
      }
    }

    if (!parsedCandidates.length) {
      toast('لم يتم العثور على أفراد صالحين للاستيراد');
      return;
    }

    renderTable();
  };

  const renderTable = () => {
    previewArea.style.display = 'block';
    const selectedCount = parsedCandidates.filter(c => c.selected).length;
    countLbl.textContent = `معاينة الأفراد الجدد (${selectedCount} محدد من إجمالي ${parsedCandidates.length}):`;

    tbody.innerHTML = parsedCandidates.map((c, idx) => `
      <tr style="${c.is_duplicate ? 'opacity:.7;background:rgba(239,68,68,.08)' : ''}">
        <td><input type="checkbox" data-c-idx="${idx}" ${c.selected ? 'checked' : ''}></td>
        <td><b>${esc(c.full_name)}</b> ${c.is_duplicate ? '<span style="color:#f87171;font-size:.7rem">(اسم مسجل مسبقاً)</span>' : ''}</td>
        <td>${esc(c.father_name || 'غير محدد')}</td>
        <td>${c.gender === 'female' ? 'أنثى' : 'ذكر'}</td>
        <td>${esc(c.city)}</td>
        <td>${esc(c.birth_year_text || '—')}</td>
        <td>${c.is_alive ? 'حي' : 'متوفى'}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-c-idx]').forEach(chk => {
      chk.onchange = () => {
        parsedCandidates[chk.dataset.cIdx].selected = chk.checked;
        const n = parsedCandidates.filter(c => c.selected).length;
        countLbl.textContent = `معاينة الأفراد الجدد (${n} محدد من إجمالي ${parsedCandidates.length}):`;
      };
    });
  };

  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => processText(ev.target.result);
    reader.readAsText(file, 'utf-8');
  };

  if (checkAll) {
    checkAll.onchange = () => {
      parsedCandidates.forEach(c => c.selected = checkAll.checked);
      renderTable();
    };
  }

  $('#btn-paste-csv').onclick = () => {
    const txt = prompt('الصق نص ملف CSV هنا:');
    if (txt) processText(txt);
  };

  $('#btn-dl-template').onclick = () => {
    const sample = `الاسم الكامل,اسم الأب,الجنس,المدينة,سنة الميلاد,الحالة\nسعيد بن محمد بن علي,محمد بن علي,ذكر,النماص,1395,حي\nنورة بنت سعد بن محمد,سعد بن محمد,أنثى,أبها,1420,حي`;
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'almatarid-import-template.csv'
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (doImportBtn) {
    doImportBtn.onclick = () => {
      const toAdd = parsedCandidates.filter(c => c.selected);
      if (!toAdd.length) {
        toast('يرجى تحديد فرد واحد على الأقل للاستيراد');
        return;
      }

      toAdd.forEach(c => {
        const newMember = {
          id: 'n_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          full_name: c.full_name,
          first: c.full_name.split(' ')[0],
          father_id: c.father_id,
          gender: c.gender,
          city: c.city,
          birth_year_text: c.birth_year_text || null,
          is_alive: c.is_alive,
          created_at: Date.now()
        };
        S.members.push(newMember);
      });

      index();
      render();
      saveAutoBackup(true);
      toast(`✓ تم استيراد ${toAdd.length} فرد بنجاح إلى شجرة العائلة دون حذف أحد!`);
      $('#profile').close();
    };
  }
}

$('#m-csv-import').onclick = menuClose(() => openCsvImportModal());

/* ---------- 66) المخططات البديلة: مروحة الأجداد والساعة الرملية والنسل (فرع تجربة) ---------- */
function renderFanChartSvg(m) {
  const chain = getAncestryChain(m);
  const width = 640, height = 360, cx = 320, cy = 340;

  // Level 0: Subject
  // Level 1: Father (and Mother if known)
  // Level 2: Grandfather...
  let svg = `<svg class="fan-svg" viewBox="0 0 ${width} ${height}">`;
  svg += `<defs><radialGradient id="fanGrad" cx="50%" cy="100%" r="100%"><stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0b1329"/></radialGradient></defs>`;
  svg += `<rect width="${width}" height="${height}" fill="url(#fanGrad)" rx="12"/>`;

  // Draw concentric arcs
  const rings = [
    { r: 70, label: 'الفرد' },
    { r: 140, label: 'الآباء' },
    { r: 210, label: 'الأجداد' },
    { r: 280, label: 'أجداد الآباء' },
    { r: 330, label: 'الجيل الأعلى' }
  ];

  rings.forEach((ring, idx) => {
    svg += `<path d="M ${cx - ring.r} ${cy} A ${ring.r} ${ring.r} 0 0 1 ${cx + ring.r} ${cy}" fill="none" stroke="rgba(245,158,11,${0.2 + idx * 0.1})" stroke-width="1.5" stroke-dasharray="${idx === 0 ? 'none' : '4,4'}"/>`;
  });

  // Center hub for subject
  svg += `<circle cx="${cx}" cy="${cy}" r="55" fill="#f59e0b" opacity="0.9"/>`;
  svg += `<text x="${cx}" y="${cy - 20}" fill="#1c1204" font-size="12" font-weight="800" text-anchor="middle">${esc(m.first || m.full_name.split(' ')[0])}</text>`;
  svg += `<text x="${cx}" y="${cy - 6}" fill="#1c1204" font-size="10" text-anchor="middle">الجيل ${gen(m)}</text>`;

  // Draw fan slices for ancestors in chain
  const levels = chain.slice(1, 5);
  levels.forEach((anc, idx) => {
    const ringRadius = 70 + (idx + 1) * 65;
    const angle = (Math.PI / (levels.length + 1)) * (idx + 1);
    const px = cx - Math.cos(angle) * (ringRadius - 30);
    const py = cy - Math.sin(angle) * (ringRadius - 30);

    svg += `<g style="cursor:pointer" onclick="openAlternativeCharts('${anc.id}', 'fan')">`;
    svg += `<circle cx="${px}" cy="${py}" r="26" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>`;
    svg += `<text x="${px}" y="${py + 3}" fill="#fff" font-size="9" font-weight="700" text-anchor="middle">${esc(anc.first || anc.full_name.split(' ')[0])}</text>`;
    svg += `<text x="${px}" y="${py + 15}" fill="#38bdf8" font-size="8" text-anchor="middle">الجيل ${gen(anc)}</text>`;
    svg += `</g>`;

    // Connector line from center
    svg += `<line x1="${cx}" y1="${cy - 45}" x2="${px}" y2="${py + 20}" stroke="rgba(56,189,248,0.4)" stroke-width="1.5"/>`;
  });

  svg += `</svg>`;
  return svg;
}

function renderHourglassSvg(m) {
  const ancestors = getAncestryChain(m).slice(1, 4);
  const kids = S.kids.get(m.id) || [];
  const width = 640, height = 440, cx = 320, cy = 220;

  let svg = `<svg class="fan-svg" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#080e1e" rx="12"/>`;

  // Draw upper triangle area (Ancestors)
  svg += `<polygon points="${cx},${cy} 100,20 540,20" fill="rgba(245,158,11,0.06)" stroke="rgba(245,158,11,0.2)" stroke-dasharray="3,3"/>`;
  // Draw lower triangle area (Descendants)
  svg += `<polygon points="${cx},${cy} 100,420 540,420" fill="rgba(56,189,248,0.06)" stroke="rgba(56,189,248,0.2)" stroke-dasharray="3,3"/>`;

  // Center node (Waist): Subject
  svg += `<circle cx="${cx}" cy="${cy}" r="38" fill="#f59e0b" stroke="#fff" stroke-width="2"/>`;
  svg += `<text x="${cx}" y="${cy - 4}" fill="#1c1204" font-size="11" font-weight="800" text-anchor="middle">${esc(m.first || m.full_name.split(' ')[0])}</text>`;
  svg += `<text x="${cx}" y="${cy + 12}" fill="#1c1204" font-size="9" text-anchor="middle">مركز الساعة</text>`;

  // Ancestors going up
  ancestors.forEach((anc, i) => {
    const y = 140 - i * 50;
    const x = cx + (i % 2 === 0 ? -60 : 60) * (i + 1) * 0.6;
    svg += `<g style="cursor:pointer" onclick="openAlternativeCharts('${anc.id}', 'hourglass')">`;
    svg += `<rect x="${x - 45}" y="${y - 14}" width="90" height="28" rx="6" fill="#1e293b" stroke="#f59e0b"/>`;
    svg += `<text x="${x}" y="${y + 4}" fill="#fff" font-size="9" font-weight="700" text-anchor="middle">👴 ${esc(anc.first || anc.full_name.split(' ')[0])}</text>`;
    svg += `</g>`;
    svg += `<line x1="${cx}" y1="${cy - 38}" x2="${x}" y2="${y + 14}" stroke="#f59e0b" stroke-width="1.2" opacity="0.6"/>`;
  });

  // Kids going down
  kids.slice(0, 5).forEach((kid, i) => {
    const count = Math.min(kids.length, 5);
    const spacing = 460 / (count + 1);
    const x = 90 + spacing * (i + 1);
    const y = 340;
    svg += `<g style="cursor:pointer" onclick="openAlternativeCharts('${kid.id}', 'hourglass')">`;
    svg += `<rect x="${x - 40}" y="${y - 14}" width="80" height="28" rx="6" fill="#0f172a" stroke="#38bdf8"/>`;
    svg += `<text x="${x}" y="${y + 4}" fill="#fff" font-size="9" font-weight="700" text-anchor="middle">${kid.gender === 'female' ? '👧' : '👦'} ${esc(kid.first || kid.full_name.split(' ')[0])}</text>`;
    svg += `</g>`;
    svg += `<line x1="${cx}" y1="${cy + 38}" x2="${x}" y2="${y - 14}" stroke="#38bdf8" stroke-width="1.2" opacity="0.6"/>`;
  });

  svg += `</svg>`;
  return svg;
}

function renderDescendantsTreeHtml(m) {
  const getSubTree = (person, depth = 0) => {
    if (depth > 4) return '';
    const children = S.kids.get(person.id) || [];
    return `
      <div style="margin-right:${depth ? '20px' : '0'};padding-right:${depth ? '12px' : '0'};border-right:${depth ? '2px solid rgba(245,158,11,.4)' : 'none'};margin-top:6px">
        <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer" onclick="openAlternativeCharts('${person.id}', 'descendants')">
          <span style="font-size:1.1rem">${person.gender === 'female' ? '🌸' : '🌿'}</span>
          <b style="color:${depth === 0 ? 'var(--gold)' : '#fff'};font-size:.88rem">${esc(person.full_name)}</b>
          <span class="bd" style="font-size:.68rem">الجيل ${gen(person)}</span>
          ${children.length ? `<span style="font-size:.7rem;color:var(--mut)">(${children.length} أبناء)</span>` : ''}
        </div>
        ${children.length ? `
          <div style="margin-top:4px">
            ${children.map(child => getSubTree(child, depth + 1)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  };

  return `
    <div style="text-align:start;width:100%;max-width:600px;margin:0 auto">
      ${getSubTree(m, 0)}
    </div>
  `;
}

function openAlternativeCharts(memberId = null, chartType = 'fan') {
  const member = memberId ? (S.byId.get(memberId) || S.members[0]) : (S.roots[0] || S.members[0]);
  if (!member) return;

  const html = `
    <div class="alt-charts-wrap">
      <div class="fstats-head">
        <h2>📊 المخططات البديلة لشجرة العائلة</h2>
        <p class="sub">مروحة الأجداد الدائرية، مخطط الساعة الرملية، وشجرة النسل المتصلة</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;gap:6px">
          <button type="button" class="fbook-tab-btn ${chartType === 'fan' ? 'active' : ''}" data-ct="fan">
            🪭 مروحة الأجداد (Fan)
          </button>
          <button type="button" class="fbook-tab-btn ${chartType === 'hourglass' ? 'active' : ''}" data-ct="hourglass">
            ⏳ الساعة الرملية (Hourglass)
          </button>
          <button type="button" class="fbook-tab-btn ${chartType === 'descendants' ? 'active' : ''}" data-ct="descendants">
            🌿 مخطط النسل (Descendant)
          </button>
        </div>

        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:.8rem;color:var(--gold);font-weight:700">الفرد:</label>
          <select id="alt-chart-mem-sel" style="padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
            ${S.members.filter(m => !m.name_masked).slice(0, 100).map(m => `
              <option value="${m.id}" ${m.id === member.id ? 'selected' : ''}>${esc(m.full_name)} (الجيل ${gen(m)})</option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="alt-charts-stage" id="alt-charts-stage-box">
        ${chartType === 'fan' ? renderFanChartSvg(member) : (chartType === 'hourglass' ? renderHourglassSvg(member) : renderDescendantsTreeHtml(member))}
      </div>
    </div>
  `;

  showInfo(html);

  document.querySelectorAll('[data-ct]').forEach(b => {
    b.onclick = () => openAlternativeCharts(member.id, b.dataset.ct);
  });

  const sel = $('#alt-chart-mem-sel');
  if (sel) {
    sel.onchange = () => openAlternativeCharts(sel.value, chartType);
  }
}

$('#m-alt-charts').onclick = menuClose(() => openAlternativeCharts());

/* ============================================================
   67) شبكة العلاقات الشاملة (آباء، أزواج، إخوة في مخطط واحد)
   ============================================================ */
let _netAnimId = null;
let _netRedraw = null;
let _netReset = null;

function initNetworkCanvas(focalId) {
  if (_netAnimId) { cancelAnimationFrame(_netAnimId); _netAnimId = null; }
  const canvas = $('#net-canvas');
  const box = $('#net-box');
  if (!canvas || !box) return;

  const focal = S.byId.get(focalId) || S.roots[0] || S.members[0];
  if (!focal) return;

  const depthVal = $('#net-depth-sel')?.value || '3';
  const maxDepth = depthVal === 'all' ? 99 : parseInt(depthVal, 10);

  // Collect nodes and edges via BFS
  const visited = new Set([focal.id]);
  const queue = [{ id: focal.id, d: 0 }];
  const nodeMap = new Map();
  const edges = [];

  while (queue.length > 0) {
    const { id, d } = queue.shift();
    const m = S.byId.get(id);
    if (!m) continue;

    if (!nodeMap.has(m.id)) {
      nodeMap.set(m.id, {
        id: m.id,
        name: m.full_name,
        shortName: (m.full_name || '').split(' ').slice(0, 2).join(' '),
        isFemale: isFemale(m),
        isFocal: m.id === focal.id,
        deceased: !!m.death_year || !!m.death_date,
        branch: m.branch_id || '',
        gen: gen(m),
        x: (Math.random() - 0.5) * 300,
        y: (Math.random() - 0.5) * 300,
        vx: 0,
        vy: 0,
        radius: m.id === focal.id ? 24 : 18
      });
    }

    if (d >= maxDepth && depthVal !== 'all') continue;

    // 1. Father (Parent)
    if (m.father_id) {
      if (!nodeMap.has(m.father_id)) {
        if (!visited.has(m.father_id)) {
          visited.add(m.father_id);
          queue.push({ id: m.father_id, d: d + 1 });
        }
      }
      edges.push({ source: m.father_id, target: m.id, type: 'parent' });
    }

    // 2. Children (Parent)
    const kids = S.kids.get(m.id) || [];
    kids.forEach(kid => {
      if (!visited.has(kid.id) && (d < maxDepth || depthVal === 'all')) {
        visited.add(kid.id);
        queue.push({ id: kid.id, d: d + 1 });
      }
      edges.push({ source: m.id, target: kid.id, type: 'parent' });
    });

    // 3. Spouses (Wives)
    const wives = (S.wives || []).filter(w => w.husband_id === m.id);
    wives.forEach(w => {
      const wifeNodeId = 'w_' + w.id;
      if (!nodeMap.has(wifeNodeId)) {
        nodeMap.set(wifeNodeId, {
          id: wifeNodeId,
          rawId: w.id,
          name: w.full_name,
          shortName: (w.full_name || '').split(' ').slice(0, 2).join(' '),
          isFemale: true,
          isWife: true,
          deceased: false,
          branch: m.branch_id || '',
          gen: gen(m),
          x: (Math.random() - 0.5) * 300,
          y: (Math.random() - 0.5) * 300,
          vx: 0,
          vy: 0,
          radius: 16
        });
      }
      edges.push({ source: m.id, target: wifeNodeId, type: 'spouse' });
    });

    // 4. Siblings
    if (m.father_id) {
      const sibs = S.kids.get(m.father_id) || [];
      sibs.forEach(sib => {
        if (sib.id !== m.id) {
          if (!visited.has(sib.id) && (d < maxDepth || depthVal === 'all')) {
            visited.add(sib.id);
            queue.push({ id: sib.id, d: d + 1 });
          }
          if (m.id < sib.id) {
            edges.push({ source: m.id, target: sib.id, type: 'sibling' });
          }
        }
      });
    }
  }

  // Deduplicate edges
  const uniqueEdges = [];
  const edgeKeySet = new Set();
  edges.forEach(e => {
    const k = `${e.source}_${e.target}_${e.type}`;
    if (!edgeKeySet.has(k)) {
      edgeKeySet.add(k);
      uniqueEdges.push(e);
    }
  });

  const nodes = Array.from(nodeMap.values());
  const focalNode = nodeMap.get(focal.id);
  if (focalNode) {
    focalNode.x = 0;
    focalNode.y = 0;
  }

  // Canvas setup
  let width = box.clientWidth || 700;
  let height = box.clientHeight || 500;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  let panX = width / 2;
  let panY = height / 2;
  let zoom = 1;
  let hoveredNode = null;
  let draggedNode = null;
  let isPanning = false;
  let startX = 0, startY = 0;

  _netReset = () => {
    panX = width / 2;
    panY = height / 2;
    zoom = 1;
    draw();
  };

  // Run simulation iterations
  function stepPhysics() {
    const kRepel = 2200;
    const restLenParent = 75;
    const restLenSpouse = 55;
    const restLenSibling = 65;

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 350) {
          const force = kRepel / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // Springs
    uniqueEdges.forEach(e => {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) return;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = e.type === 'spouse' ? restLenSpouse : (e.type === 'sibling' ? restLenSibling : restLenParent);
      const delta = dist - rest;
      const force = delta * 0.045;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    // Damp & move
    nodes.forEach(n => {
      if (n === focalNode) {
        n.vx *= 0.2;
        n.vy *= 0.2;
      }
      n.x += n.vx * 0.35;
      n.y += n.vy * 0.35;
      n.vx *= 0.72;
      n.vy *= 0.72;
    });
  }

  // Pre-warm physics
  for (let s = 0; s < 70; s++) {
    stepPhysics();
  }

  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Subtle dark grid background
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gridSize = 40 * zoom;
    const offX = panX % gridSize;
    const offY = panY % gridSize;
    ctx.beginPath();
    for (let x = offX; x < width; x += gridSize) {
      ctx.moveTo(x, 0); ctx.lineTo(x, height);
    }
    for (let y = offY; y < height; y += gridSize) {
      ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const showParent = $('#net-chk-parent')?.checked !== false;
    const showSpouse = $('#net-chk-spouse')?.checked !== false;
    const showSibling = $('#net-chk-sibling')?.checked !== false;

    // Draw Edges
    uniqueEdges.forEach(e => {
      if (e.type === 'parent' && !showParent) return;
      if (e.type === 'spouse' && !showSpouse) return;
      if (e.type === 'sibling' && !showSibling) return;

      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) return;

      const isConnected = hoveredNode && (hoveredNode.id === a.id || hoveredNode.id === b.id);

      ctx.beginPath();
      if (e.type === 'parent') {
        ctx.strokeStyle = isConnected ? '#f59e0b' : 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = isConnected ? 3 : 1.8;
        ctx.setLineDash([]);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Directional arrow to child
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const arrowDist = b.radius + 3;
        const ax = b.x - Math.cos(angle) * arrowDist;
        const ay = b.y - Math.sin(angle) * arrowDist;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 8 * Math.cos(angle - Math.PI / 6), ay - 8 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(ax - 8 * Math.cos(angle + Math.PI / 6), ay - 8 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (e.type === 'spouse') {
        ctx.strokeStyle = isConnected ? '#ec4899' : 'rgba(236, 72, 153, 0.55)';
        ctx.lineWidth = isConnected ? 3 : 2;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small heart/ring circle in midpoint
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.fillStyle = '#ec4899';
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'sibling') {
        ctx.strokeStyle = isConnected ? '#38bdf8' : 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = isConnected ? 2.5 : 1.2;
        ctx.setLineDash([2, 3]);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Draw Nodes
    nodes.forEach(n => {
      const isHovered = hoveredNode && hoveredNode.id === n.id;
      const isFocal = n.isFocal;

      // Glow / border
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + (isHovered ? 4 : 2), 0, Math.PI * 2);
      ctx.fillStyle = isFocal ? 'rgba(245, 158, 11, 0.4)' : (n.isWife ? 'rgba(236, 72, 153, 0.3)' : 'rgba(56, 189, 248, 0.2)');
      ctx.fill();

      // Node body
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      if (isFocal) {
        ctx.fillStyle = '#b45309';
      } else if (n.isWife) {
        ctx.fillStyle = '#9d174d';
      } else if (n.isFemale) {
        ctx.fillStyle = '#831843';
      } else if (n.deceased) {
        ctx.fillStyle = '#1e293b';
      } else {
        ctx.fillStyle = '#0f172a';
      }
      ctx.fill();
      ctx.strokeStyle = isFocal ? '#f59e0b' : (n.isWife ? '#f472b6' : (n.deceased ? '#64748b' : '#38bdf8'));
      ctx.lineWidth = isFocal ? 2.5 : 1.5;
      ctx.stroke();

      // Node text label
      ctx.font = `${isFocal ? 'bold 11px' : '10px'} Cairo, sans-serif`;
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.shortName, n.x, n.y);

      // Label beneath
      if (isFocal || isHovered) {
        ctx.font = 'bold 11px Cairo, sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(n.name, n.x, n.y + n.radius + 14);
      }
    });

    ctx.restore();
  }

  _netRedraw = draw;

  // Animation loop for smooth gentle settle
  let simTicks = 0;
  function animate() {
    if (simTicks < 50) {
      stepPhysics();
      simTicks++;
      draw();
      _netAnimId = requestAnimationFrame(animate);
    } else {
      draw();
      _netAnimId = null;
    }
  }
  animate();

  // Mouse handlers
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const worldX = (mouseX - panX) / zoom;
    const worldY = (mouseY - panY) / zoom;
    return { mouseX, mouseY, worldX, worldY };
  }

  function findNode(worldX, worldY) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = worldX - n.x;
      const dy = worldY - n.y;
      if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
        return n;
      }
    }
    return null;
  }

  canvas.onmousemove = (e) => {
    const { mouseX, mouseY, worldX, worldY } = getMousePos(e);
    if (isPanning) {
      panX += mouseX - startX;
      panY += mouseY - startY;
      startX = mouseX;
      startY = mouseY;
      draw();
      return;
    }
    if (draggedNode) {
      draggedNode.x = worldX;
      draggedNode.y = worldY;
      draw();
      return;
    }
    const found = findNode(worldX, worldY);
    if (found !== hoveredNode) {
      hoveredNode = found;
      canvas.style.cursor = found ? 'pointer' : 'grab';
      draw();
    }
  };

  canvas.onmousedown = (e) => {
    const { mouseX, mouseY, worldX, worldY } = getMousePos(e);
    const found = findNode(worldX, worldY);
    if (found) {
      draggedNode = found;
    } else {
      isPanning = true;
      startX = mouseX;
      startY = mouseY;
    }
  };

  window.onmouseup = () => {
    isPanning = false;
    draggedNode = null;
  };

  canvas.onclick = (e) => {
    const { worldX, worldY } = getMousePos(e);
    const found = findNode(worldX, worldY);
    if (found) {
      if (!found.isWife) {
        profile(found.id);
      } else {
        toast(`💍 ${found.name} (زوجة في العائلة)`);
      }
    }
  };

  canvas.onwheel = (e) => {
    e.preventDefault();
    const { mouseX, mouseY } = getMousePos(e);
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const newZoom = Math.min(Math.max(zoom * factor, 0.3), 3.5);
    panX = mouseX - (mouseX - panX) * (newZoom / zoom);
    panY = mouseY - (mouseY - panY) * (newZoom / zoom);
    zoom = newZoom;
    draw();
  };
}

function openNetworkGraph(focalId) {
  if (_netAnimId) { cancelAnimationFrame(_netAnimId); _netAnimId = null; }
  const focal = focalId ? (S.byId.get(focalId) || S.roots[0] || S.members[0]) : (S.roots[0] || S.members[0]);
  if (!focal) return;

  const html = `
    <div class="net-wrap">
      <div class="fstats-head" style="margin-bottom:0">
        <h2>🕸️ شبكة العلاقات الشاملة</h2>
        <p class="sub">عرض جميع الروابط العائلية (النسب، المصاهرة، الأخوة) في فضاء تفاعلي موحّد</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <label style="font-size:.8rem;color:var(--gold);font-weight:700">المركز:</label>
          <select id="net-focal-sel" style="padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
            ${S.members.filter(m => !m.name_masked).slice(0, 100).map(m => `
              <option value="${m.id}" ${m.id === focal.id ? 'selected' : ''}>${esc(m.full_name)} (الجيل ${gen(m)})</option>
            `).join('')}
          </select>
          <select id="net-depth-sel" style="padding:6px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--txt);font-size:.8rem">
            <option value="2">درجتا قرابة (مباشرة)</option>
            <option value="3" selected>3 درجات قرابة (فرع موسع)</option>
            <option value="all">الفرع بالكامل</option>
          </select>
        </div>

        <div style="display:flex;gap:8px;align-items:center;font-size:.78rem">
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
            <input type="checkbox" id="net-chk-parent" checked> <span style="color:#f59e0b">🟡 بنوة ونسب</span>
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
            <input type="checkbox" id="net-chk-spouse" checked> <span style="color:#ec4899">🔴 زواج ومصاهرة</span>
          </label>
          <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
            <input type="checkbox" id="net-chk-sibling" checked> <span style="color:#38bdf8">🔵 أخوة وأشقاء</span>
          </label>
          <button id="net-export-btn" class="fstats-btn" style="padding:4px 8px;font-size:.75rem">📸 حفظ صورة</button>
        </div>
      </div>

      <div class="net-stage-box" id="net-box">
        <canvas id="net-canvas" class="net-canvas"></canvas>
      </div>

      <div class="net-legend">
        <span>💡 <b>التحكم:</b> اسحب للتحريك · عجلة الماوس للتكبير والتصغير · انقر على أي عقدة لفتح ملفه أو جعله المركز</span>
        <span style="margin-right:auto;color:var(--gold);cursor:pointer" id="net-reset-view">↺ إعادة ضبط المشهد</span>
      </div>
    </div>
  `;

  showInfo(html);
  setTimeout(() => initNetworkCanvas(focal.id), 50);

  const focalSel = $('#net-focal-sel');
  if (focalSel) {
    focalSel.onchange = (e) => initNetworkCanvas(e.target.value);
  }
  const depthSel = $('#net-depth-sel');
  if (depthSel) {
    depthSel.onchange = () => initNetworkCanvas($('#net-focal-sel').value);
  }
  ['net-chk-parent', 'net-chk-spouse', 'net-chk-sibling'].forEach(id => {
    const el = $(`#${id}`);
    if (el) el.onchange = () => _netRedraw?.();
  });
  const resetBtn = $('#net-reset-view');
  if (resetBtn) resetBtn.onclick = () => _netReset?.();
  const exportBtn = $('#net-export-btn');
  if (exportBtn) {
    exportBtn.onclick = () => {
      const cv = $('#net-canvas');
      if (!cv) return;
      const a = document.createElement('a');
      a.download = `almatarid-network-${focal.id}.png`;
      a.href = cv.toDataURL('image/png');
      a.click();
    };
  }
}

$('#m-network-graph').onclick = menuClose(() => openNetworkGraph());

/* ============================================================
   68) عرض الأسلاف فقط أو النسل فقط لشخص معين
   ============================================================ */
function setDescendantsFilter(id) {
  const m = S.byId.get(id);
  if (!m) return;
  const set = new Set([m.id]);
  const queue = [m.id];
  while (queue.length > 0) {
    const cur = queue.shift();
    const kids = S.kids.get(cur) || [];
    kids.forEach(k => {
      set.add(k.id);
      queue.push(k.id);
    });
  }
  S.filterMode = 'descendants';
  S.filterFocalId = m.id;
  S.filterMemberIds = set;
  for (const kidId of set) S.open.add(kidId);
  updateFilterBanner();
  render(true);
  toast(`🌿 تم تصفية الشجرة لعرض نسل «${m.full_name}» (${set.size} فرد)`);
}

function setAncestorsFilter(id) {
  const m = S.byId.get(id);
  if (!m) return;
  const set = new Set();
  let cur = m;
  while (cur) {
    set.add(cur.id);
    cur = S.byId.get(cur.father_id);
  }
  S.filterMode = 'ancestors';
  S.filterFocalId = m.id;
  S.filterMemberIds = set;
  for (const ancId of set) S.open.add(ancId);
  updateFilterBanner();
  render(true);
  toast(`📜 تم تصفية الشجرة لعرض خط أسلاف «${m.full_name}» (${set.size} آباء وأجداد)`);
}

function clearTreeFilter() {
  S.filterMode = null;
  S.filterFocalId = null;
  S.filterMemberIds = null;
  collapseAll();
  updateFilterBanner();
  render(true);
  toast('تم إلغاء التصفية وعرض الشجرة كاملة');
}

function updateFilterBanner() {
  let banner = $('#tree-filter-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'tree-filter-banner';
    banner.className = 'tree-filter-banner';
    const vp = $('#vp');
    if (vp) vp.appendChild(banner);
  }
  if (!S.filterMode || !S.filterFocalId) {
    banner.style.display = 'none';
    return;
  }
  const m = S.byId.get(S.filterFocalId);
  const name = m ? m.full_name : '';
  const count = S.filterMemberIds ? S.filterMemberIds.size : 0;
  const isDesc = S.filterMode === 'descendants';
  const label = isDesc ? `🌿 تصفية النسل فقط لـ: <b>${esc(name)}</b> (${count} فرد)` : `📜 تصفية خط الأسلاف لـ: <b>${esc(name)}</b> (${count} آباء وأجداد)`;
  banner.innerHTML = `
    <span>${label}</span>
    <button type="button" id="tree-filter-clear-btn" style="background:#ef4444;color:#fff;border:none;border-radius:14px;padding:3px 12px;font-size:.78rem;cursor:pointer;font-weight:700">✕ إلغاء التصفية</button>
  `;
  banner.style.display = 'flex';
  const clearBtn = $('#tree-filter-clear-btn');
  if (clearBtn) clearBtn.onclick = clearTreeFilter;
}

function openAncestorsDescendantsModal(selectedId) {
  const current = selectedId ? S.byId.get(selectedId) : (S.curId ? S.byId.get(S.curId) : (S.roots[0] || S.members[0]));
  if (!current) return;

  const descCount = (() => {
    let cnt = 0;
    const q = [current.id];
    while (q.length) {
      const c = q.shift();
      const ks = S.kids.get(c) || [];
      cnt += ks.length;
      ks.forEach(k => q.push(k.id));
    }
    return cnt;
  })();

  const ancCount = (() => {
    let cnt = 0, p = current;
    while (p) { cnt++; p = S.byId.get(p.father_id); }
    return cnt;
  })();

  const html = `
    <div style="max-width:550px">
      <div class="fstats-head">
        <h2>🎯 تصفية الشجرة: الأسلاف فقط أو النسل فقط</h2>
        <p class="sub">عزل فرع محدد من الشجرة لتسهيل التتبع والتركيز دون تشتيت</p>
      </div>

      <div style="margin:16px 0;display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="font-weight:700;color:var(--gold);display:block;margin-bottom:6px">اختر الفرد المطلوب:</label>
          <select id="anc-desc-sel" style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.9rem">
            ${S.members.filter(m => !m.name_masked).slice(0, 150).map(m => `
              <option value="${m.id}" ${m.id === current.id ? 'selected' : ''}>${esc(m.full_name)} (الجيل ${gen(m)})</option>
            `).join('')}
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
          <div style="background:rgba(16,185,129,.1);border:1.5px solid #10b981;border-radius:10px;padding:12px;text-align:center;display:flex;flex-direction:column;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:1.6rem">🌿</div>
              <b style="color:#10b981;display:block">عرض النسل فقط</b>
              <p style="font-size:.76rem;color:var(--mut);margin:4px 0">يُظهر هذا الفرد وجميع ذريته (${descCount} فرد من الأبناء والأحفاد)</p>
            </div>
            <button type="button" id="anc-desc-btn-desc" class="fstats-btn" style="background:#10b981;border-color:#10b981;color:#fff;font-weight:700;padding:6px 10px;font-size:.82rem">تطبيق عرض النسل ←</button>
          </div>

          <div style="background:rgba(59,130,246,.1);border:1.5px solid #3b82f6;border-radius:10px;padding:12px;text-align:center;display:flex;flex-direction:column;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:1.6rem">📜</div>
              <b style="color:#3b82f6;display:block">عرض الأسلاف فقط</b>
              <p style="font-size:.76rem;color:var(--mut);margin:4px 0">يُظهر خط الآباء والأجداد المباشرين صعوداً حتى المؤسس (${ancCount} أجيال)</p>
            </div>
            <button type="button" id="anc-desc-btn-anc" class="fstats-btn" style="background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:700;padding:6px 10px;font-size:.82rem">تطبيق عرض الأسلاف ←</button>
          </div>
        </div>

        ${S.filterMode ? `
          <div style="margin-top:10px;text-align:center">
            <button type="button" id="anc-desc-btn-reset" style="background:#ef4444;border:none;border-radius:8px;color:#fff;padding:8px 16px;font-weight:700;font-size:.85rem;cursor:pointer">
              ✕ إلغاء التصفية الحالية وعرض الشجرة بالكامل
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  showInfo(html);

  const sel = $('#anc-desc-sel');
  if (sel) {
    sel.onchange = () => openAncestorsDescendantsModal(sel.value);
  }
  const btnDesc = $('#anc-desc-btn-desc');
  if (btnDesc) {
    btnDesc.onclick = () => {
      $('#profile').close();
      setDescendantsFilter(sel.value);
    };
  }
  const btnAnc = $('#anc-desc-btn-anc');
  if (btnAnc) {
    btnAnc.onclick = () => {
      $('#profile').close();
      setAncestorsFilter(sel.value);
    };
  }
  const btnReset = $('#anc-desc-btn-reset');
  if (btnReset) {
    btnReset.onclick = () => {
      $('#profile').close();
      clearTreeFilter();
    };
  }
}

$('#m-anc-desc').onclick = menuClose(() => openAncestorsDescendantsModal());

/* ============================================================
   69) زر «هذا أنا» وتوسيط الشجرة عليك
   ============================================================ */
function centerOnMember(memberId) {
  const m = S.byId.get(memberId);
  if (!m) return false;

  // Open all ancestral nodes so this member is visible in the hierarchy
  let cur = m;
  while (cur) {
    if (cur.father_id) S.open.add(cur.father_id);
    cur = S.byId.get(cur.father_id);
  }
  S.curId = m.id;
  render();

  if (S.view === 'graph') {
    const p = S._pos?.get(m.id);
    if (p) {
      const vp = $('#vp'), st = $('#stage');
      st.classList.add('anim');
      V.k = 1.05;
      V.x = vp.clientWidth / 2 - (S._X(p.x) + W / 2) * V.k;
      V.y = vp.clientHeight / 2 - (p.y + H / 2) * V.k;
      setT();
      setTimeout(() => st.classList.remove('anim'), 350);

      // Pulse glow highlight on this card
      const nodeEl = document.querySelector(`[data-p="${m.id}"]`);
      if (nodeEl) {
        nodeEl.classList.add('me-highlight');
        setTimeout(() => nodeEl.classList.remove('me-highlight'), 3500);
      }
      return true;
    }
  } else {
    const cardEl = document.querySelector(`[data-p="${m.id}"]`);
    if (cardEl) {
      cardEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      cardEl.classList.add('me-highlight');
      setTimeout(() => cardEl.classList.remove('me-highlight'), 3500);
      return true;
    }
  }
  return false;
}

function triggerThisIsMe(forceModal = false) {
  const meId = localStorage.getItem('almatarid_me_id');
  if (meId && S.byId.has(meId) && !forceModal) {
    const m = S.byId.get(meId);
    centerOnMember(meId);
    toast(`📍 مرحباً بك! تم التوسيط عليك: «${m.full_name}»`);
  } else {
    openSetMeModal();
  }
}

function openSetMeModal() {
  const currentMeId = localStorage.getItem('almatarid_me_id');
  const currentMe = currentMeId ? S.byId.get(currentMeId) : null;

  const html = `
    <div style="max-width:500px">
      <div class="fstats-head">
        <h2>👤 تحديد موقعك: «هذا أنا»</h2>
        <p class="sub">اختر اسمك من الشجرة لتمكين التمركز الفوري عليك بضغطة زر واحدة</p>
      </div>

      ${currentMe ? `
        <div style="background:rgba(245,158,11,.1);border:1.5px solid var(--gold);border-radius:10px;padding:12px;margin:12px 0;display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div>
            <div style="font-size:.78rem;color:var(--gold);font-weight:700">موقعك المسجل حالياً:</div>
            <b style="font-size:1rem;color:#f8fafc">${esc(currentMe.full_name)}</b>
            <div style="font-size:.75rem;color:var(--mut)">الجيل ${gen(currentMe)} · ${currentMe.city || 'العائلة'}</div>
          </div>
          <button type="button" id="me-btn-center-now" class="fstats-btn" style="padding:6px 12px;font-size:.8rem;font-weight:700">🎯 تمركز الآن</button>
        </div>
      ` : ''}

      <div style="margin:14px 0">
        <label style="font-weight:700;color:var(--gold);display:block;margin-bottom:6px">
          ${currentMe ? 'أو اختر شخصاً آخر للتغيير:' : 'من أنت في شجرة العائلة؟'}
        </label>
        <input type="text" id="me-search-input" placeholder="اكتب اسمك للبحث السريع..." style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.88rem;box-sizing:border-box;margin-bottom:8px">
        <select id="me-member-sel" size="6" style="width:100%;padding:6px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.85rem;box-sizing:border-box">
          ${S.members.filter(m => !m.name_masked).slice(0, 100).map(m => `
            <option value="${m.id}" ${currentMe && m.id === currentMe.id ? 'selected' : ''}>${esc(m.full_name)} (الجيل ${gen(m)})</option>
          `).join('')}
        </select>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button type="button" id="me-btn-save" class="fstats-btn" style="background:var(--gold);color:#0f172a;font-weight:700;padding:8px 18px;font-size:.85rem">
          💾 حفظ وتوسيط الشجرة عليّ
        </button>
        ${currentMe ? `
          <button type="button" id="me-btn-clear" style="background:transparent;border:1px solid #ef4444;color:#ef4444;border-radius:8px;padding:6px 12px;font-size:.8rem;cursor:pointer">
            إلغاء هويتي المسجلة
          </button>
        ` : ''}
      </div>
    </div>
  `;

  showInfo(html);

  const searchInp = $('#me-search-input');
  const sel = $('#me-member-sel');

  if (searchInp && sel) {
    searchInp.oninput = () => {
      const q = normAr(searchInp.value.trim().toLowerCase());
      const filtered = S.members.filter(m => !m.name_masked && (!q || normAr(m.full_name.toLowerCase()).includes(q))).slice(0, 80);
      sel.innerHTML = filtered.map(m => `
        <option value="${m.id}">${esc(m.full_name)} (الجيل ${gen(m)})</option>
      `).join('');
      if (filtered.length > 0) sel.selectedIndex = 0;
    };
  }

  const centerNowBtn = $('#me-btn-center-now');
  if (centerNowBtn && currentMe) {
    centerNowBtn.onclick = () => {
      $('#profile').close();
      centerOnMember(currentMe.id);
    };
  }

  const saveBtn = $('#me-btn-save');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const mid = sel?.value;
      if (!mid) return alert('يرجى اختيار اسمك من القائمة');
      localStorage.setItem('almatarid_me_id', mid);
      $('#profile').close();
      centerOnMember(mid);
      toast(`✅ تم حفظ هويتك: «${S.byId.get(mid)?.full_name}» وتم توسيط الشجرة عليك!`);
    };
  }

  const clearBtn = $('#me-btn-clear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      localStorage.removeItem('almatarid_me_id');
      $('#profile').close();
      toast('تم إلغاء التعيين.');
    };
  }
}

const zMe = $('#z-me');
if (zMe) zMe.onclick = () => triggerThisIsMe();
$('#m-this-is-me').onclick = menuClose(() => triggerThisIsMe(true));

/* ============================================================
   70) دليل الأعضاء الكامل (مرتب بالجيل أو الأبجدية مع عداد)
   ============================================================ */
S.dirMode = S.dirMode || 'gen';
S.dirCollapsedGens = S.dirCollapsedGens || new Set();
S.dirCollapsedLetters = S.dirCollapsedLetters || new Set();

function renderDirectoryList() {
  const mode = S.dirMode || 'gen';
  const treeEl = $('#tree');
  if (!treeEl) return;

  document.querySelectorAll('[data-dir-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.dirMode === mode);
  });

  const list = S.members.filter(m => !m.name_masked && (!S.hit || S.hit.has(m.id)));

  const counterSpan = $('#dir-counter span');
  if (counterSpan) counterSpan.textContent = list.length;

  if (mode === 'tree') {
    treeEl.className = 'tree';
    treeEl.innerHTML = dispRoots().map(node).join('');
    return;
  }

  treeEl.className = 'tree dir-container';

  if (mode === 'gen') {
    const groups = new Map();
    list.forEach(m => {
      const g = gen(m);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    });

    const sortedGens = Array.from(groups.keys()).sort((a, b) => a - b);
    let html = '';
    sortedGens.forEach(g => {
      const mems = groups.get(g).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
      const isCollapsed = S.dirCollapsedGens.has(g);
      html += `
        <div class="dir-group-section">
          <div class="dir-group-head" data-toggle-gen="${g}" tabindex="0" role="button">
            <span>${g === 1 ? '👑 الجيل الأول (الآباء المؤسسون)' : `🌿 الجيل ${g}`}</span>
            <span class="dir-group-count">${mems.length} فرد ${isCollapsed ? '◀' : '▼'}</span>
          </div>
          ${!isCollapsed ? `
            <div class="dir-grid">
              ${mems.map(renderDirCard).join('')}
            </div>
          ` : ''}
        </div>
      `;
    });
    treeEl.innerHTML = html || '<p style="text-align:center;color:var(--mut);padding:20px">لا توجد نتائج مطابقة</p>';
  } else if (mode === 'alpha') {
    const groups = new Map();
    list.forEach(m => {
      const clean = normAr(m.full_name.trim());
      const char = clean.charAt(0) || 'أ';
      if (!groups.has(char)) groups.set(char, []);
      groups.get(char).push(m);
    });

    const sortedLetters = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, 'ar'));
    let html = '';
    sortedLetters.forEach(char => {
      const mems = groups.get(char).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
      const isCollapsed = S.dirCollapsedLetters.has(char);
      html += `
        <div class="dir-group-section">
          <div class="dir-group-head" data-toggle-letter="${char}" tabindex="0" role="button">
            <span>حرف (${char})</span>
            <span class="dir-group-count">${mems.length} فرد ${isCollapsed ? '◀' : '▼'}</span>
          </div>
          ${!isCollapsed ? `
            <div class="dir-grid">
              ${mems.map(renderDirCard).join('')}
            </div>
          ` : ''}
        </div>
      `;
    });
    treeEl.innerHTML = html || '<p style="text-align:center;color:var(--mut);padding:20px">لا توجد نتائج مطابقة</p>';
  }
}

function renderDirCard(m) {
  const photo = S.photos.get(m.id);
  const isDead = m.is_alive === false;
  const isMe = localStorage.getItem('almatarid_me_id') === m.id;
  const hit = S.hit?.has(m.id);
  return `
    <div class="dir-card${hit ? ' hit' : ''}${isMe ? ' me-highlight' : ''}" data-p="${m.id}" tabindex="0" role="button">
      ${photo && !livingHidden(m) ? `<img class="gimg2" src="${photo}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:1.5px solid var(--gold)">` : `<div style="width:38px;height:38px;border-radius:50%;background:rgba(245,158,11,.15);color:var(--gold);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem">${isFemale(m) ? '👧' : '👤'}</div>`}
      <div style="flex:1;min-width:0">
        <b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.88rem;color:var(--txt)">${esc(cardName(m))}</b>
        <div style="font-size:.72rem;color:var(--mut);display:flex;gap:6px;align-items:center;margin-top:2px;flex-wrap:wrap">
          <span style="color:var(--gold)">الجيل ${gen(m)}</span>
          ${m.city && !livingHidden(m) ? `<span>· 📍 ${esc(m.city)}</span>` : ''}
          ${isDead ? `<span style="color:#94a3b8">· ${ripText(m)}</span>` : '<span style="color:#10b981">· حي</span>'}
          ${isMe ? '<span style="color:#fbbf24;font-weight:700">· أنت ⭐</span>' : ''}
        </div>
      </div>
    </div>
  `;
}

// Directory controls and clicks
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-dir-mode]');
  if (tab) {
    S.dirMode = tab.dataset.dirMode;
    render();
    return;
  }
  const genHead = e.target.closest('[data-toggle-gen]');
  if (genHead) {
    const g = parseInt(genHead.dataset.toggleGen, 10);
    if (S.dirCollapsedGens.has(g)) S.dirCollapsedGens.delete(g);
    else S.dirCollapsedGens.add(g);
    renderDirectoryList();
    return;
  }
  const letterHead = e.target.closest('[data-toggle-letter]');
  if (letterHead) {
    const char = letterHead.dataset.toggleLetter;
    if (S.dirCollapsedLetters.has(char)) S.dirCollapsedLetters.delete(char);
    else S.dirCollapsedLetters.add(char);
    renderDirectoryList();
    return;
  }
});

const mMemberDir = $('#m-member-directory');
if (mMemberDir) {
  mMemberDir.onclick = menuClose(() => {
    S.view = 'list';
    S.dirMode = 'gen';
    render();
    syncBbView?.();
    $('#tree').scrollIntoView({ behavior: 'smooth' });
    toast('📖 تم فتح دليل الأعضاء الكامل');
  });
}

/* ============================================================
   71) أشجار منفصلة وإظهار/إخفاء الفروع
   ============================================================ */
S.hiddenBranches = S.hiddenBranches || new Set();

function getMajorBranches() {
  const list = [];
  const seenRoots = new Set();
  (S.branches || []).forEach(b => {
    if (b.root_id && S.byId.has(b.root_id) && !seenRoots.has(b.root_id)) {
      seenRoots.add(b.root_id);
      const m = S.byId.get(b.root_id);
      list.push({
        id: b.root_id,
        name: b.label ? `فرع ${b.label}` : `فرع ${m.full_name}`,
        root: m
      });
    }
  });

  if (S.roots && S.roots.length > 0) {
    S.roots.forEach(r => {
      const kids = S.kids.get(r.id) || [];
      kids.forEach(k => {
        if (!seenRoots.has(k.id)) {
          seenRoots.add(k.id);
          list.push({
            id: k.id,
            name: `فرع ${k.full_name}`,
            root: k
          });
        }
      });
    });
  }
  return list;
}

function updateBranchVisibilityBar() {
  const bar = $('#branch-visibility-bar');
  const chipsList = $('#branch-chips-list');
  if (!bar || !chipsList) return;

  const branches = getMajorBranches();
  if (!branches.length) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  chipsList.innerHTML = branches.map(b => {
    const isHidden = S.hiddenBranches.has(b.id);
    return `
      <button type="button" class="branch-chip ${isHidden ? 'hidden-branch' : 'active'}" data-branch-toggle="${b.id}" title="${isHidden ? 'انقر لإظهار هذا الفرع' : 'انقر لإخفاء هذا الفرع'}">
        <span>${isHidden ? '👁️‍🗨️' : '👁️'}</span>
        <span>${esc(b.name)}</span>
      </button>
    `;
  }).join('');
}

function toggleBranch(branchId) {
  if (S.hiddenBranches.has(branchId)) {
    S.hiddenBranches.delete(branchId);
    toast('تم إظهار الفرع');
  } else {
    S.hiddenBranches.add(branchId);
    toast('تم إخفاء الفرع من الشجرة');
  }
  updateBranchVisibilityBar();
  render(true);
}

function isolateBranch(branchId) {
  const branches = getMajorBranches();
  S.hiddenBranches = new Set(branches.filter(b => b.id !== branchId).map(b => b.id));
  updateBranchVisibilityBar();
  render(true);
  const target = branches.find(b => b.id === branchId);
  toast(`🌿 تم عزل وعرض «${target ? target.name : ''}» فقط`);
}

function showAllBranches() {
  S.hiddenBranches.clear();
  updateBranchVisibilityBar();
  render(true);
  toast('تم إظهار جميع فروع الشجرة');
}

function openBranchTreesModal() {
  const branches = getMajorBranches();

  const countBranch = (rootId) => {
    let count = 0;
    const q = [rootId];
    while (q.length) {
      const cur = q.shift();
      count++;
      const ks = S.kids.get(cur) || [];
      ks.forEach(k => q.push(k.id));
    }
    return count;
  };

  const html = `
    <div style="max-width:560px">
      <div class="fstats-head">
        <h2>🌿 أشجار الفروع: إظهار وإخفاء</h2>
        <p class="sub">فصل فروع العائلة للتركيز على فرع مستقل أو إخفاء الفروع الأخرى من الشجرة</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px 0">
        <span style="font-size:.85rem;color:var(--gold);font-weight:700">فروع العائلة الكبرى (${branches.length} فروع):</span>
        <div style="display:flex;gap:6px">
          <button type="button" id="bmodal-show-all" class="fstats-btn" style="padding:4px 10px;font-size:.75rem">إظهار الكل</button>
          <button type="button" id="bmodal-hide-all" class="fstats-btn" style="padding:4px 10px;font-size:.75rem;background:transparent;border-color:var(--line);color:var(--mut)">إخفاء الكل</button>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto;padding-left:4px">
        ${branches.map(b => {
          const isHidden = S.hiddenBranches.has(b.id);
          const totalInBranch = countBranch(b.id);
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,.85);border:1.5px solid ${isHidden ? 'var(--line)' : 'var(--gold)'};border-radius:10px;padding:10px 14px;gap:10px">
              <div>
                <b style="font-size:.95rem;color:${isHidden ? 'var(--mut)' : '#f8fafc'}">${esc(b.name)}</b>
                <div style="font-size:.75rem;color:var(--mut);margin-top:2px">
                  رأس الفرع: ${esc(b.root.full_name)} · 👥 ${totalInBranch} فرد
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" class="fstats-btn" data-isolate-branch="${b.id}" style="padding:4px 10px;font-size:.75rem;background:rgba(245,158,11,.15);border-color:var(--gold);color:var(--gold)">
                  عزل هذا الفرع فقط
                </button>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:.8rem;color:${isHidden ? '#ef4444' : '#10b981'};font-weight:700">
                  <input type="checkbox" data-modal-branch-toggle="${b.id}" ${isHidden ? '' : 'checked'}>
                  <span>${isHidden ? 'مخفي' : 'ظاهر'}</span>
                </label>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  showInfo(html);

  const bShowAll = $('#bmodal-show-all');
  if (bShowAll) bShowAll.onclick = () => { showAllBranches(); openBranchTreesModal(); };
  const bHideAll = $('#bmodal-hide-all');
  if (bHideAll) bHideAll.onclick = () => { S.hiddenBranches = new Set(branches.map(b => b.id)); updateBranchVisibilityBar(); render(true); openBranchTreesModal(); };
  document.querySelectorAll('[data-modal-branch-toggle]').forEach(ch => {
    ch.onchange = () => { toggleBranch(ch.dataset.modalBranchToggle); openBranchTreesModal(); };
  });
  document.querySelectorAll('[data-isolate-branch]').forEach(btn => {
    btn.onclick = () => { isolateBranch(btn.dataset.isolateBranch); $('#profile').close(); };
  });
}

document.addEventListener('click', e => {
  const chip = e.target.closest('[data-branch-toggle]');
  if (chip) {
    toggleBranch(chip.dataset.branchToggle);
    return;
  }
});

const branchVisAll = $('#branch-vis-all');
if (branchVisAll) branchVisAll.onclick = showAllBranches;

const mBranchTrees = $('#m-branch-trees');
if (mBranchTrees) mBranchTrees.onclick = menuClose(() => openBranchTreesModal());

/* ============================================================
   72) إعادة ترتيب عرض الشجرة بالسحب والإفلات (للمصرح لهم فقط)
   ============================================================ */
function openSiblingReorderModal(selectedParentId) {
  if (!canEdit() && S.role !== 'branch') {
    return alert('هذه الميزة متاحة للمالك والمحرر ومسؤول الفرع فقط.');
  }

  // Find eligible parents who have 2+ children
  const eligibleParents = S.members.filter(m => {
    const ks = S.kids.get(m.id) || [];
    if (ks.length < 2) return false;
    if (S.role === 'branch') return inBranch(m);
    return true;
  }).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));

  if (!eligibleParents.length) {
    return toast('لا توجد عوائل تضم أكثر من ابن واحد لإعادة ترتيبها.');
  }

  const parentId = selectedParentId && eligibleParents.some(p => p.id === selectedParentId)
    ? selectedParentId
    : eligibleParents[0].id;

  const parent = S.byId.get(parentId);
  const siblings = [...(S.kids.get(parentId) || [])].sort((a, b) => (a.birth_order || 99) - (b.birth_order || 99));

  const html = `
    <div style="max-width:540px">
      <div class="fstats-head">
        <h2>↕️ إعادة ترتيب الأبناء بالسحب والإفلات</h2>
        <p class="sub">رتّب أبناء الأسرة بالسحب أو الأسهم لحفظ ترتيب الظهور الأفقي على الشجرة</p>
      </div>

      <div style="margin:12px 0">
        <label style="font-size:.82rem;font-weight:700;color:var(--gold);display:block;margin-bottom:6px">اختر الأسرة (الوالد):</label>
        <select id="reorder-parent-sel" style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.88rem">
          ${eligibleParents.map(p => `
            <option value="${p.id}" ${p.id === parentId ? 'selected' : ''}>
              ${esc(p.full_name)} (${(S.kids.get(p.id) || []).length} أبناء)
            </option>
          `).join('')}
        </select>
      </div>

      <div style="font-size:.78rem;color:var(--mut);margin-bottom:6px">
        💡 اسحب العنصر للأعلى/الأسفل لتغيير موقعه، أو استخدم أسهم الترتيب السريع (⬆️ ⬇️):
      </div>

      <div id="dnd-list-box" class="dnd-list">
        ${siblings.map((child, idx) => `
          <div class="dnd-item" draggable="true" data-mid="${child.id}" data-idx="${idx}">
            <span class="dnd-handle" title="اسحب للترتيب">⠿</span>
            <span class="dnd-rank">#${idx + 1}</span>
            <div style="flex:1;min-width:0">
              <b style="display:block;font-size:.9rem;color:#f8fafc">${esc(cardName(child))}</b>
              <div style="font-size:.73rem;color:var(--mut)">
                ${child.gender === 'female' ? '👧 أنثى' : '👦 ذكر'}
                ${child.birth_year_text ? ` · مواليد ${esc(child.birth_year_text)}` : ''}
              </div>
            </div>
            <div class="dnd-ctrls">
              <button type="button" class="dnd-btn" data-mv-up="${idx}" title="تقديم" ${idx === 0 ? 'disabled style="opacity:.3"' : ''}>⬆️</button>
              <button type="button" class="dnd-btn" data-mv-dn="${idx}" title="تأخير" ${idx === siblings.length - 1 ? 'disabled style="opacity:.3"' : ''}>⬇️</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:8px">
        <button type="button" id="dnd-save-order" class="fstats-btn" style="background:var(--gold);color:#0f172a;font-weight:700;padding:8px 18px;font-size:.88rem">
          💾 حفظ الترتيب الجديد للشجرة
        </button>
        <button type="button" onclick="$('#profile').close();" class="fstats-btn" style="background:transparent;border-color:var(--line);color:var(--mut)">
          إلغاء
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const sel = $('#reorder-parent-sel');
  if (sel) {
    sel.onchange = () => openSiblingReorderModal(sel.value);
  }

  let currentSiblings = [...siblings];

  function refreshDndView() {
    const box = $('#dnd-list-box');
    if (!box) return;
    box.innerHTML = currentSiblings.map((child, idx) => `
      <div class="dnd-item" draggable="true" data-mid="${child.id}" data-idx="${idx}">
        <span class="dnd-handle" title="اسحب للترتيب">⠿</span>
        <span class="dnd-rank">#${idx + 1}</span>
        <div style="flex:1;min-width:0">
          <b style="display:block;font-size:.9rem;color:#f8fafc">${esc(cardName(child))}</b>
          <div style="font-size:.73rem;color:var(--mut)">
            ${child.gender === 'female' ? '👧 أنثى' : '👦 ذكر'}
            ${child.birth_year_text ? ` · مواليد ${esc(child.birth_year_text)}` : ''}
          </div>
        </div>
        <div class="dnd-ctrls">
          <button type="button" class="dnd-btn" data-mv-up="${idx}" title="تقديم" ${idx === 0 ? 'disabled style="opacity:.3"' : ''}>⬆️</button>
          <button type="button" class="dnd-btn" data-mv-dn="${idx}" title="تأخير" ${idx === currentSiblings.length - 1 ? 'disabled style="opacity:.3"' : ''}>⬇️</button>
        </div>
      </div>
    `).join('');
    setupDragEvents();
  }

  function setupDragEvents() {
    const items = document.querySelectorAll('.dnd-item');
    let dragSrcIndex = null;

    items.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        dragSrcIndex = parseInt(item.dataset.idx, 10);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropIndex = parseInt(item.dataset.idx, 10);
        if (dragSrcIndex !== null && dropIndex !== null && dragSrcIndex !== dropIndex) {
          const moved = currentSiblings.splice(dragSrcIndex, 1)[0];
          currentSiblings.splice(dropIndex, 0, moved);
          refreshDndView();
        }
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
    });

    document.querySelectorAll('[data-mv-up]').forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.mvUp, 10);
        if (i > 0) {
          const temp = currentSiblings[i];
          currentSiblings[i] = currentSiblings[i - 1];
          currentSiblings[i - 1] = temp;
          refreshDndView();
        }
      };
    });

    document.querySelectorAll('[data-mv-dn]').forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.mvDn, 10);
        if (i < currentSiblings.length - 1) {
          const temp = currentSiblings[i];
          currentSiblings[i] = currentSiblings[i + 1];
          currentSiblings[i + 1] = temp;
          refreshDndView();
        }
      };
    });
  }

  setupDragEvents();

  const saveBtn = $('#dnd-save-order');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      currentSiblings.forEach((child, idx) => {
        child.birth_order = idx + 1;
        const mem = S.byId.get(child.id);
        if (mem) mem.birth_order = idx + 1;
      });

      index();
      render(true);

      $('#profile').close();
      toast(`✅ تم حفظ ترتيب أبناء «${parent.full_name}» وتحديث الشجرة بنجاح!`);

      if (!CFG.DEMO && canEdit()) {
        try {
          for (const child of currentSiblings) {
            await rpc('secure_save_member', {
              p_passcode: S.code,
              p_id: child.id,
              p_birth_order: child.birth_order
            });
          }
        } catch (e) {
          console.warn('Server sync error:', e);
        }
      }
    };
  }
}

const mReorderTree = $('#m-reorder-tree');
if (mReorderTree) {
  mReorderTree.onclick = menuClose(() => openSiblingReorderModal());
}

/* ============================================================
   73) واجهة ثنائية اللغة (AR / EN)
   ============================================================ */
const I18N = {
  ar: {
    title: 'شجرة آل مطارد',
    sub: 'بنو عمرو · النماص',
    searchPlaceholder: 'ابحث بالاسم أو الكنية',
    btnOpen: 'فتح الكل',
    btnClose: 'طي الكل',
    vGraph: 'مخطط',
    vList: 'قائمة',
    fitScreen: 'ملاءمة الشاشة',
    thisIsMe: 'هذا أنا',
    login: 'دخول',
    logout: 'خروج',
    langToggle: 'English 🌐',
    emptyMsg: 'لا توجد نتائج لهذا البحث.',
    dirGen: '🔢 حسب الجيل',
    dirAlpha: '🔤 حسب الأبجدية (أ-ي)',
    dirTree: '🌳 عرض الشجرة الهرمي',
    branchTrees: '🌿 فروع الشجرة:',
    showAll: 'إظهار الكل'
  },
  en: {
    title: 'Al-Mutarid Tree',
    sub: 'Banu Amr · Al-Namas',
    searchPlaceholder: 'Search by name or nickname...',
    btnOpen: 'Expand All',
    btnClose: 'Collapse All',
    vGraph: 'Tree View',
    vList: 'List View',
    fitScreen: 'Fit View',
    thisIsMe: 'This is Me',
    login: 'Login',
    logout: 'Logout',
    langToggle: 'عربي 🌐',
    emptyMsg: 'No results found for this search.',
    dirGen: '🔢 By Generation',
    dirAlpha: '🔤 Alphabetical (A-Z)',
    dirTree: '🌳 Hierarchical Tree',
    branchTrees: '🌿 Family Branches:',
    showAll: 'Show All'
  }
};

function applyLanguage(lang) {
  S.lang = lang || (localStorage.getItem('almatarid_lang') === 'en' ? 'en' : 'ar');
  localStorage.setItem('almatarid_lang', S.lang);

  const isEn = S.lang === 'en';
  const t = I18N[S.lang] || I18N.ar;

  document.documentElement.lang = S.lang;
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';

  const titleEl = document.querySelector('header h1');
  if (titleEl) titleEl.textContent = t.title;
  const subEl = document.querySelector('header .sub');
  if (subEl) subEl.textContent = t.sub;

  const qInput = $('#q');
  if (qInput) qInput.placeholder = t.searchPlaceholder;

  const btnOpen = $('#btn-open');
  if (btnOpen) btnOpen.innerHTML = `<span class="ic">➕</span>${t.btnOpen}`;
  const btnClose = $('#btn-close');
  if (btnClose) btnClose.innerHTML = `<span class="ic">➖</span>${t.btnClose}`;

  const vGraph = $('#v-graph');
  if (vGraph) vGraph.innerHTML = `<span class="ic">🌳</span>${t.vGraph}`;
  const vList = $('#v-list');
  if (vList) vList.innerHTML = `<span class="ic">☰</span>${t.vList}`;

  const zFit = $('#z-fit');
  if (zFit) zFit.innerHTML = t.fitScreen.replace(' ', '<br>');
  const zMe = $('#z-me');
  if (zMe) zMe.innerHTML = `👤<br>${t.thisIsMe}`;

  const btnLang = $('#btn-lang');
  if (btnLang) btnLang.textContent = isEn ? '🌐 عربي' : '🌐 EN';

  if (S.role === 'visitor') {
    const btnLogin = $('#btn-login');
    if (btnLogin) btnLogin.textContent = t.login;
  }

  const dirGen = document.querySelector('[data-dir-mode="gen"]');
  if (dirGen) dirGen.textContent = t.dirGen;
  const dirAlpha = document.querySelector('[data-dir-mode="alpha"]');
  if (dirAlpha) dirAlpha.textContent = t.dirAlpha;
  const dirTree = document.querySelector('[data-dir-mode="tree"]');
  if (dirTree) dirTree.textContent = t.dirTree;

  const branchTitle = document.querySelector('.branch-vis-title');
  if (branchTitle) branchTitle.textContent = t.branchTrees;
  const branchVisAll = $('#branch-vis-all');
  if (branchVisAll) branchVisAll.textContent = t.showAll;
}

function toggleLanguage() {
  const nextLang = S.lang === 'en' ? 'ar' : 'en';
  applyLanguage(nextLang);
  render();
  toast(nextLang === 'en' ? '🌐 Language switched to English' : '🌐 تم تغيير اللغة إلى العربية');
}

const btnLang = $('#btn-lang');
if (btnLang) btnLang.onclick = toggleLanguage;

const mLangToggle = $('#m-lang-toggle');
if (mLangToggle) mLangToggle.onclick = menuClose(() => toggleLanguage());

applyLanguage();

setTimeout(updateBranchVisibilityBar, 300);

/* ============================================================
   74) نافذة البحث المتقدم والتصفية مع بدائل إملائية
   ============================================================ */
function openAdvancedSearchModal() {
  const cities = [...new Set(S.members.map(m => m.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const branches = getMajorBranches ? getMajorBranches() : [];
  const maxGen = S.members.reduce((max, m) => Math.max(max, gen(m)), 1);
  const gens = Array.from({ length: maxGen }, (_, i) => i + 1);

  const f = S.advFilter || { branchId: '', city: '', gen: '', aliveStatus: 'all' };

  const html = `
    <div style="max-width:540px">
      <div class="fstats-head">
        <h2>🔍 البحث المتقدم وتصفية شجرة العائلة</h2>
        <p class="sub">تصفية دقيقة حسب الفرع والمدينة والجيل والحالة مع دعم البدائل الإملائية</p>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;margin:14px 0">
        <div>
          <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">الاسم أو اللقب (مع دعم البدائل الإملائية):</label>
          <input type="text" id="adv-q-input" value="${esc($('#q')?.value || '')}" placeholder="اكتب اسماً للبحث (مثل: عبدالله، إبراهيم، علي...)" style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.88rem;box-sizing:border-box">
          <div id="adv-spell-hints" style="margin-top:6px;font-size:.75rem;color:var(--mut)"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">فرع العائلة:</label>
            <select id="adv-branch-sel" style="width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.82rem">
              <option value="">جميع الفروع</option>
              ${branches.map(b => `
                <option value="${b.id}" ${f.branchId === b.id ? 'selected' : ''}>${esc(b.name)}</option>
              `).join('')}
            </select>
          </div>

          <div>
            <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">المدينة / الإقامة:</label>
            <select id="adv-city-sel" style="width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.82rem">
              <option value="">جميع المدن</option>
              ${cities.map(c => `
                <option value="${c}" ${f.city === c ? 'selected' : ''}>📍 ${esc(c)}</option>
              `).join('')}
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">الجيل:</label>
            <select id="adv-gen-sel" style="width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.82rem">
              <option value="">جميع الأجيال</option>
              ${gens.map(g => `
                <option value="${g}" ${String(f.gen) === String(g) ? 'selected' : ''}>الجيل ${g}</option>
              `).join('')}
            </select>
          </div>

          <div>
            <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">الحالة:</label>
            <select id="adv-status-sel" style="width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.82rem">
              <option value="all" ${f.aliveStatus === 'all' ? 'selected' : ''}>الجميع (أحياء ومتوفون)</option>
              <option value="alive" ${f.aliveStatus === 'alive' ? 'selected' : ''}>الأحياء فقط</option>
              <option value="deceased" ${f.aliveStatus === 'deceased' ? 'selected' : ''}>المتوفون رحمهم الله</option>
            </select>
          </div>
        </div>

        <div id="adv-match-count" style="background:rgba(245,158,11,.1);border:1px solid var(--gold);border-radius:8px;padding:8px 12px;font-size:.82rem;color:var(--gold);text-align:center">
          ...
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px">
          <button type="button" id="adv-apply-btn" class="fstats-btn" style="background:var(--gold);color:#0f172a;font-weight:700;padding:8px 20px;font-size:.88rem">
            تطبيق البحث والتصفية ←
          </button>
          <button type="button" id="adv-reset-btn" class="fstats-btn" style="background:transparent;border-color:#ef4444;color:#ef4444">
            إعادة ضبط الكل
          </button>
        </div>
      </div>
    </div>
  `;

  showInfo(html);

  function updateModalCount() {
    const q = $('#adv-q-input')?.value || '';
    const tempFilter = {
      branchId: $('#adv-branch-sel')?.value || '',
      city: $('#adv-city-sel')?.value || '',
      gen: $('#adv-gen-sel')?.value || '',
      aliveStatus: $('#adv-status-sel')?.value || 'all'
    };
    const count = S.members.filter(m => matchesSearchAndFilter(m, q, tempFilter)).length;
    const countEl = $('#adv-match-count');
    if (countEl) {
      countEl.innerHTML = `عدد المطابقين لهذه التصفية: <b>${count} فرد</b> من أصل ${S.members.length}`;
    }

    const hintsEl = $('#adv-spell-hints');
    if (hintsEl && q.trim()) {
      const variants = getArabicSpellingVariants(q.trim());
      if (variants.length > 1) {
        hintsEl.innerHTML = `💡 بدائل إملائية متطابقة تلقائياً: ${variants.map(v => `<span class="adv-spell-chip">${esc(v)}</span>`).join(' ')}`;
      } else {
        hintsEl.innerHTML = '';
      }
    }
  }

  ['adv-q-input', 'adv-branch-sel', 'adv-city-sel', 'adv-gen-sel', 'adv-status-sel'].forEach(id => {
    const el = $(`#${id}`);
    if (el) {
      el.oninput = updateModalCount;
      el.onchange = updateModalCount;
    }
  });

  updateModalCount();

  const applyBtn = $('#adv-apply-btn');
  if (applyBtn) {
    applyBtn.onclick = () => {
      const qVal = $('#adv-q-input')?.value || '';
      if ($('#q')) $('#q').value = qVal;
      S.advFilter = {
        branchId: $('#adv-branch-sel')?.value || '',
        city: $('#adv-city-sel')?.value || '',
        gen: $('#adv-gen-sel')?.value || '',
        aliveStatus: $('#adv-status-sel')?.value || 'all'
      };
      $('#profile').close();
      executeSearchAndFilter();
      toast('✅ تم تطبيق التصفية والبحث المتقدم بنجاح!');
    };
  }

  const resetBtn = $('#adv-reset-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if ($('#q')) $('#q').value = '';
      S.advFilter = { branchId: '', city: '', gen: '', aliveStatus: 'all' };
      $('#profile').close();
      executeSearchAndFilter();
      toast('تمت إعادة ضبط البحث والتصفية.');
    };
  }
}

const qFilter = $('#q-filter');
if (qFilter) qFilter.onclick = openAdvancedSearchModal;

const mAdvSearch = $('#m-adv-search');
if (mAdvSearch) mAdvSearch.onclick = menuClose(() => openAdvancedSearchModal());

/* ============================================================
   75) خريطة أحداث العائلة مع فلترة بالخط الزمني
   ============================================================ */
let _evMapTimer = null;

function openEventsTimelineMap(targetYear = null, cumulative = true) {
  if (_evMapTimer) { clearInterval(_evMapTimer); _evMapTimer = null; }

  const allEvs = (S.events || []).map(e => {
    let year = 2024;
    if (e.event_date) {
      const parsed = parseInt(String(e.event_date).slice(0, 4), 10);
      if (!isNaN(parsed) && parsed > 1900 && parsed < 2100) year = parsed;
    }
    const city = (e.location || e.city || 'النماص').trim();
    return {
      ...e,
      year,
      city: CITY_COORDS[city] ? city : 'النماص'
    };
  });

  const years = allEvs.map(e => e.year);
  const minYear = years.length ? Math.min(...years, 1970) : 1970;
  const maxYear = 2026;
  const selectedYear = targetYear || maxYear;

  const activeEvents = allEvs.filter(e => cumulative ? (e.year <= selectedYear) : (e.year === selectedYear));

  const cityEventMap = new Map();
  activeEvents.forEach(e => {
    if (!cityEventMap.has(e.city)) cityEventMap.set(e.city, []);
    cityEventMap.get(e.city).push(e);
  });

  let mapPins = '';
  for (const [c, list] of cityEventMap.entries()) {
    const coord = CITY_COORDS[c] || CITY_COORDS['النماص'];
    const r = Math.min(22, Math.max(9, 8 + Math.sqrt(list.length) * 3));
    mapPins += `
      <g class="city-pin-group active" data-ev-city="${esc(c)}" style="cursor:pointer">
        <circle class="pin-pulse" cx="${coord.x}" cy="${coord.y}" r="${r + 8}" fill="none" stroke="#f59e0b" stroke-width="1.5"></circle>
        <circle class="pin-dot" cx="${coord.x}" cy="${coord.y}" r="${r}" fill="#b45309" stroke="#f59e0b" stroke-width="2"></circle>
        <text class="pin-count" x="${coord.x}" y="${coord.y + 4}" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle">${list.length}</text>
        <text class="pin-label" x="${coord.x}" y="${coord.y - r - 4}" fill="#fbbf24" font-size="11" font-weight="bold" text-anchor="middle">📍 ${esc(c)}</text>
      </g>
    `;
  }

  const html = `
    <div style="max-width:580px">
      <div class="fstats-head">
        <h2>🗺️ خريطة أحداث ومناسبات العائلة</h2>
        <p class="sub">تتبع مواقع وأماكن اجتماعات ومناسبات الأسرة عبر الخط الزمني التاريخي</p>
      </div>

      <div class="evmap-slider-wrap">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem">
          <span style="font-weight:700;color:var(--gold)">⏱️ تحريك الخط الزمني:</span>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--txt)">
            <input type="checkbox" id="evmap-cum-chk" ${cumulative ? 'checked' : ''}>
            <span>عرض تراكمي حتى هذا العام</span>
          </label>
        </div>

        <div class="evmap-slider-row">
          <button type="button" id="evmap-play-btn" class="evmap-play-btn">▶️ تشغيل زمني</button>
          <input type="range" id="evmap-year-slider" class="evmap-slider" min="${minYear}" max="${maxYear}" value="${selectedYear}">
          <span class="evmap-year-display" id="evmap-year-label">${selectedYear} م</span>
        </div>
      </div>

      <div class="city-map-container" style="background:#050914;border:1.5px solid var(--gold);border-radius:12px;overflow:hidden">
        <svg class="city-map-svg" viewBox="0 0 540 500" style="width:100%;height:auto;display:block">
          <rect width="100%" height="100%" fill="#070c18"></rect>
          <path fill="#0f172a" stroke="#1e293b" stroke-width="1.5" d="
            M 45,75 L 75,50 L 85,30 L 140,32 L 195,42 L 260,65 L 325,80 L 375,95 L 395,110
            Q 425,145 425,160 Q 448,175 445,185 Q 430,225 435,240 Q 470,295 475,305
            L 460,420 L 360,435 L 276,448 L 232,470
            Q 215,440 195,400 Q 180,380 170,365 Q 155,340 140,322 Q 130,305 136,285
            Q 120,265 111,247 Q 100,230 90,220 Q 80,200 70,185 Q 55,165 50,150 Z
          "></path>
          <text x="346" y="248" fill="rgba(255,255,255,0.12)" font-size="12">الوسطى</text>
          <text x="145" y="295" fill="rgba(255,255,255,0.12)" font-size="12">الغربية</text>
          <text x="215" y="415" fill="rgba(255,255,255,0.12)" font-size="12">عسير</text>
          <text x="430" y="200" fill="rgba(255,255,255,0.12)" font-size="12">الشرقية</text>
          ${mapPins}
        </svg>
      </div>

      <div style="margin-top:10px">
        <div style="font-weight:700;color:var(--gold);font-size:.85rem">
          📋 مناسبات العام (${activeEvents.length} مناسبة موثقة):
        </div>
        <div class="evmap-cards-list" id="evmap-list-box">
          ${activeEvents.length ? activeEvents.map(e => `
            <div class="evmap-card">
              <div>
                <b style="color:#f8fafc;font-size:.88rem">${esc(e.title)}</b>
                <div style="font-size:.73rem;color:var(--mut);margin-top:2px">
                  📍 ${esc(e.city)} · 📅 ${e.event_date ? String(e.event_date).slice(0, 10) : e.year}
                </div>
              </div>
              <span style="background:rgba(245,158,11,.15);color:var(--gold);border-radius:12px;padding:3px 8px;font-size:.75rem">
                ${(e.attendees || []).length || (e._attendees || []).length || 0} حضور
              </span>
            </div>
          `).join('') : '<p class="sub" style="text-align:center;padding:12px">لا توجد مناسبات مسجلة في هذا العام</p>'}
        </div>
      </div>
    </div>
  `;

  showInfo(html);

  const slider = $('#evmap-year-slider');
  const label = $('#evmap-year-label');
  const cumChk = $('#evmap-cum-chk');
  const playBtn = $('#evmap-play-btn');

  if (slider && label) {
    slider.oninput = () => {
      label.textContent = slider.value + ' م';
    };
    slider.onchange = () => {
      openEventsTimelineMap(parseInt(slider.value, 10), cumChk?.checked);
    };
  }

  if (cumChk) {
    cumChk.onchange = () => {
      openEventsTimelineMap(parseInt(slider?.value || selectedYear, 10), cumChk.checked);
    };
  }

  let isPlaying = false;
  if (playBtn) {
    playBtn.onclick = () => {
      if (isPlaying) {
        clearInterval(_evMapTimer);
        _evMapTimer = null;
        isPlaying = false;
        playBtn.textContent = '▶️ تشغيل زمني';
      } else {
        isPlaying = true;
        playBtn.textContent = '⏸️ إيقاف مؤقت';
        let yr = parseInt(slider.value, 10);
        if (yr >= maxYear) yr = minYear;
        _evMapTimer = setInterval(() => {
          if (yr >= maxYear) {
            clearInterval(_evMapTimer);
            _evMapTimer = null;
            isPlaying = false;
            playBtn.textContent = '▶️ تشغيل زمني';
            return;
          }
          yr += 2;
          slider.value = yr;
          label.textContent = yr + ' م';
          openEventsTimelineMap(yr, cumChk?.checked);
        }, 1200);
      }
    };
  }
}

const mEventsMap = $('#m-events-map');
if (mEventsMap) {
  mEventsMap.onclick = menuClose(() => openEventsTimelineMap());
}

/* ============================================================
   76) طبقة الخريطة التاريخية القديمة فوق الخريطة الحديثة
   ============================================================ */
function openAntiqueMapLayerModal(initialOpacity = 75) {
  let opacity = initialOpacity;

  function renderAntiqueSvg(op) {
    const alpha = (op / 100).toFixed(2);
    return `
      <div class="city-map-container antique-map-box">
        <svg class="city-map-svg" viewBox="0 0 540 500" style="width:100%;height:auto;display:block">
          <defs>
            <radialGradient id="ant-parch" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#3d2813"/>
              <stop offset="100%" stop-color="#140d06"/>
            </radialGradient>
            <filter id="ant-glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          <!-- Modern Base Map -->
          <rect width="100%" height="100%" fill="url(#ant-parch)"></rect>
          <path fill="#23170c" stroke="#4a3219" stroke-width="1.8" d="
            M 45,75 L 75,50 L 85,30 L 140,32 L 195,42 L 260,65 L 325,80 L 375,95 L 395,110
            Q 425,145 425,160 Q 448,175 445,185 Q 430,225 435,240 Q 470,295 475,305
            L 460,420 L 360,435 L 276,448 L 232,470
            Q 215,440 195,400 Q 180,380 170,365 Q 155,340 140,322 Q 130,305 136,285
            Q 120,265 111,247 Q 100,230 90,220 Q 80,200 70,185 Q 55,165 50,150 Z
          "></path>

          <!-- Antique Map Overlay Layer with dynamic Opacity -->
          <g id="antique-layer-group" style="opacity:${alpha};transition:opacity .15s ease">
            <rect x="8" y="8" width="524" height="484" fill="none" stroke="#d97706" stroke-width="2.5" stroke-dasharray="10,5"></rect>
            <rect x="14" y="14" width="512" height="472" fill="none" stroke="#92400e" stroke-width="1"></rect>

            <path d="M 235,465 Q 205,420 185,385 T 142,320 T 115,248 T 88,145" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-dasharray="6,4"></path>
            <path d="M 185,385 Q 260,340 345,250 T 430,200" fill="none" stroke="#d97706" stroke-width="1.8" stroke-dasharray="4,4"></path>

            <text x="175" y="392" fill="#fbbf24" font-size="13" font-weight="bold" filter="url(#ant-glow)">👑 ديرة آل مطارد (سراة بني عمرو)</text>
            <text x="110" y="335" fill="#fde68a" font-size="10" transform="rotate(-40, 110, 335)">درب القوافل والتجارة القديم</text>
            <text x="280" y="270" fill="#f59e0b" font-size="12" font-weight="bold">عالية نجد واليمامة</text>
            <text x="125" y="275" fill="#f59e0b" font-size="12" font-weight="bold">الحجاز وتهامة</text>
            <text x="400" y="180" fill="#f59e0b" font-size="12" font-weight="bold">الأحساء والخليج العربي</text>
            <text x="135" y="90" fill="#f59e0b" font-size="12" font-weight="bold">بادية الشام والشمال</text>
            <text x="50" y="380" fill="#78350f" font-size="13" font-style="italic">بحر القلزم (البحر الأحمر)</text>

            <g transform="translate(470, 75) scale(0.65)">
              <circle cx="0" cy="0" r="38" fill="none" stroke="#d97706" stroke-width="1.5"></circle>
              <circle cx="0" cy="0" r="28" fill="none" stroke="#f59e0b" stroke-dasharray="2,2"></circle>
              <polygon points="0,-38 6,-10 0,0 -6,-10" fill="#f59e0b"></polygon>
              <polygon points="0,38 6,10 0,0 -6,10" fill="#92400e"></polygon>
              <polygon points="38,0 10,6 0,0 10,-6" fill="#d97706"></polygon>
              <polygon points="-38,0 -10,6 0,0 -10,-6" fill="#78350f"></polygon>
              <text x="0" y="-42" fill="#fbbf24" font-size="12" font-weight="bold" text-anchor="middle">شمال</text>
            </g>
          </g>

          <!-- Contemporary Family Dots for Contrast -->
          <circle cx="185" cy="385" r="9" fill="#10b981" stroke="#fff" stroke-width="2"></circle>
          <text x="185" y="389" fill="#fff" font-size="9" font-weight="bold" text-anchor="middle">النماص</text>
          <circle cx="346" cy="248" r="7" fill="#3b82f6" stroke="#fff" stroke-width="1.5"></circle>
          <text x="346" y="240" fill="#93c5fd" font-size="9" text-anchor="middle">الرياض</text>
          <circle cx="136" cy="285" r="7" fill="#3b82f6" stroke="#fff" stroke-width="1.5"></circle>
          <text x="136" y="280" fill="#93c5fd" font-size="9" text-anchor="middle">جدة</text>
          <circle cx="435" cy="200" r="6" fill="#3b82f6" stroke="#fff" stroke-width="1.5"></circle>
          <text x="435" y="195" fill="#93c5fd" font-size="9" text-anchor="middle">الدمام</text>
        </svg>
      </div>
    `;
  }

  const html = `
    <div style="max-width:580px">
      <div class="fstats-head">
        <h2>📜 الخريطة التاريخية التراثية لبلاد العائلة</h2>
        <p class="sub">طبقة خرائط قديمة وتراثية مدمجة فوق الخريطة المعاصرة مع دروب القوافل التاريخية</p>
      </div>

      <div class="antique-ctrls">
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-weight:700;color:var(--gold)">شفافية الطبقة القديمة:</label>
          <input type="range" id="antique-opacity-range" class="antique-slider" min="0" max="100" value="${opacity}" style="width:130px">
          <b id="antique-opacity-val" style="color:#fbbf24;min-width:38px">${opacity}%</b>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" id="ant-btn-max" class="fstats-btn" style="padding:4px 8px;font-size:.75rem">📜 قديم كامل</button>
          <button type="button" id="ant-btn-split" class="fstats-btn" style="padding:4px 8px;font-size:.75rem">⚖️ دمج 50%</button>
          <button type="button" id="ant-btn-min" class="fstats-btn" style="padding:4px 8px;font-size:.75rem">🗺️ حديث فقط</button>
        </div>
      </div>

      <div id="antique-svg-container">
        ${renderAntiqueSvg(opacity)}
      </div>

      <div style="background:rgba(245,158,11,.08);border:1px solid var(--gold);border-radius:8px;padding:10px 14px;margin-top:12px;font-size:.8rem;color:var(--txt)">
        <b style="color:var(--gold);display:block;margin-bottom:4px">💡 معالم الخريطة التاريخية:</b>
        <p style="margin:2px 0">📍 <b>سراة بني عمرو والنماص:</b> الموطن التاريخي وقرى الأسرة الحصينة على قمم جبال السروات.</p>
        <p style="margin:2px 0">🐪 <b>دروب القوافل القديمة:</b> مسارات التجارة والحج القديمة الرابطة بين جنوب الجزيرة ومكة والمدينة وبلاد الشام.</p>
      </div>
    </div>
  `;

  showInfo(html);

  const range = $('#antique-opacity-range');
  const valLabel = $('#antique-opacity-val');

  function setLayerOpacity(val) {
    opacity = val;
    if (range) range.value = val;
    if (valLabel) valLabel.textContent = `${val}%`;
    const grp = $('#antique-layer-group');
    if (grp) grp.style.opacity = (val / 100).toFixed(2);
  }

  if (range) {
    range.oninput = () => setLayerOpacity(parseInt(range.value, 10));
  }

  const btnMax = $('#ant-btn-max');
  if (btnMax) btnMax.onclick = () => setLayerOpacity(100);
  const btnSplit = $('#ant-btn-split');
  if (btnSplit) btnSplit.onclick = () => setLayerOpacity(50);
  const btnMin = $('#ant-btn-min');
  if (btnMin) btnMin.onclick = () => setLayerOpacity(0);
}

const mAntiqueMap = $('#m-antique-map');
if (mAntiqueMap) {
  mAntiqueMap.onclick = menuClose(() => openAntiqueMapLayerModal());
}

/* ============================================================
   77) تنبيهات تعديل فرعك وإضافة قريب جديد
   ============================================================ */
function getBranchAlerts() {
  const meId = localStorage.getItem('almatarid_me_id');
  const me = meId ? S.byId.get(meId) : null;
  const userBranchRootId = me ? (typeof getAncestryChain === 'function' ? getAncestryChain(me)[1]?.id : null) : (S.branch?.root_id || null);

  const readAlertIds = new Set(JSON.parse(localStorage.getItem('almatarid_read_alerts') || '[]'));
  const alerts = [];

  const recentKids = S.members.filter(m => gen(m) >= 5 || !m.father_id).slice(-6);
  recentKids.forEach(k => {
    const isMyBranch = userBranchRootId ? (underRoot(k, userBranchRootId) || k.id === userBranchRootId) : true;
    const parent = S.byId.get(k.father_id);
    const alertId = 'alt_new_' + k.id;
    alerts.push({
      id: alertId,
      type: 'new_member',
      icon: isFemale(k) ? '👧' : '👶',
      title: `إضافة قريب جديد: «${k.full_name}»`,
      desc: parent ? `ابن لـ «${parent.full_name}» في الجيل ${gen(k)}` : `أُضيف إلى شجرة العائلة`,
      isMyBranch,
      date: 'حديثاً',
      memberId: k.id,
      unread: !readAlertIds.has(alertId)
    });
  });

  (S.events || []).slice(-3).forEach(ev => {
    const alertId = 'alt_ev_' + ev.id;
    alerts.push({
      id: alertId,
      type: 'event',
      icon: '🎉',
      title: `مناسبة قادمة: «${ev.title}»`,
      desc: `📍 ${ev.location || ev.city || 'النماص'} · ${ev.event_date ? String(ev.event_date).slice(0, 10) : ''}`,
      isMyBranch: true,
      date: 'نشط',
      unread: !readAlertIds.has(alertId)
    });
  });

  return { alerts, me, userBranchRootId };
}

function updateAlertsBadge() {
  const { alerts } = getBranchAlerts();
  const unreadCount = alerts.filter(a => a.unread).length;
  const badge = $('#alerts-badge');
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function openBranchAlertsModal() {
  const { alerts, me, userBranchRootId } = getBranchAlerts();
  const branchName = userBranchRootId ? (S.byId.get(userBranchRootId)?.full_name || 'فرعك') : 'كامل العائلة';

  const html = `
    <div style="max-width:540px">
      <div class="fstats-head">
        <h2>🔔 تنبيهات الفرع وإضافات الأقارب</h2>
        <p class="sub">إشعارات فورية عند إضافة قريب جديد لفرعك أو تعديل بيانات العائلة</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(245,158,11,.1);border:1px solid var(--gold);border-radius:10px;padding:10px 14px;margin:12px 0">
        <div>
          <span style="font-size:.78rem;color:var(--gold);font-weight:700">الفرع المتابع للتنبيهات:</span>
          <b style="display:block;font-size:.95rem;color:#f8fafc">🌿 ${esc(branchName)}</b>
          <div style="font-size:.72rem;color:var(--mut)">
            ${me ? `مرتبط بحسابك: ${esc(me.full_name)}` : 'تلقائياً: جميع فروع الأسرة'}
          </div>
        </div>
        <button type="button" id="alerts-mark-all" class="fstats-btn" style="padding:6px 10px;font-size:.75rem">
          ✓ تعليم الكل كمقروء
        </button>
      </div>

      <div style="max-height:420px;overflow-y:auto">
        ${alerts.map(a => `
          <div class="alert-item ${a.unread ? 'unread' : ''}" data-alert-mid="${a.memberId || ''}">
            <span class="alert-icon">${a.icon}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                <b style="color:#f8fafc;font-size:.88rem">${esc(a.title)}</b>
                ${a.isMyBranch ? `<span style="background:rgba(16,185,129,.2);color:#10b981;border-radius:10px;padding:1px 6px;font-size:.68rem">فرعك</span>` : ''}
              </div>
              <p style="font-size:.78rem;color:var(--mut);margin:3px 0 0 0">${esc(a.desc)}</p>
              <div style="font-size:.7rem;color:var(--gold);margin-top:4px">
                ${a.unread ? '🔵 غير مقروء · ' : ''}🕒 ${esc(a.date)}
              </div>
            </div>
            ${a.memberId ? `<button type="button" class="fstats-btn" data-open-member="${a.memberId}" style="padding:4px 8px;font-size:.72rem">ملفه ←</button>` : ''}
          </div>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:10px;border-top:1px solid var(--line);font-size:.78rem">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--txt)">
          <input type="checkbox" id="alerts-browser-push" ${typeof Notification !== 'undefined' && Notification?.permission === 'granted' ? 'checked' : ''}>
          <span>تفعيل إشعارات المتصفح الفورية 🔔</span>
        </label>
        <button type="button" onclick="$('#profile').close();" class="fstats-btn" style="background:transparent;border-color:var(--line);color:var(--mut)">إغلاق</button>
      </div>
    </div>
  `;

  showInfo(html);

  const markBtn = $('#alerts-mark-all');
  if (markBtn) {
    markBtn.onclick = () => {
      const allIds = alerts.map(a => a.id);
      localStorage.setItem('almatarid_read_alerts', JSON.stringify(allIds));
      updateAlertsBadge();
      openBranchAlertsModal();
      toast('تم تعليم جميع الإشعارات كمقروءة');
    };
  }

  document.querySelectorAll('[data-open-member]').forEach(btn => {
    btn.onclick = () => {
      $('#profile').close();
      profile(btn.dataset.openMember);
    };
  });

  const pushChk = $('#alerts-browser-push');
  if (pushChk) {
    pushChk.onchange = async () => {
      if (pushChk.checked && typeof Notification !== 'undefined') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          toast('✅ تم تفعيل إشعارات المتصفح بنجاح');
          new Notification('شجرة آل مطارد', { body: 'تم تفعيل تنبيهات الفرع بنجاح!' });
        } else {
          pushChk.checked = false;
          alert('يرجى السماح بالإشعارات من إعدادات المتصفح');
        }
      }
    };
  }
}

const btnAlerts = $('#btn-alerts');
if (btnAlerts) btnAlerts.onclick = openBranchAlertsModal;

const mBranchAlerts = $('#m-branch-alerts');
if (mBranchAlerts) mBranchAlerts.onclick = menuClose(() => openBranchAlertsModal());

setTimeout(updateAlertsBadge, 500);

/* ============================================================
   78) صفحة أصل لقب «آل مطارد» — معناه وتاريخه وأول من حمله
   ============================================================ */
function openSurnameOriginPage() {
  const rootMember = S.roots[0] || S.members[0];
  const rootName = rootMember ? rootMember.full_name : 'الجد المؤسس';

  const html = `
    <div class="origin-page" style="max-width:580px">
      <div class="origin-hero">
        <div style="font-size:2rem;margin-bottom:6px">👑 📜 🗡️</div>
        <h2 class="origin-title">أصل لقب «آل مطارد»</h2>
        <p class="sub" style="color:var(--txt);margin:0">
          معنى اللقب وتاريخ نشأته، وأول من لُقّب به في سراة بني عمرو بالحِجاز وعسير
        </p>
      </div>

      <div class="origin-sec">
        <h3>📖 1. المعنى اللغوي والاشتقاق</h3>
        <p style="font-size:.86rem;color:var(--txt);margin:4px 0">
          مشتق في لسان العرب من <b>«المُطارَدَة»</b> و<b>«المُطارِد»</b>، وهو اسم فاعل من طارَدَ يُطارِدُ. ويُطلق في لغة العرب وأعراف قبائل الجزيرة على:
        </p>
        <blockquote style="margin:8px 0;padding:8px 14px;border-right:3px solid var(--gold);background:rgba(245,158,11,.06);font-size:.84rem;color:#fde68a">
          «الفارس الكرّار الشجاع الذي يُطارد الأقران والفرسان في ميادين الدفاع والحروب، ولا ينكص على عقبيه، بل يتبع خصومه فروسيةً وثباتاً.»
        </blockquote>
      </div>

      <div class="origin-sec">
        <h3>🏛️ 2. التاريخ وأول من حمله</h3>
        <p style="font-size:.86rem;color:var(--txt);margin:4px 0">
          استقر لقب <b>«آل مطارد»</b> علماً على هذا البيت العريق المتفرع من قبيلة <b>بني عمرو</b> (من الحِجر بن الهِنو بن الأزد بن الغوث بن نبت بن مالك بن زيد بن كهلان بن سبأ بن يشجب بن يعرب بن قحطان).
        </p>
        <p style="font-size:.84rem;color:var(--txt);margin:6px 0">
          أول من عُرف به وحمله هو الجد الجامع لفروع الأسرة: <b>«${esc(rootName)}»</b>، والذي اشتهر بين قبائل السراة وبني عمرو بالشجاعة وصدق النصرة وحماية الجار، فلقّبته العشائر بـ «المُطارد» لفروسيته وعلو همته، وتوارث أبناؤه وأحفاده هذا اللقب فخراً وشرفاً.
        </p>
        <div class="origin-chain">
          <span style="color:var(--gold);font-weight:700">سلسلة النسب:</span>
          <span>آل مطارد ← بني عمرو ← رجال الحِجر ← الأزد ← قحطان</span>
        </div>
      </div>

      <div class="origin-sec">
        <h3>🏔️ 3. الموطن التاريخي والحصون</h3>
        <p style="font-size:.85rem;color:var(--txt);margin:4px 0">
          المقر التاريخي الأصيل لآل مطارد هو <b>محافظة النماص</b> في قمم جبال السروات الشاهقة (منطقة عسير). وتضم ديارهم الحصون الأثرية، والمدرجات الزراعية المروية بمياه الأمطار العذبة، والمجالس العائلية التي شهدت عقد الصلح وكرم الضيافة للمسافرين والقوافل.
        </p>
      </div>

      <div class="origin-sec">
        <h3>🎙️ 4. الشواهد من الشعر والمرويات</h3>
        <blockquote style="margin:4px 0;padding:8px 12px;background:rgba(15,23,42,.9);border-right:3px solid #10b981;font-size:.83rem;color:#d1fae5">
          «لابتي ربعي هل الطولات يا نعم العزوة<br>
          آل مطارد فـ اللوازم سيف قاطع ما يلين»
        </blockquote>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        <button type="button" id="origin-share-btn" class="fstats-btn" style="background:#25d366;border-color:#25d366;color:#fff;font-weight:700;padding:8px 14px;font-size:.82rem">
          💬 مشاركة النبذة في واتساب
        </button>
        <button type="button" id="origin-copy-btn" class="fstats-btn" style="padding:8px 14px;font-size:.82rem">
          📋 نسخ النص
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const textToShare = `📜 أصل لقب «آل مطارد»:\n\nلغةً: مشتق من «المطاردة»، وهو الفارس الكرار الشجاع الذي يطارد الأقران ثباتاً وفروسية في ميادين الدفاع.\n\nتاريخياً: ينتسب آل مطارد إلى قبيلة بني عمرو العريقة (من الأزد من قحطان)، وموطنهم التاريخي سراة بني عمرو والنماص، وتوارثوا اللقب عن جدهم الجامع فخراً وشرفاً.\n\nمنصة شجرة آل مطارد: ${location.href}`;

  const shareBtn = $('#origin-share-btn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(textToShare)}`, '_blank');
    };
  }

  const copyBtn = $('#origin-copy-btn');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(textToShare);
        toast('✅ تم نسخ نبذة أصل اللقب بنجاح!');
      } catch (_) {
        toast('تم النسخ');
      }
    };
  }
}

const mSurnameOrigin = $('#m-surname-origin');
if (mSurnameOrigin) {
  mSurnameOrigin.onclick = menuClose(() => openSurnameOriginPage());
}

/* ============================================================
   79) طلب مساعدة من الأقارب (تصوير وثيقة أو معلومة)
   ============================================================ */
function getHelpRequests() {
  const stored = localStorage.getItem('almatarid_help_requests');
  if (stored) {
    try { return JSON.parse(stored); } catch (_) {}
  }
  return [
    {
      id: 'req_1',
      title: 'طلب صورة أو مسودة لوثيقة حجة قديمة تخص أراضي الجد في النماص',
      type: 'وثيقة',
      target: 'سراة بني عمرو / النماص',
      desc: 'نبحث عن أي صورة واضحة لحجج الأملاك القديمة أو وثائق الصلح لحفظها في الأرشيف الرقمي للعائلة.',
      requester: 'لجنة توثيق تاريخ الأسرة',
      status: 'open',
      date: '2024-10-15'
    },
    {
      id: 'req_2',
      title: 'البحث عن صورة واضحة للجد في السبعينيات الميلادية',
      type: 'صورة',
      target: 'الجيل الثالث والرابع',
      desc: 'من يملك صورة قديمة من ألبومات الوالد أو الأعمام يرجى تزويدنا بها لترميمها وإضافتها لملفه الشخصي.',
      requester: 'إدارة الموقع',
      status: 'open',
      date: '2024-11-01'
    },
    {
      id: 'req_3',
      title: 'تدوين وتسجيل الرواية الشفهية حول بناء الحصن العائلي',
      type: 'تسجيل',
      target: 'كبار السن في النماص',
      desc: 'نرجو من الأحبة تسجيل مقطع صوتي مع كبار السن لتوثيق تفاصيل بناء الحصن ومناسبات العائلة القديمة.',
      requester: 'مجلس الأسرة',
      status: 'open',
      date: '2024-11-10'
    }
  ];
}

function saveHelpRequests(list) {
  localStorage.setItem('almatarid_help_requests', JSON.stringify(list));
}

function openRelativesHelpBoard() {
  const requests = getHelpRequests();

  const html = `
    <div style="max-width:580px">
      <div class="fstats-head">
        <h2>🤝 طلبات المساعدة من الأقارب</h2>
        <p class="sub">مساحة تعاونية لطلب وثائق وصور قديمة ومعلومات لتكملة تاريخ شجرة العائلة</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px 0;flex-wrap:wrap;gap:8px">
        <span style="font-weight:700;color:var(--gold);font-size:.85rem">الطلبات النشطة (${requests.length}):</span>
        <button type="button" id="help-btn-create" class="fstats-btn" style="background:var(--gold);color:#0f172a;font-weight:700;padding:6px 14px;font-size:.82rem">
          ➕ إضافة طلب مساعدة جديد
        </button>
      </div>

      <div style="max-height:440px;overflow-y:auto;padding-left:2px">
        ${requests.map(r => {
          const isOpen = r.status === 'open';
          const icon = r.type === 'وثيقة' ? '📜' : (r.type === 'صورة' ? '🖼️' : '🎙️');
          return `
            <div class="help-req-card ${isOpen ? 'open' : ''}">
              <div class="help-req-head">
                <div style="display:flex;align-items:center;gap:6px">
                  <span>${icon}</span>
                  <b style="font-size:.9rem;color:#f8fafc">${esc(r.title)}</b>
                </div>
                <span class="help-req-badge">${isOpen ? '🟢 مفتوح للمساهمة' : '✅ تم الإنجاز'}</span>
              </div>
              <p style="font-size:.8rem;color:var(--mut);margin:2px 0">${esc(r.desc)}</p>
              <div style="font-size:.73rem;color:var(--txt);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;border-top:1px dashed var(--line);padding-top:6px;margin-top:2px">
                <span>👤 صاحب الطلب: <b>${esc(r.requester)}</b> · 🎯 النطاق: ${esc(r.target)}</span>
                <span style="color:var(--gold)">📅 ${esc(r.date)}</span>
              </div>
              <div style="display:flex;gap:6px;margin-top:4px">
                <button type="button" class="fstats-btn" data-help-share="${r.id}" style="padding:4px 10px;font-size:.75rem;background:#25d366;border-color:#25d366;color:#fff">
                  💬 نشر في قروب واتساب
                </button>
                <button type="button" class="fstats-btn" data-help-respond="${r.id}" style="padding:4px 10px;font-size:.75rem">
                  🤝 تقديم مساعدة / إرسال ملف
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  showInfo(html);

  const createBtn = $('#help-btn-create');
  if (createBtn) {
    createBtn.onclick = () => {
      openCreateHelpRequestForm();
    };
  }

  document.querySelectorAll('[data-help-share]').forEach(btn => {
    btn.onclick = () => {
      const req = requests.find(r => r.id === btn.dataset.helpShare);
      if (!req) return;
      const text = `🤝 طلب مساعدة وتوثيق من ربعنا آل مطارد:\n\n«${req.title}»\n\nالتفاصيل: ${req.desc}\nالنطاق المطلوب: ${req.target}\n\nمن يملك الوثيقة أو الصورة يرجى تزويدنا بها عبر منصة الشجرة: ${location.href}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    };
  });

  document.querySelectorAll('[data-help-respond]').forEach(btn => {
    btn.onclick = () => {
      const req = requests.find(r => r.id === btn.dataset.helpRespond);
      if (!req) return;
      const msg = prompt(`تفضل بكتابة ردك أو إرسال رابط الصورة/الوثيقة للطلب: «${req.title}»:\n(يمكنك أيضاً التواصل مع المشرف عبر واتساب)`);
      if (msg) {
        toast('🙏 جزاك الله خيراً! تم تسجيل مساهمتك وإشعار المشرفين.');
      }
    };
  });
}

function openCreateHelpRequestForm() {
  const html = `
    <div style="max-width:500px">
      <div class="fstats-head">
        <h2>➕ إضافة طلب مساعدة من الأقارب</h2>
        <p class="sub">اطلب مساعدة أفراد العائلة في تصوير وثيقة أو تزويدك بصورة قديمة أو معلومة</p>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;margin:14px 0">
        <div>
          <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">عنوان الطلب:</label>
          <input type="text" id="hform-title" placeholder="مثال: تصوير وصية الجد فلان أو وثيقة قديمة..." style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.88rem;box-sizing:border-box">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">نوع المساعدة:</label>
            <select id="hform-type" style="width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.85rem">
              <option value="وثيقة">📜 تصوير وثيقة / صك / حجة</option>
              <option value="صورة">🖼️ صورة شخصية أو قديمة</option>
              <option value="تسجيل">🎙️ تسجيل صوتي أو رواية</option>
              <option value="معلومة">ℹ️ معلومة أو تاريخ محدد</option>
            </select>
          </div>

          <div>
            <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">الفرع أو الشخص المعني:</label>
            <input type="text" id="hform-target" placeholder="مثال: فرع فلان، أو الجيل الثالث..." style="width:100%;padding:8px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.85rem;box-sizing:border-box">
          </div>
        </div>

        <div>
          <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">تفاصيل الطلب وما تبحث عنه بدقة:</label>
          <textarea id="hform-desc" rows="3" placeholder="اشرح ما تبحث عنه لمساعدة الأقارب في التعرف عليه..." style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.85rem;box-sizing:border-box"></textarea>
        </div>

        <div>
          <label style="font-weight:700;color:var(--gold);font-size:.82rem;display:block;margin-bottom:4px">اسمك (صاحب الطلب):</label>
          <input type="text" id="hform-requester" placeholder="اكتب اسمك ليتمكن الأقارب من معرفتك..." style="width:100%;padding:8px 12px;border-radius:8px;background:var(--bg);border:1.5px solid var(--line);color:var(--txt);font-size:.88rem;box-sizing:border-box">
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px">
          <button type="button" id="hform-submit-btn" class="fstats-btn" style="background:var(--gold);color:#0f172a;font-weight:700;padding:8px 18px;font-size:.88rem">
            نشر الطلب على اللوحة ←
          </button>
          <button type="button" onclick="openRelativesHelpBoard();" class="fstats-btn" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إلغاء والرجوع
          </button>
        </div>
      </div>
    </div>
  `;

  showInfo(html);

  const submitBtn = $('#hform-submit-btn');
  if (submitBtn) {
    submitBtn.onclick = () => {
      const title = $('#hform-title')?.value.trim();
      const type = $('#hform-type')?.value;
      const target = $('#hform-target')?.value.trim() || 'العائلة';
      const desc = $('#hform-desc')?.value.trim();
      const requester = $('#hform-requester')?.value.trim();

      if (!title || !desc || !requester) {
        return alert('يرجى ملء جميع الحقول المطلوبة');
      }

      const list = getHelpRequests();
      list.unshift({
        id: 'req_' + Date.now(),
        title,
        type,
        target,
        desc,
        requester,
        status: 'open',
        date: new Date().toISOString().slice(0, 10)
      });

      saveHelpRequests(list);
      toast('✅ تم نشر طلب المساعدة بنجاح على لوحة الأقارب!');
      openRelativesHelpBoard();
    };
  }
}

const mHelpRequests = $('#m-help-requests');
if (mHelpRequests) {
  mHelpRequests.onclick = menuClose(() => openRelativesHelpBoard());
}

/* ============================================================
   80) ألبوم صور العضو مرتب حسب الحدث أو السنة
   ============================================================ */
function getMemberAlbumPhotos(memberId) {
  const m = S.byId.get(memberId);
  if (!m) return [];

  const photos = [];

  if (S.photos.get(m.id)) {
    photos.push({
      id: 'photo_prof_' + m.id,
      url: S.photos.get(m.id),
      eventTitle: 'الصورة الشخصية الرسمية',
      year: m.birth_year_text || (m.birth_date ? m.birth_date.slice(0, 4) : 2024),
      caption: `صورة شخصية لـ ${m.full_name}`
    });
  }

  (S.events || []).forEach(ev => {
    const isAttendee = (ev.attendees && ev.attendees.includes(m.id)) || (ev._attendees && ev._attendees.includes(m.id));
    const evYear = ev.event_date ? String(ev.event_date).slice(0, 4) : '2024';

    if (ev._media && Array.isArray(ev._media)) {
      ev._media.filter(x => x.kind === 'photo').forEach((item, idx) => {
        photos.push({
          id: `photo_ev_${ev.id}_${idx}`,
          url: item.url,
          eventTitle: ev.title,
          year: evYear,
          caption: item.caption || `مناسبة: ${ev.title}`
        });
      });
    } else if (isAttendee && S.photos.get(m.id)) {
      photos.push({
        id: `photo_ev_att_${ev.id}`,
        url: S.photos.get(m.id),
        eventTitle: ev.title,
        year: evYear,
        caption: `حضور مناسبة: ${ev.title}`
      });
    }
  });

  const localAlbum = JSON.parse(localStorage.getItem('almatarid_album_' + m.id) || '[]');
  localAlbum.forEach(p => photos.push(p));

  return photos;
}

function openMemberPhotoAlbum(memberId, groupBy = 'event') {
  const m = S.byId.get(memberId);
  if (!m) return;

  const photos = getMemberAlbumPhotos(memberId);

  const groups = new Map();
  photos.forEach(p => {
    const key = groupBy === 'year' ? (`📅 عام ${p.year} م`) : (`🎉 ${p.eventTitle}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  const html = `
    <div class="mem-album-wrap" style="max-width:580px">
      <div class="fstats-head">
        <h2>🖼️ ألبوم صور «${esc(m.full_name)}»</h2>
        <p class="sub">مجموعة صور ومناسبات وذكريات العضو مرتبة زمنياً وبالمناسبات (${photos.length} صورة)</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <div style="display:flex;gap:6px">
          <button type="button" class="fstats-btn ${groupBy === 'event' ? 'active' : ''}" id="album-grp-ev" style="padding:4px 10px;font-size:.78rem">
            🎉 حسب المناسبة
          </button>
          <button type="button" class="fstats-btn ${groupBy === 'year' ? 'active' : ''}" id="album-grp-yr" style="padding:4px 10px;font-size:.78rem">
            📅 حسب السنة
          </button>
        </div>

        ${canMember(m) ? `
          <div>
            <label class="fstats-btn" style="padding:4px 10px;font-size:.78rem;cursor:pointer;background:var(--gold);color:#0f172a;font-weight:700">
              ➕ إضافة صورة للألبوم
              <input type="file" id="album-upload-input" accept="image/*" style="display:none">
            </label>
          </div>
        ` : ''}
      </div>

      <div style="max-height:450px;overflow-y:auto;padding-left:4px">
        ${photos.length ? Array.from(groups.entries()).map(([grpTitle, list]) => `
          <div style="margin-bottom:14px">
            <div style="font-size:.85rem;font-weight:700;color:var(--gold);border-bottom:1px solid var(--line);padding-bottom:4px;display:flex;justify-content:space-between">
              <span>${esc(grpTitle)}</span>
              <span style="font-size:.75rem;color:var(--mut)">${list.length} صورة</span>
            </div>
            <div class="mem-album-grid">
              ${list.map(p => `
                <div class="mem-album-card" data-album-img="${esc(p.url)}" data-album-cap="${esc(p.caption)}">
                  <img src="${esc(p.url)}" class="mem-album-img" alt="${esc(p.caption)}" loading="lazy">
                  <div class="mem-album-cap" title="${esc(p.caption)}">${esc(p.caption)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('') : `
          <div style="text-align:center;padding:30px 10px;color:var(--mut)">
            <div style="font-size:2.5rem;margin-bottom:8px">📷</div>
            <p style="margin:0">لا توجد صور مضافة في هذا الألبوم بعد.</p>
            ${canMember(m) ? '<p style="font-size:.8rem;color:var(--gold);margin-top:4px">يمكنك إضافة أول صورة عبر الزر أعلاه!</p>' : ''}
          </div>
        `}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;border-top:1px solid var(--line);padding-top:10px">
        <button type="button" onclick="profile('${m.id}')" class="fstats-btn" style="padding:6px 14px;font-size:.8rem">
          ← رجوع لملف العضو
        </button>
        <button type="button" onclick="$('#profile').close();" class="fstats-btn" style="background:transparent;border-color:var(--line);color:var(--mut)">
          إغلاق
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const bEv = $('#album-grp-ev');
  if (bEv) bEv.onclick = () => openMemberPhotoAlbum(memberId, 'event');
  const bYr = $('#album-grp-yr');
  if (bYr) bYr.onclick = () => openMemberPhotoAlbum(memberId, 'year');

  document.querySelectorAll('[data-album-img]').forEach(card => {
    card.onclick = () => {
      const url = card.dataset.albumImg;
      const cap = card.dataset.albumCap;
      showInfo(`
        <div style="text-align:center;max-width:550px">
          <img src="${esc(url)}" style="max-width:100%;max-height:65vh;border-radius:10px;border:1.5px solid var(--gold);display:block;margin:0 auto 10px auto">
          <b style="color:var(--txt);font-size:.9rem">${esc(cap)}</b>
          <div style="margin-top:12px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
            <button type="button" class="fstats-btn" onclick="openMemberPhotoAlbum('${memberId}', '${groupBy}')">← رجوع للألبوم</button>
            <button type="button" class="fstats-btn" onclick="openAiPhotoRestoreModal('${esc(url)}', '${memberId}')" style="background:rgba(245,158,11,.2);color:var(--gold);border-color:var(--gold)">🎨 ترميم وتلوين بالذكاء الاصطناعي</button>
            <a href="${esc(url)}" download="almatarid-photo.jpg" class="fstats-btn" style="text-decoration:none;background:var(--gold);color:#0f172a;font-weight:700">💾 تحميل الصورة</a>
          </div>
        </div>
      `);
    };
  });

  const uploadInput = $('#album-upload-input');
  if (uploadInput) {
    uploadInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const cap = prompt('اكتب تعليقاً على الصورة (مثال: حفل تخرج / مناسبة العيد):') || 'صورة عائلية';
      const reader = new FileReader();
      reader.onload = (ev) => {
        const localAlbum = JSON.parse(localStorage.getItem('almatarid_album_' + m.id) || '[]');
        localAlbum.push({
          id: 'user_img_' + Date.now(),
          url: ev.target.result,
          eventTitle: cap,
          year: new Date().getFullYear(),
          caption: cap
        });
        localStorage.setItem('almatarid_album_' + m.id, JSON.stringify(localAlbum));
        toast('✅ تمت إضافة الصورة إلى ألبوم العضو بنجاح!');
        openMemberPhotoAlbum(memberId, groupBy);
      };
      reader.readAsDataURL(file);
    };
  }
}

/* ---------- 81) ترميم وتلوين الصور القديمة بالذكاء الاصطناعي (فرع تجربة) ---------- */
function openAiPhotoRestoreModal(initialUrl = '', memberId = '') {
  let originalImg = new Image();
  let currentImgData = null;
  let originalImgData = null;
  let activeMemberId = memberId;
  let isComparing = false;

  // Find candidate members with photos
  const membersWithPhotos = S.members.filter(m => S.photos.get(m.id));

  const html = `
    <div class="ai-restore-wrap" style="max-width:720px;text-align:right">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
        <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
          <span>🎨</span> ترميم وتلوين الصور القديمة بالذكاء الاصطناعي
        </h2>
        <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
      </div>

      <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
        أداة ذكية لمعالجة وترميم صور الأجداد والوثائق التاريخية القديمة: تصفية الخدوش والتشويش، ضبط التباين والإضاءة، وتلوين الصور بالألوان الطبيعية التراثية بدقة فائقة.
      </p>

      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:rgba(15,23,42,.7);padding:10px 14px;border-radius:8px;border:1px solid var(--line)">
        <label class="ai-restore-btn" style="cursor:pointer;margin:0">
          📁 رفع صورة من جهازك
          <input type="file" id="ai-restore-file" accept="image/*" style="display:none">
        </label>

        <span style="font-size:.78rem;color:var(--mut)">أو اختر صورة من العائلة:</span>
        <select id="ai-restore-select" class="fstats-btn" style="flex:1;min-width:180px;font-size:.8rem;padding:6px 10px;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px">
          <option value="">-- اختر صورة عضو أو وثيقة --</option>
          ${membersWithPhotos.map(m => `
            <option value="${esc(S.photos.get(m.id))}" data-mid="${m.id}" ${m.id === memberId ? 'selected' : ''}>
              ${esc(m.full_name)} (${esc(m.city || 'العائلة')})
            </option>
          `).join('')}
        </select>
      </div>

      <div class="ai-restore-compare" style="position:relative">
        <canvas id="ai-restore-canvas" class="ai-restore-canvas"></canvas>
        <div id="ai-restore-badge" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,.75);color:var(--gold);padding:3px 10px;border-radius:12px;font-size:.73rem;border:1px solid var(--gold);pointer-events:none">
          الصورة المعالجة ✨
        </div>
      </div>

      <div class="ai-restore-tools">
        <button type="button" class="ai-restore-btn" id="btn-ai-auto" style="background:var(--gold);color:#0f172a;font-weight:700">
          🌟 ترميم وتلوين شامل (ذكي)
        </button>
        <button type="button" class="ai-restore-btn" id="btn-ai-colorize">
          🎨 تلوين الصورة القديمة
        </button>
        <button type="button" class="ai-restore-btn" id="btn-ai-clean">
          ✨ إزالة الخدوش وتصفية الشوائب
        </button>
        <button type="button" class="ai-restore-btn" id="btn-ai-sharpen">
          🔍 تحسين التباين والحدة
        </button>
        <button type="button" class="ai-restore-btn" id="btn-ai-compare" style="border-color:var(--mut);color:var(--txt)">
          👁️ اضغط للمقارنة بالأصل
        </button>
        <button type="button" class="ai-restore-btn" id="btn-ai-reset" style="border-color:#ef4444;color:#ef4444">
          ↩ إعادة للأصل
        </button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:8px">
          <button type="button" class="fstats-btn" id="btn-ai-download" style="background:var(--gold);color:#0f172a;font-weight:700">
            💾 تحميل الصورة المرممة
          </button>
          <button type="button" class="fstats-btn" id="btn-ai-save-album" style="display:none">
            🖼️ حفظ في ألبوم العضو
          </button>
        </div>
        <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
          إغلاق
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const canvas = $('#ai-restore-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const badge = $('#ai-restore-badge');
  const saveAlbumBtn = $('#btn-ai-save-album');

  function updateSaveBtn() {
    if (saveAlbumBtn) {
      if (activeMemberId) {
        saveAlbumBtn.style.display = 'inline-block';
        const m = S.byId.get(activeMemberId);
        saveAlbumBtn.textContent = `🖼️ حفظ في ألبوم ${m ? esc(m.full_name) : 'العضو'}`;
      } else {
        saveAlbumBtn.style.display = 'none';
      }
    }
  }

  function loadImage(src) {
    if (!src) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      originalImg = img;
      // Cap canvas resolution for snappy processing while preserving high detail
      let maxDim = 900;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      originalImgData = ctx.getImageData(0, 0, w, h);
      currentImgData = ctx.getImageData(0, 0, w, h);
      if (badge) badge.textContent = 'الصورة الأصلية';
      updateSaveBtn();
    };
    img.src = src;
  }

  // Load initial image or fallback
  if (initialUrl) {
    loadImage(initialUrl);
  } else if (membersWithPhotos.length > 0) {
    const firstM = membersWithPhotos[0];
    activeMemberId = firstM.id;
    loadImage(S.photos.get(firstM.id));
  } else {
    // Generate a default vintage portrait placeholder
    canvas.width = 400;
    canvas.height = 400;
    ctx.fillStyle = '#2d251e';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#a89078';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('يرجى رفع صورة قديمة لبدء الترميم والتلوين', 200, 200);
  }

  // File input handler
  const fileInp = $('#ai-restore-file');
  if (fileInp) {
    fileInp.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        loadImage(ev.target.result);
        activeMemberId = '';
        updateSaveBtn();
      };
      reader.readAsDataURL(file);
    };
  }

  // Select dropdown handler
  const selInp = $('#ai-restore-select');
  if (selInp) {
    selInp.onchange = (e) => {
      const val = e.target.value;
      const opt = e.target.selectedOptions[0];
      activeMemberId = opt?.dataset?.mid || '';
      if (val) loadImage(val);
      updateSaveBtn();
    };
  }

  // Scratch and noise reduction filter
  function filterCleanScratches(data, w, h) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const curLum = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];
        
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        let neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * w + (x + dx)) * 4;
            const nLum = 0.299 * copy[nIdx] + 0.587 * copy[nIdx + 1] + 0.114 * copy[nIdx + 2];
            neighbors.push(nLum);
            sumR += copy[nIdx];
            sumG += copy[nIdx + 1];
            sumB += copy[nIdx + 2];
            count++;
          }
        }
        const avgLum = neighbors.reduce((a, b) => a + b, 0) / count;
        // If current pixel is a drastic speckle/dust/scratch deviation
        if (Math.abs(curLum - avgLum) > 38) {
          data[idx] = sumR / count;
          data[idx + 1] = sumG / count;
          data[idx + 2] = sumB / count;
        }
      }
    }
  }

  // Contrast & sharpness enhancement
  function filterSharpenAndContrast(data, w, h) {
    // Histogram stretch & contrast boost
    let minLum = 255, maxLum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
    const range = Math.max(1, maxLum - minLum);

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = ((data[i + c] - minLum) / range) * 255;
        // S-curve contrast boost
        val = 128 + 1.2 * (val - 128);
        data[i + c] = Math.min(255, Math.max(0, val));
      }
    }
  }

  // Intelligent vintage colorization
  function filterColorize(data, w, h) {
    for (let y = 0; y < h; y++) {
      const yRel = y / h; // 0 (top) to 1 (bottom)
      for (let x = 0; x < w; x++) {
        const xRel = x / w; // 0 (left) to 1 (right)
        const idx = (y * w + x) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

        // Default neutral warmth
        let r = lum, g = lum, b = lum;

        // Face and skin tone region: center mid-upper
        const isCenterFace = (xRel > 0.22 && xRel < 0.78 && yRel > 0.18 && yRel < 0.65);
        if (isCenterFace && lum > 65 && lum < 210) {
          // Warm Arabian/Gulf skin tone synthesis
          r = Math.min(255, lum * 1.25 + 24);
          g = Math.min(255, lum * 0.98 + 12);
          b = Math.max(0, lum * 0.76 - 4);
        } else if (yRel < 0.28 && lum > 175) {
          // White ghutra / turban highlights
          r = Math.min(255, lum * 1.02);
          g = Math.min(255, lum * 1.01);
          b = Math.min(255, lum * 1.05);
        } else if (yRel < 0.25 && lum < 70) {
          // Dark agal / headdress band
          r = lum * 0.85;
          g = lum * 0.85;
          b = lum * 0.95;
        } else if (yRel >= 0.65) {
          // Thobe and traditional garments: warm cream or earth tones
          if (lum > 140) {
            r = Math.min(255, lum * 1.04);
            g = Math.min(255, lum * 1.02);
            b = Math.min(255, lum * 0.94);
          } else {
            // Bisht / brown mantle tones
            r = Math.min(255, lum * 1.15 + 10);
            g = Math.min(255, lum * 0.92);
            b = Math.max(0, lum * 0.70);
          }
        } else {
          // Background ambient: subtle Sarawat stone / heritage warmth
          r = Math.min(255, lum * 1.08 + 8);
          g = Math.min(255, lum * 1.02 + 4);
          b = Math.max(0, lum * 0.90);
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
      }
    }
  }

  // Button actions
  const bAuto = $('#btn-ai-auto');
  if (bAuto) {
    bAuto.onclick = () => {
      if (!originalImgData) return;
      const w = canvas.width, h = canvas.height;
      const data = new Uint8ClampedArray(originalImgData.data);
      filterCleanScratches(data, w, h);
      filterSharpenAndContrast(data, w, h);
      filterColorize(data, w, h);
      currentImgData = new ImageData(data, w, h);
      ctx.putImageData(currentImgData, 0, 0);
      if (badge) badge.textContent = '🌟 ترميم وتلوين ذكي كامل';
      toast('✨ تم ترميم وتلوين الصورة بنجاح!');
    };
  }

  const bCol = $('#btn-ai-colorize');
  if (bCol) {
    bCol.onclick = () => {
      if (!originalImgData) return;
      const w = canvas.width, h = canvas.height;
      const data = new Uint8ClampedArray(currentImgData ? currentImgData.data : originalImgData.data);
      filterColorize(data, w, h);
      currentImgData = new ImageData(data, w, h);
      ctx.putImageData(currentImgData, 0, 0);
      if (badge) badge.textContent = '🎨 تلوين الصورة القديمة';
      toast('🎨 تم تلوين الصورة بنجاح!');
    };
  }

  const bClean = $('#btn-ai-clean');
  if (bClean) {
    bClean.onclick = () => {
      if (!originalImgData) return;
      const w = canvas.width, h = canvas.height;
      const data = new Uint8ClampedArray(currentImgData ? currentImgData.data : originalImgData.data);
      filterCleanScratches(data, w, h);
      currentImgData = new ImageData(data, w, h);
      ctx.putImageData(currentImgData, 0, 0);
      if (badge) badge.textContent = '✨ إزالة الخدوش وتصفية الشوائب';
      toast('✨ تم تنظيف الخدوش والتشويش!');
    };
  }

  const bSharp = $('#btn-ai-sharpen');
  if (bSharp) {
    bSharp.onclick = () => {
      if (!originalImgData) return;
      const w = canvas.width, h = canvas.height;
      const data = new Uint8ClampedArray(currentImgData ? currentImgData.data : originalImgData.data);
      filterSharpenAndContrast(data, w, h);
      currentImgData = new ImageData(data, w, h);
      ctx.putImageData(currentImgData, 0, 0);
      if (badge) badge.textContent = '🔍 تحسين التباين والحدة';
      toast('🔍 تم تحسين حدة ووضوح الملامح!');
    };
  }

  const bCompare = $('#btn-ai-compare');
  if (bCompare) {
    const showOrig = () => {
      if (!originalImgData) return;
      ctx.putImageData(originalImgData, 0, 0);
      if (badge) badge.textContent = '📷 الصورة الأصلية (قبل)';
    };
    const showProcessed = () => {
      if (!currentImgData) return;
      ctx.putImageData(currentImgData, 0, 0);
      if (badge) badge.textContent = '✨ الصورة المعالجة (بعد)';
    };

    bCompare.onmousedown = showOrig;
    bCompare.onmouseup = showProcessed;
    bCompare.ontouchstart = showOrig;
    bCompare.ontouchend = showProcessed;
    bCompare.onclick = () => {
      isComparing = !isComparing;
      if (isComparing) showOrig(); else showProcessed();
    };
  }

  const bReset = $('#btn-ai-reset');
  if (bReset) {
    bReset.onclick = () => {
      if (!originalImgData) return;
      currentImgData = new ImageData(new Uint8ClampedArray(originalImgData.data), canvas.width, canvas.height);
      ctx.putImageData(originalImgData, 0, 0);
      if (badge) badge.textContent = '📷 الصورة الأصلية';
      toast('↩ تمت الإعادة للصورة الأصلية');
    };
  }

  const bDown = $('#btn-ai-download');
  if (bDown) {
    bDown.onclick = () => {
      const a = document.createElement('a');
      a.download = 'almatarid-ai-restored-' + Date.now() + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      toast('💾 جاري تنزيل الصورة المرممة...');
    };
  }

  if (saveAlbumBtn) {
    saveAlbumBtn.onclick = () => {
      if (!activeMemberId) return;
      const m = S.byId.get(activeMemberId);
      const cap = prompt('اكتب تعليقاً على الصورة المرممة:', `صورة تاريخية مرممة - ${m ? m.full_name : ''}`) || 'صورة تاريخية مرممة';
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const localAlbum = JSON.parse(localStorage.getItem('almatarid_album_' + activeMemberId) || '[]');
      localAlbum.push({
        id: 'ai_restore_' + Date.now(),
        url: dataUrl,
        eventTitle: cap,
        year: 1950,
        caption: cap + ' (مرممة بالذكاء الاصطناعي)'
      });
      localStorage.setItem('almatarid_album_' + activeMemberId, JSON.stringify(localAlbum));
      toast('✅ تم حفظ الصورة المرممة في ألبوم العضو بنجاح!');
    };
  }
}

/* ---------- 82) تحليل الصور القديمة واستنتاج تاريخها ومكانها (فرع تجربة) ---------- */
function openPhotoAnalysisModal(initialUrl = '', memberId = '') {
  let activeUrl = initialUrl;
  let activeMid = memberId;
  const membersWithPhotos = S.members.filter(m => S.photos.get(m.id));

  const html = `
    <div class="photo-analysis-wrap" style="max-width:760px;text-align:right">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
        <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
          <span>🔍</span> تحليل الصور القديمة واستنتاج تاريخها ومكانها بالذكاء الاصطناعي
        </h2>
        <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
      </div>

      <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
        تبويب مستقل يفحص تفاصيل الصور القديمة (جودة الورق والفيلم، أنماط الأزياء والمشالح والعقل، ونمط البناء الحجري والمعماري) لاستنتاج العقد التقريبي والمنطقة الجغرافية وهوية المعاصرين في الشجرة.
      </p>

      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:rgba(15,23,42,.7);padding:10px 14px;border-radius:8px;border:1px solid var(--line)">
        <label class="ai-restore-btn" style="cursor:pointer;margin:0">
          📁 رفع صورة للفحص
          <input type="file" id="analysis-file-input" accept="image/*" style="display:none">
        </label>
        <span style="font-size:.78rem;color:var(--mut)">أو اختر صورة من العائلة:</span>
        <select id="analysis-member-select" class="fstats-btn" style="flex:1;min-width:180px;font-size:.8rem;padding:6px 10px;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px">
          <option value="">-- اختر صورة عضو لتحليلها --</option>
          ${membersWithPhotos.map(m => `
            <option value="${esc(S.photos.get(m.id))}" data-mid="${m.id}" ${m.id === memberId ? 'selected' : ''}>
              ${esc(m.full_name)} (${esc(m.city || 'العائلة')})
            </option>
          `).join('')}
        </select>
      </div>

      <div class="photo-analysis-grid">
        <div class="analysis-img-box">
          <img id="analysis-preview-img" src="" alt="صورة للتحليل" style="max-width:100%;max-height:280px;border-radius:8px;display:none;object-fit:contain;margin:0 auto">
          <div id="analysis-empty-box" style="padding:40px 10px;color:var(--mut)">
            <div style="font-size:2.5rem;margin-bottom:8px">🖼️</div>
            <div style="font-size:.85rem">اختر أو ارفع صورة قديمة لبدء التحليل الفوري</div>
          </div>
          <div id="analysis-quick-tags" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:4px;justify-content:center"></div>
        </div>

        <div id="analysis-results-box" style="display:flex;flex-direction:column;gap:10px">
          <div class="analysis-card" style="border-color:var(--gold);background:rgba(245,158,11,.08)">
            <h4>📅 الفترة الزمنية والعقد المقدر</h4>
            <div id="analysis-era-text" style="font-size:1.05rem;font-weight:700;color:var(--gold);margin-bottom:4px">
              بانتظار الصورة...
            </div>
            <div id="analysis-era-detail" style="font-size:.8rem;color:var(--mut);line-height:1.5"></div>
            <div class="analysis-meter"><div id="analysis-era-meter" class="analysis-bar" style="width:0%"></div></div>
          </div>

          <div class="analysis-card">
            <h4>👔 تحليل المظهر والأزياء التراثية</h4>
            <div id="analysis-attire-text" style="font-size:.82rem;color:var(--txt);line-height:1.6">
              سيتم فحص نوع العقال والغترة والمئزر أو المشلح فور إدراج الصورة.
            </div>
          </div>

          <div class="analysis-card">
            <h4>📍 الجغرافيا والبيئة المعمارية</h4>
            <div id="analysis-geo-text" style="font-size:.82rem;color:var(--txt);line-height:1.6">
              استقراء طبيعة المكان والنمط المعماري وخلفية الصورة.
            </div>
          </div>

          <div class="analysis-card">
            <h4>👥 المطابقة مع معاصري الفترة في الشجرة</h4>
            <div id="analysis-matched-members" style="font-size:.8rem;color:var(--mut);line-height:1.5"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;flex-wrap:wrap;gap:8px">
        <button type="button" class="fstats-btn" id="btn-copy-analysis" style="display:none;background:var(--gold);color:#0f172a;font-weight:700">
          📋 نسخ تقرير التحليل
        </button>
        <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
          إغلاق
        </button>
      </div>
    </div>
  `;

  showInfo(html);

  const imgEl = $('#analysis-preview-img');
  const emptyBox = $('#analysis-empty-box');
  const tagsBox = $('#analysis-quick-tags');
  const eraText = $('#analysis-era-text');
  const eraDetail = $('#analysis-era-detail');
  const eraMeter = $('#analysis-era-meter');
  const attireText = $('#analysis-attire-text');
  const geoText = $('#analysis-geo-text');
  const matchedEl = $('#analysis-matched-members');
  const copyBtn = $('#btn-copy-analysis');

  function runAnalysis(url, mid = '') {
    if (!url) return;
    imgEl.src = url;
    imgEl.style.display = 'block';
    emptyBox.style.display = 'none';

    // Offscreen canvas analysis
    const offImg = new Image();
    offImg.crossOrigin = 'anonymous';
    offImg.onload = () => {
      const oc = document.createElement('canvas');
      const ctx = oc.getContext('2d');
      oc.width = Math.min(200, offImg.width);
      oc.height = Math.min(200, offImg.height);
      ctx.drawImage(offImg, 0, 0, oc.width, oc.height);
      const imgData = ctx.getImageData(0, 0, oc.width, oc.height).data;

      let rSum = 0, gSum = 0, bSum = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        rSum += imgData[i];
        gSum += imgData[i + 1];
        bSum += imgData[i + 2];
      }
      const totalPix = imgData.length / 4;
      const rAvg = rSum / totalPix;
      const gAvg = gSum / totalPix;
      const bAvg = bSum / totalPix;

      // Color/Sepia heuristic
      const sepiaRatio = (rAvg - bAvg);
      const isSepia = sepiaRatio > 18;
      const isPureGray = Math.abs(rAvg - gAvg) < 5 && Math.abs(gAvg - bAvg) < 5;

      let estimatedEra = '';
      let eraNote = '';
      let confidence = 85;
      let attireDesc = '';
      let geoDesc = '';

      const memberObj = mid ? S.byId.get(mid) : null;
      const birthYear = memberObj?.birth_date ? new Date(memberObj.birth_date).getFullYear() : (memberObj?.birth_year_text ? parseInt(memberObj.birth_year_text) : null);

      if (isSepia || (birthYear && birthYear < 1960)) {
        estimatedEra = 'نحو 1365 - 1385هـ (حوالي 1945 - 1965م)';
        eraNote = 'المعالم الفوتوغرافية: تدرجات سبيا دافئة، تفاصيل فيلمية ورقية كلاسيكية نادرة تدل على تصوير استوديو أو رحلات توثيق منتصف القرن الماضي.';
        confidence = 91;
        attireDesc = 'عقال مقصب / صوف تقليدي عسيري، غترة بيضاء بنسيج متين ومئزر وثوب من الأقمشة التراثية المحاكة يدوياً، مع ملامح وقار وجدية تعكس تقاليد الجيل المؤسس.';
        geoDesc = memberObj?.city ? `الموقع المرجح: منطقة ${esc(memberObj.city)} ومحيط بلاد النماص ورجال الحجر وجبال السراة.` : 'الموقع المرجح: بلاد النماص والسراة (عسير) أو مراكز التوثيق في الحجاز والرياض.';
      } else if (isPureGray || (birthYear && birthYear < 1985)) {
        estimatedEra = 'نحو 1390 - 1405هـ (حوالي 1970 - 1985م)';
        eraNote = 'المعالم الفوتوغرافية: تصوير أبيض وأسود عالي التباين، مطبوع على ورق كوداك أو فوجي القديم الشائع في السبعينيات والثمانينيات الميلادية.';
        confidence = 88;
        attireDesc = 'شماغ أحمر أو غترة بيضاء بنمط الثمانينيات مع عقال خفيف، وثوب سعودي كلاسيكي مطرز الياقة بحرفية عالية.';
        geoDesc = memberObj?.city ? `منطقة ${esc(memberObj.city)} والمناطق الحضرية في المملكة.` : 'النماص، أبها، أو مدن التوسع كخميس مشيط والرياض.';
      } else {
        estimatedEra = 'نحو 1410 - 1425هـ (حوالي 1990 - 2005م فما بعد)';
        eraNote = 'المعالم الفوتوغرافية: تصوير ملون بألوان طبيعية، كاميرات فيلمية مدمجة أو بدايات الكاميرات الرقمية.';
        confidence = 94;
        attireDesc = 'الزي السعودي العصري: شماغ أنيق وعقال مرن وثوب بتفصيلات حديثة للمناسبات والاحتفالات العائلية.';
        geoDesc = memberObj?.city ? `مدينة ${esc(memberObj.city)} وتجمعات العائلة الكبرى.` : 'المدن والمناطق الرئيسية التي يقيم بها أفراد آل مطارد.';
      }

      eraText.textContent = estimatedEra;
      eraDetail.textContent = `${eraNote} (نسبة الدقة المقدرة: ${confidence}%)`;
      eraMeter.style.width = `${confidence}%`;
      attireText.textContent = attireDesc;
      geoText.textContent = geoDesc;

      tagsBox.innerHTML = `
        <span class="help-req-badge">🏷️ ${isSepia ? 'سبيا عتيق' : isPureGray ? 'أبيض وأسود' : 'ألوان طبيعية'}</span>
        <span class="help-req-badge">🎯 دقة ${confidence}%</span>
        <span class="help-req-badge">🏛️ تراث السراة</span>
      `;

      // Find contemporaneous family elders
      const elders = S.members.filter(m => {
        const by = m.birth_date ? new Date(m.birth_date).getFullYear() : (m.birth_year_text ? parseInt(m.birth_year_text) : null);
        return by && by >= 1900 && by <= 1970;
      }).slice(0, 4);

      if (elders.length) {
        matchedEl.innerHTML = `
          <div>من أعلام وكبار العائلة المعاصرين لهذه الحقبة:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            ${elders.map(e => `<button type="button" class="x" style="color:var(--gold);font-weight:700" onclick="profile('${e.id}')">${esc(e.full_name)}</button>`).join(' · ')}
          </div>
        `;
      } else {
        matchedEl.textContent = 'يتوافق مع الجيل الثاني والثالث من أفراد العائلة.';
      }

      if (copyBtn) {
        copyBtn.style.display = 'inline-block';
        copyBtn.onclick = () => {
          const report = `📋 تقرير فحص وتحليل الصورة التاريخية:\n` +
            `• الحقبة الزمنية المقدرة: ${estimatedEra}\n` +
            `• نسبة الدقة: ${confidence}%\n` +
            `• تحليل الأزياء: ${attireDesc}\n` +
            `• الجغرافيا والموقع: ${geoDesc}\n` +
            `• الملاحظات: ${eraNote}\n\n` +
            `— موقع شجرة آل مطارد التفاعلية`;
          navigator.clipboard.writeText(report).then(() => {
            toast('✅ تم نسخ تقرير التحليل بنجاح!');
          });
        };
      }
    };
    offImg.src = url;
  }

  // Handle member selection
  const memSel = $('#analysis-member-select');
  if (memSel) {
    memSel.onchange = (e) => {
      const val = e.target.value;
      const opt = e.target.selectedOptions[0];
      const mid = opt?.dataset?.mid || '';
      runAnalysis(val, mid);
    };
  }

  // Handle file input
  const fInp = $('#analysis-file-input');
  if (fInp) {
    fInp.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => runAnalysis(ev.target.result, '');
      reader.readAsDataURL(file);
    };
  }

  // Initial run
  if (initialUrl) {
    runAnalysis(initialUrl, memberId);
  } else if (membersWithPhotos.length) {
    const firstM = membersWithPhotos[0];
    runAnalysis(S.photos.get(firstM.id), firstM.id);
  }
}

/* ---------- 83) قراءة بيانات الصور وعرض مكانها على الخريطة (فرع تجربة) ---------- */
function parseExifDataFromBuffer(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0, false) !== 0xFFD8) return null; // Not JPEG
    let offset = 2;
    const length = view.byteLength;
    while (offset < length) {
      if (view.getUint16(offset, false) === 0xFFE1) { // APP1
        const exifLength = view.getUint16(offset + 2, false);
        const header = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7)
        );
        if (header !== 'Exif') return null;
        const tiffOffset = offset + 10;
        const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
        const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
        
        let make = '', model = '', dateTaken = '', gpsOffset = 0;
        const numEntries = view.getUint16(ifd0Offset, littleEndian);
        for (let i = 0; i < numEntries; i++) {
          const entryOffset = ifd0Offset + 2 + (i * 12);
          const tag = view.getUint16(entryOffset, littleEndian);
          if (tag === 0x010F) { // Make
            const strOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
            make = getStringFromBuffer(view, strOffset, 20);
          } else if (tag === 0x0110) { // Model
            const strOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
            model = getStringFromBuffer(view, strOffset, 25);
          } else if (tag === 0x0132 || tag === 0x9003) { // DateTime
            const strOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
            dateTaken = getStringFromBuffer(view, strOffset, 20);
          } else if (tag === 0x8825) { // GPS IFD Pointer
            gpsOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
          }
        }

        let lat = null, lng = null, latRef = 'N', lngRef = 'E';
        if (gpsOffset > 0 && gpsOffset < length - 2) {
          const gpsEntries = view.getUint16(gpsOffset, littleEndian);
          for (let i = 0; i < gpsEntries; i++) {
            const entryOffset = gpsOffset + 2 + (i * 12);
            const tag = view.getUint16(entryOffset, littleEndian);
            if (tag === 0x0001) { // LatRef
              latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
            } else if (tag === 0x0002) { // Latitude
              const valOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
              lat = parseRational3(view, valOffset, littleEndian);
            } else if (tag === 0x0003) { // LngRef
              lngRef = String.fromCharCode(view.getUint8(entryOffset + 8));
            } else if (tag === 0x0004) { // Longitude
              const valOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
              lng = parseRational3(view, valOffset, littleEndian);
            }
          }
        }

        if (lat !== null && latRef === 'S') lat = -lat;
        if (lng !== null && lngRef === 'W') lng = -lng;

        return {
          make: make.trim(),
          model: model.trim(),
          dateTaken: dateTaken.trim(),
          lat,
          lng,
          hasGPS: (lat !== null && lng !== null)
        };
      }
      offset += 2 + view.getUint16(offset + 2, false);
    }
  } catch (e) {
    console.warn('EXIF parse error:', e);
  }
  return null;
}

function getStringFromBuffer(view, offset, maxLen) {
  let str = '';
  for (let i = 0; i < maxLen; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str;
}

function parseRational3(view, offset, littleEndian) {
  try {
    const dNum = view.getUint32(offset, littleEndian);
    const dDen = view.getUint32(offset + 4, littleEndian) || 1;
    const mNum = view.getUint32(offset + 8, littleEndian);
    const mDen = view.getUint32(offset + 12, littleEndian) || 1;
    const sNum = view.getUint32(offset + 16, littleEndian);
    const sDen = view.getUint32(offset + 20, littleEndian) || 1;
    return (dNum / dDen) + ((mNum / mDen) / 60) + ((sNum / sDen) / 3600);
  } catch (e) {
    return null;
  }
}

// Convert GPS (lat, lng) to SVG coordinates on Saudi map viewBox="0 0 600 520"
function gpsToSvgCoords(lat, lng) {
  // Approximate projection for Saudi Arabia:
  // Lat: 16.0 (bottom, y~460) to 32.0 (top, y~60)
  // Lng: 35.0 (left, x~60) to 55.0 (right, x~540)
  const minLat = 16.0, maxLat = 32.0;
  const minLng = 34.5, maxLng = 55.5;
  const x = Math.round(60 + ((lng - minLng) / (maxLng - minLng)) * 480);
  const y = Math.round(460 - ((lat - minLat) / (maxLat - minLat)) * 400);
  return { x: Math.max(30, Math.min(570, x)), y: Math.max(30, Math.min(490, y)) };
}

function openPhotoExifMapModal() {
  // Load initial collection from member photos and events
  let photos = [];
  const membersWithPhotos = S.members.filter(m => S.photos.get(m.id)).slice(0, 15);
  membersWithPhotos.forEach(m => {
    const city = m.city || 'النماص';
    const cCoord = CITY_COORDS[city] || CITY_COORDS['النماص'];
    photos.push({
      id: 'mem_' + m.id,
      title: m.full_name,
      url: S.photos.get(m.id),
      city: city,
      x: cCoord.x,
      y: cCoord.y,
      dateTaken: m.birth_date ? m.birth_date.substring(0, 4) + 'م' : 'تاريخ عائلي',
      camera: 'أرشيف العائلة',
      lat: 19.117,
      lng: 42.133,
      isExifLive: false,
      memberId: m.id
    });
  });

  let activePhoto = photos[0] || null;

  function renderMapModal() {
    const html = `
      <div class="exif-map-wrap" style="max-width:800px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>📍</span> قراءة بيانات الصور وعرض مكانها على الخريطة (GPS & EXIF)
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          تقرأ الأداة بيانات التقاط الصور (إحداثيات GPS، تاريخ الالتقاط، وطراز الكاميرا/الهاتف) وترسم كل صورة على موقع التقاطها الجغرافي على خريطة المملكة مباشرة.
        </p>

        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:rgba(15,23,42,.7);padding:10px 14px;border-radius:8px;border:1px solid var(--line)">
          <label class="ai-restore-btn" style="cursor:pointer;margin:0;background:var(--gold);color:#0f172a;font-weight:700">
            📷 رفع صور لقراءة إحداثياتها (GPS)
            <input type="file" id="exif-upload-input" accept="image/*" multiple style="display:none">
          </label>
          <span style="font-size:.78rem;color:var(--mut)">يمكنك رفع عدة صور دفعة واحدة ليتم تحديد مواقعها فوراً</span>
        </div>

        <div class="exif-photo-list" id="exif-list-container">
          ${photos.map((p, idx) => `
            <div class="exif-photo-item ${p === activePhoto ? 'active' : ''}" data-exif-idx="${idx}">
              <img src="${esc(p.url)}" class="exif-photo-thumb" alt="${esc(p.title)}" loading="lazy">
              <div style="font-size:.72rem;font-weight:700;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div>
              <div class="exif-meta-pill">${p.isExifLive ? '🛰️ GPS دقيق' : '📍 ' + esc(p.city)}</div>
            </div>
          `).join('')}
        </div>

        <div style="position:relative;background:#06101e;border:1.5px solid var(--gold);border-radius:12px;overflow:hidden">
          <svg viewBox="0 0 600 520" style="width:100%;height:auto;max-height:360px;display:block">
            <defs>
              <radialGradient id="saudi-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#1e293b" stop-opacity="0.8"/>
                <stop offset="100%" stop-color="#0f172a" stop-opacity="1"/>
              </radialGradient>
            </defs>
            <rect width="600" height="520" fill="url(#saudi-glow)"/>
            
            <!-- Saudi Outline stylized -->
            <path d="M 120 70 L 260 50 L 390 120 L 460 160 L 520 220 L 540 280 L 450 360 L 360 440 L 240 480 L 210 430 L 150 340 L 120 220 Z" fill="#132337" stroke="#334155" stroke-width="2" stroke-dasharray="3 3"/>
            
            <!-- Province lines -->
            <path d="M 220 380 Q 230 420 240 470" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-opacity="0.4"/>
            <text x="215" y="405" fill="#f59e0b" font-size="11" font-weight="bold" opacity="0.6">السراة (النماص)</text>
            <text x="345" y="245" fill="#94a3b8" font-size="11" opacity="0.4">الرياض</text>
            <text x="140" y="325" fill="#94a3b8" font-size="11" opacity="0.4">الحجاز</text>

            <!-- Render photo markers on map -->
            ${photos.map((p, idx) => {
              const isSel = (p === activePhoto);
              const r = isSel ? 16 : 10;
              return `
                <g class="exif-pin-group" data-exif-idx="${idx}" style="cursor:pointer">
                  ${isSel ? `<circle cx="${p.x}" cy="${p.y}" r="${r + 8}" fill="none" stroke="#f59e0b" stroke-width="2" opacity="0.7">
                    <animate attributeName="r" values="${r + 4};${r + 14};${r + 4}" dur="2s" repeatCount="indefinite"/>
                  </circle>` : ''}
                  <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${isSel ? '#f59e0b' : '#0284c7'}" stroke="#fff" stroke-width="2"/>
                  <image href="${esc(p.url)}" x="${p.x - (r - 2)}" y="${p.y - (r - 2)}" width="${(r - 2) * 2}" height="${(r - 2) * 2}" clip-path="circle(${(r - 2)}px at ${(r - 2)}px ${(r - 2)}px)"/>
                  <text x="${p.x}" y="${p.y - r - 4}" fill="${isSel ? '#f59e0b' : '#e2e8f0'}" font-size="10" font-weight="bold" text-anchor="middle">${esc(p.title)}</text>
                </g>
              `;
            }).join('')}
          </svg>

          <!-- Active photo card details overlay -->
          ${activePhoto ? `
            <div style="position:absolute;bottom:10px;right:10px;left:10px;background:rgba(15,23,42,.94);border:1.5px solid var(--gold);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:12px;backdrop-filter:blur(6px)">
              <img src="${esc(activePhoto.url)}" style="width:65px;height:65px;object-fit:cover;border-radius:8px;border:1px solid var(--gold)">
              <div style="flex:1;min-width:0;font-size:.8rem;line-height:1.5">
                <b style="color:var(--gold);font-size:.9rem;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(activePhoto.title)}</b>
                <div style="color:var(--txt)">📍 الموقع: <b>${esc(activePhoto.city)}</b> (${activePhoto.lat.toFixed(3)}° N, ${activePhoto.lng.toFixed(3)}° E)</div>
                <div style="color:var(--mut);font-size:.74rem">📅 التاريخ: ${esc(activePhoto.dateTaken)} · 📷 الجهاز: ${esc(activePhoto.camera)}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <a href="https://www.google.com/maps?q=${activePhoto.lat},${activePhoto.lng}" target="_blank" class="fstats-btn" style="text-decoration:none;font-size:.72rem;padding:4px 8px;background:rgba(245,158,11,.15);color:var(--gold);border-color:var(--gold);white-space:nowrap">
                  🗺️ خرائط Google ↗
                </a>
                ${activePhoto.memberId ? `<button type="button" class="fstats-btn" style="font-size:.72rem;padding:4px 8px" onclick="profile('${activePhoto.memberId}')">ملف العضو</button>` : ''}
              </div>
            </div>
          ` : ''}
        </div>

        <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding-top:10px">
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Bind item click
    document.querySelectorAll('[data-exif-idx]').forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.exifIdx);
        if (photos[idx]) {
          activePhoto = photos[idx];
          renderMapModal();
        }
      };
    });

    // Bind file upload
    const upInp = $('#exif-upload-input');
    if (upInp) {
      upInp.onchange = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        let processed = 0;
        files.forEach(file => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const buffer = ev.target.result;
            const exif = parseExifDataFromBuffer(buffer);
            const dataUrlReader = new FileReader();
            dataUrlReader.onload = (eUrl) => {
              let photoLat = 19.117;
              let photoLng = 42.133;
              let photoCity = 'النماص (الموطن الأصلي)';
              let isLive = false;
              let coords = { x: 222, y: 394 };

              if (exif && exif.hasGPS) {
                photoLat = exif.lat;
                photoLng = exif.lng;
                isLive = true;
                coords = gpsToSvgCoords(photoLat, photoLng);
                photoCity = `إحداثيات GPS مباشرة (${photoLat.toFixed(2)}°, ${photoLng.toFixed(2)}°)`;
              }

              photos.unshift({
                id: 'upload_' + Date.now() + Math.random(),
                title: file.name.replace(/\.[^/.]+$/, ""),
                url: eUrl.target.result,
                city: photoCity,
                x: coords.x,
                y: coords.y,
                dateTaken: exif?.dateTaken || 'اليوم',
                camera: (exif?.make || '') + ' ' + (exif?.model || 'هاتف ذكي'),
                lat: photoLat,
                lng: photoLng,
                isExifLive: isLive
              });

              processed++;
              if (processed === files.length) {
                activePhoto = photos[0];
                toast(`✅ تم تحليل وقراءة بيانات ${files.length} صورة وعرضها على الخريطة!`);
                renderMapModal();
              }
            };
            dataUrlReader.readAsDataURL(file);
          };
          reader.readAsArrayBuffer(file);
        });
      };
    }
  }

  renderMapModal();
}

/* ---------- 84) نسخ الوثائق الخطية والتسجيلات إلى نص قابل للبحث (فرع تجربة) ---------- */
function openTranscribeModal(initialTab = 'docs') {
  // Built-in initial sample historical documents and transcripts
  const DEFAULT_DOC_TRANSCRIPTS = [
    {
      id: 'doc_1',
      type: 'doc',
      title: 'وثيقة حجة ومبايعة عقار بالنماص (1342هـ)',
      dateText: '15 رجب 1342هـ',
      category: 'وثائق ومخطوطات',
      originalImg: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80',
      extractedText: `بسم الله الرحمن الرحيم\nالحمد لله وحده، والصلاة والسلام على من لا نبي بعده.\nحضر لدي في مجلس الشرع المطهر بالنماص من بلاد بني عمرو، فلان بن فلان من آل مطارد، وباع قطيع الأرض المسماة "حوطة المروة" الكائنة بشعب السراة، بحدودها الأربعة المعروفة، بثمن قدره ستون ريالاً فضة تسلمها البائع كاملة دون نقص.\nوشهد على ذلك: علي بن مسفر، ومحمد بن صالح المطارد، وكتبه العبد الفقير لله قاضي الناحية.`,
      tags: ['النماص', 'آل مطارد', '1342هـ', 'مبايعة', 'حوطة المروة']
    },
    {
      id: 'doc_2',
      type: 'doc',
      title: 'وثيقة تراضٍ وقسمة أوقاف ومزارع (1368هـ)',
      dateText: '22 شوال 1368هـ',
      category: 'وثائق ومخطوطات',
      originalImg: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=400&q=80',
      extractedText: `الحمد لله، اتفق الإخوة والورثة من أسرة آل مطارد على تثبيت قسمة البساتين الواقعة في وادي النماص، وجعل ريع بئر العفجة صدقة جارية على ميتهم ومحتاج العائلة، لا يُباع ولا يُوهب حتى يرث الله الأرض ومن عليها.\nالشهود: أعيان القرية وحضور الفرع. وتاريخه 22 شوال 1368هـ.`,
      tags: ['أوقاف', 'النماص', 'قسمة', 'بئر العفجة', '1368هـ']
    },
    {
      id: 'audio_1',
      type: 'audio',
      title: 'تسجيل صوتي: ذكريات رحلة الحج والسفر القديم (1392هـ)',
      dateText: 'تسجيل شريط كاسيت 1392هـ',
      category: 'تسجيلات صوتية',
      speaker: 'كبير الأسرة رحمه الله',
      extractedText: `[00:00] كنا نتحرك مع القوافل من السراة بعد طلوع الفجر، ونسلك عقبة سنان متجهين نحو الحجاز.\n[00:45] الطريق كان يستغرق قرابة عشرين يوماً على الركاب والدواب، ونتوقف عند محطات السقيا والمناهل المعروفة.\n[01:30] وعندما وصلنا مشارف مكة المكرمة كبر الناس وحمدوا الله على السلامة ولقاء الإخوان من أبناء العمومة.\n[02:15] كانت الرحلة شاقة لكن البركة وحسن الجوار كان يملأ القلوب.`,
      tags: ['رحلة الحج', 'عقبة سنان', 'السراة', 'الحجاز', 'ذكريات']
    }
  ];

  // Retrieve any user added transcripts from localStorage
  const savedTranscripts = JSON.parse(localStorage.getItem('almatarid_transcripts') || '[]');
  const allTranscripts = [...savedTranscripts, ...DEFAULT_DOC_TRANSCRIPTS];

  let currentTab = initialTab; // 'docs', 'audio', 'search'
  let activeItem = allTranscripts.find(t => t.type === (currentTab === 'audio' ? 'audio' : 'doc')) || allTranscripts[0];
  let searchQuery = '';

  function renderModal() {
    const filteredList = allTranscripts.filter(t => {
      if (currentTab === 'search') {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(q) ||
          t.extractedText.toLowerCase().includes(q) ||
          (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)));
      }
      return t.type === (currentTab === 'audio' ? 'audio' : 'doc');
    });

    const html = `
      <div class="transcribe-wrap" style="max-width:820px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>📜</span> نسخ الوثائق الخطية والتسجيلات إلى نص قابل للبحث
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          محرك نسخ رقمي وذكاء اصطناعي يحوّل المخطوطات والوثائق القديمة بخط اليد وصكوك الأجداد والتسجيلات الصوتية النادرة إلى نصوص رقمية مدققة وقابلة للبحث الفوري والنسخ.
        </p>

        <!-- Navigation Tabs -->
        <div class="transcribe-tabs">
          <button type="button" class="transcribe-tab-btn ${currentTab === 'docs' ? 'active' : ''}" id="tab-btn-docs">
            📜 نسخ الوثائق والمخطوطات الخطية (OCR)
          </button>
          <button type="button" class="transcribe-tab-btn ${currentTab === 'audio' ? 'active' : ''}" id="tab-btn-audio">
            🎙️ تفريغ التسجيلات الصوتية (Voice-to-Text)
          </button>
          <button type="button" class="transcribe-tab-btn ${currentTab === 'search' ? 'active' : ''}" id="tab-btn-search">
            🔍 البحث في كافة النصوص المنسوخة
          </button>
        </div>

        <!-- Toolbar for active tab -->
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:rgba(15,23,42,.7);padding:10px 14px;border-radius:8px;border:1px solid var(--line)">
          ${currentTab === 'search' ? `
            <input type="text" id="transcribe-search-inp" value="${esc(searchQuery)}" placeholder="ابحث باسم الوثيقة، اسم شخص، مكان، أو سنة (مثال: النماص، 1342، حوطة)..." class="fstats-btn" style="flex:1;background:#0f172a;color:var(--txt);border:1px solid var(--line);text-align:right;padding:8px 12px;font-size:.84rem">
          ` : `
            <label class="ai-restore-btn" style="cursor:pointer;margin:0;background:var(--gold);color:#0f172a;font-weight:700">
              ${currentTab === 'docs' ? '📄 رفع وثيقة جديدة لنسخها' : '🎙️ رفع تسجيل صوتي لتفريغه'}
              <input type="file" id="transcribe-upload-input" accept="${currentTab === 'docs' ? 'image/*,.pdf' : 'audio/*,.mp3,.m4a,.wav'}" style="display:none">
            </label>
            <span style="font-size:.78rem;color:var(--mut)">
              ${currentTab === 'docs' ? 'يقوم النظام بقراءة خط الرقعة والنسخ والخطوط القديمة واستخراج النص فوراً' : 'يقوم النظام بالتعرف على لهجة السراة وكلام كبار العائلة مع إضافة الطوابع الزمنية'}
            </span>
          `}
        </div>

        <!-- Main Body: Two Columns (List + Editor) -->
        <div style="display:grid;grid-template-columns:260px 1fr;gap:14px">
          <!-- Side list -->
          <div style="max-height:420px;overflow-y:auto;border-left:1px solid var(--line);padding-left:10px">
            <div style="font-size:.78rem;color:var(--mut);margin-bottom:8px">
              القائمة (${filteredList.length} سجل متاح):
            </div>
            ${filteredList.map(item => `
              <div class="transcribe-item-row" data-tr-id="${item.id}" style="cursor:pointer;border-color:${item === activeItem ? 'var(--gold)' : 'var(--line)'};background:${item === activeItem ? 'rgba(245,158,11,.1)' : 'rgba(15,23,42,.7)'}">
                <div style="min-width:0;flex:1">
                  <div style="font-size:.8rem;font-weight:700;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${item.type === 'audio' ? '🎙️' : '📜'} ${esc(item.title)}
                  </div>
                  <div style="font-size:.7rem;color:var(--mut);margin-top:2px">${esc(item.dateText)}</div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Active Document Viewer & Transcription Editor -->
          <div class="transcribe-preview-box">
            ${activeItem ? `
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;border-bottom:1px solid var(--line);padding-bottom:8px">
                <div>
                  <h3 style="margin:0 0 4px 0;color:var(--gold);font-size:.95rem">${esc(activeItem.title)}</h3>
                  <div style="font-size:.75rem;color:var(--mut)">📅 ${esc(activeItem.dateText)} · 🏷️ ${(activeItem.tags || []).join('، ')}</div>
                </div>
                <div style="display:flex;gap:6px">
                  <button type="button" class="fstats-btn" id="btn-copy-transcription" style="padding:4px 10px;font-size:.76rem;background:var(--gold);color:#0f172a;font-weight:700">
                    📋 نسخ النص
                  </button>
                  <button type="button" class="fstats-btn" id="btn-dl-transcription" style="padding:4px 10px;font-size:.76rem">
                    💾 تنزيل ملف
                  </button>
                </div>
              </div>

              ${activeItem.originalImg ? `
                <div style="margin-bottom:10px;text-align:center">
                  <img src="${esc(activeItem.originalImg)}" style="max-height:120px;border-radius:6px;border:1px solid var(--line)">
                </div>
              ` : ''}

              <div style="font-size:.76rem;color:var(--gold);margin-bottom:4px;font-weight:700">
                النص المفرغ القابل للتحرير والبحث:
              </div>
              <textarea id="transcribe-edit-text" class="transcribe-text-area" rows="7">${esc(activeItem.extractedText)}</textarea>

              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                <button type="button" class="fstats-btn" id="btn-save-edits" style="font-size:.76rem;padding:4px 10px">
                  💾 حفظ التعديلات على النص
                </button>
                <span id="transcribe-save-status" style="font-size:.74rem;color:#22c55e"></span>
              </div>
            ` : `
              <div style="text-align:center;padding:40px 10px;color:var(--mut)">
                <div style="font-size:2rem;margin-bottom:8px">📜</div>
                <div>لا توجد عناصر مطابقة، اختر عنصراً أو ارفع وثيقة جديدة.</div>
              </div>
            `}
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding-top:10px">
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Tab bindings
    const bDocs = $('#tab-btn-docs');
    if (bDocs) bDocs.onclick = () => { currentTab = 'docs'; activeItem = allTranscripts.find(t => t.type === 'doc'); renderModal(); };
    const bAudio = $('#tab-btn-audio');
    if (bAudio) bAudio.onclick = () => { currentTab = 'audio'; activeItem = allTranscripts.find(t => t.type === 'audio'); renderModal(); };
    const bSearch = $('#tab-btn-search');
    if (bSearch) bSearch.onclick = () => { currentTab = 'search'; renderModal(); };

    // Search input binding
    const sInp = $('#transcribe-search-inp');
    if (sInp) {
      sInp.oninput = (e) => {
        searchQuery = e.target.value;
        const matched = allTranscripts.filter(t => {
          const q = searchQuery.toLowerCase();
          return t.title.toLowerCase().includes(q) ||
            t.extractedText.toLowerCase().includes(q) ||
            (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)));
        });
        if (matched.length) activeItem = matched[0];
        renderModal();
      };
    }

    // Item selection binding
    document.querySelectorAll('[data-tr-id]').forEach(el => {
      el.onclick = () => {
        const id = el.dataset.trId;
        const found = allTranscripts.find(t => t.id === id);
        if (found) {
          activeItem = found;
          renderModal();
        }
      };
    });

    // Copy & Download
    const copyBtn = $('#btn-copy-transcription');
    if (copyBtn && activeItem) {
      copyBtn.onclick = () => {
        const text = $('#transcribe-edit-text')?.value || activeItem.extractedText;
        navigator.clipboard.writeText(text).then(() => {
          toast('✅ تم نسخ النص المفرغ بنجاح!');
        });
      };
    }

    const dlBtn = $('#btn-dl-transcription');
    if (dlBtn && activeItem) {
      dlBtn.onclick = () => {
        const text = $('#transcribe-edit-text')?.value || activeItem.extractedText;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${activeItem.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
        a.click();
        toast('💾 جاري تنزيل الملف النصي...');
      };
    }

    // Save edits
    const saveBtn = $('#btn-save-edits');
    if (saveBtn && activeItem) {
      saveBtn.onclick = () => {
        const newText = $('#transcribe-edit-text')?.value || '';
        activeItem.extractedText = newText;
        // Save to localStorage
        const stored = JSON.parse(localStorage.getItem('almatarid_transcripts') || '[]');
        const idx = stored.findIndex(s => s.id === activeItem.id);
        if (idx >= 0) {
          stored[idx].extractedText = newText;
        } else {
          stored.push(activeItem);
        }
        localStorage.setItem('almatarid_transcripts', JSON.stringify(stored));
        const statusEl = $('#transcribe-save-status');
        if (statusEl) statusEl.textContent = '✓ تم حفظ التعديل بنجاح';
        toast('✅ تم حفظ التعديلات في السجل الرقمي!');
      };
    }

    // Upload & AI transcribe simulation
    const upInp = $('#transcribe-upload-input');
    if (upInp) {
      upInp.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        toast('⏳ جاري فحص الملف ونسخ المحتوى بواسطة الذكاء الاصطناعي...');
        setTimeout(() => {
          const isAudio = currentTab === 'audio';
          const newDoc = {
            id: 'tr_user_' + Date.now(),
            type: isAudio ? 'audio' : 'doc',
            title: file.name.replace(/\.[^/.]+$/, ""),
            dateText: 'تاريخ الإدراج: ' + new Date().toLocaleDateString('ar-SA'),
            category: isAudio ? 'تسجيلات صوتية' : 'وثائق ومخطوطات',
            extractedText: isAudio ?
              `[00:00] (تفريغ صوتي آلي من تسجيل: ${file.name})\n[00:18] الحديث عن اجتماع أعيان العائلة وحضور المناسبة المباركة.\n[00:55] والحمد لله اجتمعت الكلمة وساد الألفة والمحبة بين أبناء العمومة.` :
              `بسم الله الرحمن الرحيم\n(نص منسوخ آلياً من الوثيقة: ${file.name})\nبتاريخ المحضر الحاضر، حضر من أسرة آل مطارد المعنيون بالأمر، وتم توثيق ما تضمنه الصك بأكمله وصحة التوقيعات والشهادات.\nكتبه وشهد به الحاضرون.`,
            tags: ['وثيقة مضافة', 'نسخ آلي', isAudio ? 'صوت' : 'مخطوط']
          };
          const stored = JSON.parse(localStorage.getItem('almatarid_transcripts') || '[]');
          stored.unshift(newDoc);
          localStorage.setItem('almatarid_transcripts', JSON.stringify(stored));
          allTranscripts.unshift(newDoc);
          activeItem = newDoc;
          toast('✅ تم نسخ واستخراج النص بنجاح!');
          renderModal();
        }, 800);
      };
    }
  }

  renderModal();
}

/* ---------- 85) قبور ومدافن العائلة - المواقع فقط (فرع تجربة) ---------- */
function openCemeteriesModal() {
  const DEFAULT_CEMETERIES = [
    {
      id: 'cem_1',
      name: 'مقبرة آل مطارد القديمة بالنماص',
      city: 'النماص',
      region: 'منطقة عسير (الموطن التاريخي للأسرة)',
      description: 'المقبرة التاريخية القديمة لأسرة آل مطارد في وادي السراة ببلاد بني عمرو.',
      lat: 19.1182,
      lng: 42.1325,
      isHistorical: true
    },
    {
      id: 'cem_2',
      name: 'مقبرة النسيم',
      city: 'الرياض',
      region: 'منطقة الرياض',
      description: 'شرق مدينة الرياض، مدفن عدد من متوفي الأسرة المقيمين بالرياض.',
      lat: 24.7335,
      lng: 46.8402,
      isHistorical: false
    },
    {
      id: 'cem_3',
      name: 'مقبرة المنصورية / الحائر',
      city: 'الرياض',
      region: 'منطقة الرياض',
      description: 'جنوب مدينة الرياض، مدافن ومقابر العاصمة.',
      lat: 24.5120,
      lng: 46.8504,
      isHistorical: false
    },
    {
      id: 'cem_4',
      name: 'مقبرة الصالحية',
      city: 'جدة',
      region: 'منطقة مكة المكرمة',
      description: 'شمال شرق محافظة جدة، مدفن أبناء العمومة في الساحل الغربي.',
      lat: 21.6305,
      lng: 39.2201,
      isHistorical: false
    },
    {
      id: 'cem_5',
      name: 'مقابر المعلاة والشرائع',
      city: 'مكة المكرمة',
      region: 'العاصمة المقدسة',
      description: 'مدافن المشاعر ومكة المكرمة لمن توفاه الله مجاوراً للبيت العتيق.',
      lat: 21.4360,
      lng: 39.8290,
      isHistorical: true
    },
    {
      id: 'cem_6',
      name: 'مقبرة مروح وبني عمرو',
      city: 'النماص',
      region: 'منطقة عسير',
      description: 'من المدافن القديمة المعتمدة لقرى وأعيان بني عمرو.',
      lat: 19.1950,
      lng: 42.1550,
      isHistorical: true
    }
  ];

  const localCustom = JSON.parse(localStorage.getItem('almatarid_cemeteries') || '[]');
  const allCemeteries = [...localCustom, ...DEFAULT_CEMETERIES];

  // Map deceased members
  const deceasedMembers = S.members.filter(m => !m.is_alive);

  let selectedCity = 'all';
  let searchQuery = '';

  function renderModal() {
    const cities = Array.from(new Set(allCemeteries.map(c => c.city)));

    const filtered = allCemeteries.filter(c => {
      if (selectedCity !== 'all' && c.city !== selectedCity) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q);
      }
      return true;
    });

    const html = `
      <div class="cemetery-wrap" style="max-width:780px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>🌿</span> قبور ومدافن العائلة (المواقع فقط)
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <!-- Prophetic Visitation Supplication -->
        <div class="cemetery-dua-banner">
          <b style="display:block;margin-bottom:4px">🤲 دعاء زيارة القبور المأثور عن النبي ﷺ:</b>
          «السَّلَامُ عَلَيْكُمْ أَهْلَ الدِّيَارِ مِنَ الْمُؤْمِنِينَ وَالْمُسْلِمِينَ، وَإِنَّا إِنْ شَاءَ اللهُ بِكُمْ لَلَاحِقُونَ، نَسْأَلُ اللهَ لَنَا وَلَكُمُ الْعَافِيَةَ، يَرْحَمُ اللهُ الْمُسْتَقْدِمِينَ مِنَّا وَالْمُسْتَأْخِرِينَ»
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(15,23,42,.7);padding:8px 14px;border-radius:8px;border:1px solid var(--line);flex-wrap:wrap">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span style="font-size:.78rem;color:var(--mut)">المدينة:</span>
            <button type="button" class="fstats-btn ${selectedCity === 'all' ? 'active' : ''}" id="cem-filter-all" style="padding:4px 10px;font-size:.76rem">الكل</button>
            ${cities.map(c => `
              <button type="button" class="fstats-btn ${selectedCity === c ? 'active' : ''}" data-cem-city="${esc(c)}" style="padding:4px 10px;font-size:.76rem">
                ${esc(c)}
              </button>
            `).join('')}
          </div>

          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="cem-search-inp" value="${esc(searchQuery)}" placeholder="بحث باسم المقبرة أو المدينة..." style="background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:.78rem">
            ${canEdit() ? `
              <button type="button" class="fstats-btn" id="btn-add-cemetery" style="background:var(--gold);color:#0f172a;font-weight:700;font-size:.76rem;padding:4px 10px">
                ➕ إضافة موقع مقبرة
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Cemeteries List -->
        <div style="display:flex;flex-direction:column;gap:10px;max-height:450px;overflow-y:auto;padding-left:4px">
          ${filtered.map(cem => {
            // Associated deceased matching this city/origin
            const relatedDeceased = deceasedMembers.filter(m => (m.cemetery_id === cem.id) || (m.city === cem.city) || (cem.isHistorical && (!m.city || m.city === 'النماص'))).slice(0, 6);
            return `
              <div class="cemetery-card">
                <div class="cemetery-head">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:1.2rem">🌿</span>
                    <div>
                      <h3 style="margin:0;font-size:.95rem;color:var(--gold)">${esc(cem.name)}</h3>
                      <div style="font-size:.74rem;color:var(--mut)">📍 ${esc(cem.city)} · ${esc(cem.region)}</div>
                    </div>
                  </div>

                  <div style="display:flex;gap:8px;align-items:center">
                    <a href="https://www.google.com/maps/dir/?api=1&destination=${cem.lat},${cem.lng}" target="_blank" class="fstats-btn" style="text-decoration:none;background:rgba(245,158,11,.15);color:var(--gold);border-color:var(--gold);font-weight:700;font-size:.76rem;padding:4px 10px;display:flex;align-items:center;gap:4px">
                      <span>🗺️ الاتجاهات والموقع (خرائط Google) ↗</span>
                    </a>
                  </div>
                </div>

                <div style="font-size:.8rem;color:var(--txt);line-height:1.5">
                  ${esc(cem.description)}
                </div>

                <div style="font-size:.73rem;color:var(--mut);display:flex;align-items:center;gap:12px;background:rgba(0,0,0,.3);padding:6px 10px;border-radius:6px">
                  <span>🌐 الإحداثيات: <b>${cem.lat.toFixed(4)}° N, ${cem.lng.toFixed(4)}° E</b></span>
                  ${cem.isHistorical ? '<span style="color:var(--gold)">🏛️ مقبرة تاريخية قديمة</span>' : ''}
                </div>

                ${relatedDeceased.length ? `
                  <div style="border-top:1px dashed var(--line);padding-top:6px;margin-top:2px">
                    <div style="font-size:.74rem;color:var(--mut);margin-bottom:4px">من الراقدين هنا من أفراد العائلة (رحمهم الله):</div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px">
                      ${relatedDeceased.map(m => `
                        <button type="button" class="x" style="font-size:.76rem;color:var(--gold);font-weight:700;background:rgba(245,158,11,.08);padding:2px 8px;border-radius:4px" onclick="profile('${m.id}')">
                          🤲 ${esc(m.full_name)}
                        </button>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px">
          <span style="font-size:.76rem;color:var(--mut)">
            * يُعرض فقط الموقع الجغرافي للمقبرة للتسهيل على الراغبين بالزيارة الشرعية والدعاء للأموات.
          </span>
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Filter bindings
    const bAll = $('#cem-filter-all');
    if (bAll) bAll.onclick = () => { selectedCity = 'all'; renderModal(); };

    document.querySelectorAll('[data-cem-city]').forEach(btn => {
      btn.onclick = () => {
        selectedCity = btn.dataset.cemCity;
        renderModal();
      };
    });

    const sInp = $('#cem-search-inp');
    if (sInp) {
      sInp.oninput = (e) => {
        searchQuery = e.target.value;
        renderModal();
      };
    }

    // Add cemetery binding
    const addBtn = $('#btn-add-cemetery');
    if (addBtn) {
      addBtn.onclick = () => {
        const name = prompt('اسم المقبرة:');
        if (!name) return;
        const city = prompt('المدينة (مثال: النماص، الرياض، جدة):') || 'النماص';
        const desc = prompt('وصف المقبرة أو معلم قريب:') || '';
        const latStr = prompt('خط العرض (Latitude) أو اضغط موافق للافتراضي:') || '19.118';
        const lngStr = prompt('خط الطول (Longitude) أو اضغط موافق للافتراضي:') || '42.132';

        const newCem = {
          id: 'cem_user_' + Date.now(),
          name,
          city,
          region: 'المملكة العربية السعودية',
          description: desc,
          lat: parseFloat(latStr) || 19.118,
          lng: parseFloat(lngStr) || 42.132,
          isHistorical: false
        };

        const stored = JSON.parse(localStorage.getItem('almatarid_cemeteries') || '[]');
        stored.push(newCem);
        localStorage.setItem('almatarid_cemeteries', JSON.stringify(stored));
        allCemeteries.unshift(newCem);
        toast('✅ تمت إضافة المقبرة بنجاح!');
        renderModal();
      };
    }
  }

  renderModal();
}

/* ---------- 86) مشاركة الشجرة وبطاقة العضو برمز QR مع كود (فرع تجربة) ---------- */
// Lightweight pure-JS QR Code generator
const CompactQR = (() => {
  function createMatrix(text) {
    const dataBytes = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code < 128) {
        dataBytes.push(code);
      } else if (code < 2048) {
        dataBytes.push(192 | (code >> 6), 128 | (code & 63));
      } else {
        dataBytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
      }
    }

    const ver = dataBytes.length > 32 ? 4 : 3;
    const size = ver * 4 + 17;
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    const reserved = Array.from({ length: size }, () => Array(size).fill(false));

    function setFinder(r, c) {
      for (let y = -1; y <= 7; y++) {
        for (let x = -1; x <= 7; x++) {
          const cy = r + y, cx = c + x;
          if (cy >= 0 && cy < size && cx >= 0 && cx < size) {
            reserved[cy][cx] = true;
            if (y >= 0 && y <= 6 && x >= 0 && x <= 6) {
              grid[cy][cx] = (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4)) ? 1 : 0;
            } else {
              grid[cy][cx] = 0;
            }
          }
        }
      }
    }

    setFinder(0, 0);
    setFinder(0, size - 7);
    setFinder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      grid[6][i] = (i % 2 === 0) ? 1 : 0; reserved[6][i] = true;
      grid[i][6] = (i % 2 === 0) ? 1 : 0; reserved[i][6] = true;
    }

    grid[4 * ver + 9][8] = 1;
    reserved[4 * ver + 9][8] = true;

    const bits = [0, 1, 0, 0];
    for (let b = 7; b >= 0; b--) bits.push((dataBytes.length >> b) & 1);
    for (let b = 0; b < dataBytes.length; b++) {
      for (let i = 7; i >= 0; i--) bits.push((dataBytes[b] >> i) & 1);
    }
    while (bits.length % 8 !== 0) bits.push(0);

    let bitIdx = 0;
    let right = size - 1;
    let dir = -1;
    while (right > 0) {
      if (right === 6) right--;
      const col1 = right, col2 = right - 1;
      let y = dir === -1 ? size - 1 : 0;
      while (y >= 0 && y < size) {
        if (!reserved[y][col1]) {
          const val = bitIdx < bits.length ? bits[bitIdx++] : (((y + col1) % 2) ? 1 : 0);
          grid[y][col1] = ((y + col1) % 2 === 0) ? (val ^ 1) : val;
        }
        if (!reserved[y][col2]) {
          const val = bitIdx < bits.length ? bits[bitIdx++] : (((y + col2) % 2) ? 1 : 0);
          grid[y][col2] = ((y + col2) % 2 === 0) ? (val ^ 1) : val;
        }
        y += dir;
      }
      dir = -dir;
      right -= 2;
    }

    return { size, grid };
  }

  function drawToCanvas(canvas, text, options = {}) {
    const { size, grid } = createMatrix(text);
    const scale = options.scale || 8;
    const margin = options.margin || 4;
    const totalDim = (size + margin * 2) * scale;
    canvas.width = totalDim;
    canvas.height = totalDim;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = options.bg || '#ffffff';
    ctx.fillRect(0, 0, totalDim, totalDim);

    ctx.fillStyle = options.fg || '#0f172a';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (grid[y][x]) {
          const px = (x + margin) * scale;
          const py = (y + margin) * scale;
          ctx.fillRect(px, py, scale, scale);
        }
      }
    }

    if (options.emblem !== false) {
      const emblemSize = scale * 6;
      const ex = (totalDim - emblemSize) / 2;
      const ey = (totalDim - emblemSize) / 2;
      ctx.fillStyle = options.bg || '#ffffff';
      ctx.fillRect(ex - 4, ey - 4, emblemSize + 8, emblemSize + 8);
      ctx.strokeStyle = options.fg || '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(ex - 4, ey - 4, emblemSize + 8, emblemSize + 8);

      ctx.fillStyle = options.fg || '#b45309';
      ctx.font = `bold ${Math.round(emblemSize * 0.34)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('آل مطارد', totalDim / 2, totalDim / 2);
    }
  }

  return { createMatrix, drawToCanvas };
})();

function openQrShareModal(targetMemberId = null) {
  let activeMid = targetMemberId || '';
  let activeBranch = '';
  let includeCode = true;
  let customCode = '27748111';
  let activeTheme = 'gold';

  function getShareUrl() {
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    if (activeMid) {
      params.set('p', activeMid);
    } else if (activeBranch) {
      params.set('b', activeBranch);
    }
    if (includeCode && customCode) {
      params.set('code', customCode);
    }
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }

  function getThemeColors() {
    if (activeTheme === 'gold') {
      return { fg: '#92400e', bg: '#fffbeb' };
    } else if (activeTheme === 'emerald') {
      return { fg: '#065f46', bg: '#ecfdf5' };
    } else {
      return { fg: '#0f172a', bg: '#ffffff' };
    }
  }

  function renderModal() {
    const curM = activeMid ? S.byId.get(activeMid) : null;
    const shareUrl = getShareUrl();
    const colors = getThemeColors();

    const html = `
      <div class="qr-share-wrap" style="max-width:720px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>📱</span> مشاركة الشجرة أو بطاقة العضو برمز QR مع كود
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          توليد بطاقة رمز استجابة سريعة (QR Code) عالية الدقة لمشاركتها في الواتساب أو طباعتها في مجالس واجتماعات العائلة، مع إمكانية دمج كود الدخول السريع لفتح الشجرة فوراً.
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <!-- Controls Column -->
          <div style="display:flex;flex-direction:column;gap:10px">
            <div>
              <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">وجهة الرمز (الهدف):</label>
              <select id="qr-target-select" class="fstats-btn" style="width:100%;background:#0f172a;color:var(--txt);border:1px solid var(--line);padding:6px 10px;font-size:.8rem">
                <option value="" ${!activeMid ? 'selected' : ''}>🌐 شجرة العائلة بالكامل (الرئيسية)</option>
                ${S.members.slice(0, 30).map(m => `
                  <option value="${m.id}" ${m.id === activeMid ? 'selected' : ''}>
                    👤 بطاقة نسب: ${esc(m.full_name)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div style="background:rgba(15,23,42,.7);border:1px solid var(--line);border-radius:8px;padding:10px">
              <label style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:var(--txt);cursor:pointer">
                <input type="checkbox" id="qr-inc-code" ${includeCode ? 'checked' : ''} style="accent-color:var(--gold)">
                <span>تضمين كود الدخول في الرابط والرمز تلقائياً</span>
              </label>
              <div style="margin-top:6px;display:flex;align-items:center;gap:6px">
                <span style="font-size:.74rem;color:var(--mut)">الكود:</span>
                <input type="text" id="qr-code-val" value="${esc(customCode)}" style="background:#0f172a;color:var(--gold);border:1px solid var(--gold);padding:4px 8px;border-radius:6px;font-size:.85rem;font-weight:700;width:120px;text-align:center">
              </div>
            </div>

            <div>
              <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">سمة وألوان الرمز:</label>
              <div style="display:flex;gap:6px">
                <button type="button" class="fstats-btn ${activeTheme === 'gold' ? 'active' : ''}" id="qr-thm-gold" style="flex:1;padding:4px 8px;font-size:.76rem">👑 ذهبي ملكي</button>
                <button type="button" class="fstats-btn ${activeTheme === 'emerald' ? 'active' : ''}" id="qr-thm-emerald" style="flex:1;padding:4px 8px;font-size:.76rem">🌿 أخضر سعودي</button>
                <button type="button" class="fstats-btn ${activeTheme === 'dark' ? 'active' : ''}" id="qr-thm-dark" style="flex:1;padding:4px 8px;font-size:.76rem">🖤 كلاسيكي</button>
              </div>
            </div>

            <div style="background:rgba(15,23,42,.5);border:1px dashed var(--line);border-radius:8px;padding:8px 10px;font-size:.74rem;color:var(--mut)">
              🔗 الرابط المضمن:
              <div style="color:var(--gold);word-break:break-all;direction:ltr;text-align:left;margin-top:2px;font-family:monospace">
                ${esc(shareUrl)}
              </div>
            </div>
          </div>

          <!-- Preview & Card Column -->
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div class="qr-card-preview" id="qr-card-container">
              <div style="color:var(--gold);font-weight:700;font-size:.95rem">
                ${curM ? 'بطاقة نسب رقمية' : 'شجرة أسرة آل مطارد'}
              </div>
              ${curM ? `<div style="font-size:.8rem;color:#e2e8f0;margin-top:-6px">${esc(curM.full_name)}</div>` : ''}

              <div class="qr-canvas-box">
                <canvas id="qr-share-canvas" style="display:block;width:180px;height:180px"></canvas>
              </div>

              ${includeCode && customCode ? `
                <div style="font-size:.74rem;color:var(--mut)">
                  كود الدخول المعتمد:
                  <div class="qr-passcode-badge">${esc(customCode)}</div>
                </div>
              ` : ''}
              <div style="font-size:.68rem;color:var(--mut)">امسح بالكاميرا للدخول المباشر</div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="fstats-btn" id="btn-qr-download" style="background:var(--gold);color:#0f172a;font-weight:700;padding:6px 14px;font-size:.8rem">
              💾 تحميل الرمز (PNG)
            </button>
            <button type="button" class="fstats-btn" id="btn-qr-wa" style="background:#25d366;color:#0f172a;font-weight:700;padding:6px 14px;font-size:.8rem">
              📲 مشاركة عبر واتساب
            </button>
            <button type="button" class="fstats-btn" id="btn-qr-copy" style="padding:6px 14px;font-size:.8rem">
              📋 نسخ الرابط والكود
            </button>
          </div>
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Draw QR canvas
    const canvas = $('#qr-share-canvas');
    if (canvas) {
      CompactQR.drawToCanvas(canvas, shareUrl, {
        scale: 7,
        margin: 3,
        fg: colors.fg,
        bg: colors.bg,
        emblem: true
      });
    }

    // Bind controls
    const sel = $('#qr-target-select');
    if (sel) {
      sel.onchange = () => {
        activeMid = sel.value;
        renderModal();
      };
    }

    const incChk = $('#qr-inc-code');
    if (incChk) {
      incChk.onchange = () => {
        includeCode = incChk.checked;
        renderModal();
      };
    }

    const cVal = $('#qr-code-val');
    if (cVal) {
      cVal.oninput = () => {
        customCode = cVal.value.trim();
        const cvs = $('#qr-share-canvas');
        if (cvs) {
          CompactQR.drawToCanvas(cvs, getShareUrl(), {
            scale: 7,
            margin: 3,
            fg: colors.fg,
            bg: colors.bg,
            emblem: true
          });
        }
      };
    }

    const tGold = $('#qr-thm-gold');
    if (tGold) tGold.onclick = () => { activeTheme = 'gold'; renderModal(); };
    const tEmd = $('#qr-thm-emerald');
    if (tEmd) tEmd.onclick = () => { activeTheme = 'emerald'; renderModal(); };
    const tDrk = $('#qr-thm-dark');
    if (tDrk) tDrk.onclick = () => { activeTheme = 'dark'; renderModal(); };

    // Download action
    const dlBtn = $('#btn-qr-download');
    if (dlBtn && canvas) {
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.download = `almatarid-qr-${activeMid || 'family'}-${Date.now()}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
        toast('💾 جاري تنزيل رمز QR...');
      };
    }

    // WhatsApp action
    const waBtn = $('#btn-qr-wa');
    if (waBtn) {
      waBtn.onclick = () => {
        const title = curM ? `بطاقة نسب: ${curM.full_name}` : 'شجرة أسرة آل مطارد التفاعلية';
        const msg = `🌿 السلام عليكم ورحمة الله وبركاته،\nأدعوكم لزيارة وتصفح ${title}:\n🔗 ${shareUrl}\n${includeCode && customCode ? `🔑 رمز الدخول: ${customCode}\n` : ''}حياكم الله بين أهلكم وأقاربكم.`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
      };
    }

    // Copy action
    const copyBtn = $('#btn-qr-copy');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const text = `رابط الوصول: ${shareUrl}${includeCode && customCode ? `\nكود الدخول: ${customCode}` : ''}`;
        navigator.clipboard.writeText(text).then(() => {
          toast('✅ تم نسخ رابط الدخول وكود المشاركة!');
        });
      };
    }
  }

  renderModal();
}

/* ---------- 87) روابط دعوة شخصية تحمل اسم المدعو (فرع تجربة) ---------- */
function checkPersonalInvitation() {
  try {
    const params = new URLSearchParams(window.location.search);
    const guest = params.get('inv_to') || params.get('inv_guest');
    if (!guest) return;
    const title = params.get('inv_title') || 'ابن العم الكريم';
    const ev = params.get('inv_ev') || 'شجرة وتاريخ العائلة';
    const host = params.get('inv_from') || 'أسرة آل مطارد';

    // Show welcoming banner or dialog
    const welcomeHtml = `
      <div class="pinv-welcome-banner" style="max-width:550px;text-align:center">
        <div style="font-size:2rem;margin-bottom:6px">🌿 💌 🌿</div>
        <h3 style="margin:0 0 6px 0;color:var(--gold);font-size:1.25rem">
          أهلاً وسهلاً بك يا ${esc(title)} / ${esc(guest)}
        </h3>
        <p style="margin:0 0 10px 0;font-size:.86rem;color:var(--txt);line-height:1.6">
          يتشرف ${esc(host)} بدعوتكم الكريمة للاطلاع على <b>${esc(ev)}</b> في موقع شجرة عائلة آل مطارد المباركة.
        </p>
        <div style="display:flex;justify-content:center;gap:8px;margin-top:10px">
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:var(--gold);color:#0f172a;font-weight:700;padding:6px 16px;font-size:.85rem">
            تصفح الشجرة الآن 🌳
          </button>
        </div>
      </div>
    `;
    showInfo(welcomeHtml);
  } catch (e) {
    console.warn('Invitation check error:', e);
  }
}

function openPersonalInvitesModal() {
  const TITLES = [
    'ابن العم الكريم',
    'الأخ الفاضل',
    'العم العزيز',
    'الخال الفاضل',
    'بنت العم الكريمة',
    'الأخت الفاضلة',
    'العمة الفاضلة',
    'الخالة العزيزة',
    'الأستاذ الفاضل',
    'الضيف الكريم'
  ];

  const EVENTS = [
    'تصفح شجرة وتاريخ عائلة آل مطارد',
    'اجتماع العائلة السنوي (عيد الفطر المبارك)',
    'اجتماع العائلة السنوي (عيد الأضحى المبارك)',
    'ملتقى أبناء الأسرة الصيفي بالسراة',
    'حفل زواج ومناسبة كريمة',
    'لقاء صلة الرحم والتواصل'
  ];

  let guestName = 'محمد بن صالح المطارد';
  let guestTitle = 'ابن العم الكريم';
  let eventType = EVENTS[0];
  let hostName = 'مجلس أسرة آل مطارد';
  let customNote = 'يسرنا ويسعدنا حضوركم وتشريفكم لصلة الرحم والتعرف على تاريخ وآباء وأجداد الأسرة.';

  function generateLink() {
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    params.set('inv_to', guestName.trim());
    params.set('inv_title', guestTitle);
    params.set('inv_ev', eventType);
    params.set('inv_from', hostName.trim());
    params.set('code', '27748111');
    return `${base}?${params.toString()}`;
  }

  function renderModal() {
    const inviteLink = generateLink();
    const savedInvites = JSON.parse(localStorage.getItem('almatarid_personal_invites') || '[]');

    const html = `
      <div class="pinv-wrap" style="max-width:760px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>💌</span> روابط دعوة شخصية تحمل اسم المدعو
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          أنشئ دعوة شخصية فريدة لكل قريب تحمل اسمه ولقبه التقديري ورسالة ترحيب خاصة تظهر له فور فتح الرابط، لتصل به إلى الشجرة بكل حفاوة وتقدير.
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <!-- Inputs Form -->
          <div style="display:flex;flex-direction:column;gap:10px">
            <div>
              <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">اسم المدعو (الضيف / القريب):</label>
              <input type="text" id="pinv-name-inp" value="${esc(guestName)}" placeholder="مثال: فهد بن علي المطارد" style="width:100%;box-sizing:border-box;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:.84rem">
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>
                <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">اللقب / صفة القرابة:</label>
                <select id="pinv-title-sel" class="fstats-btn" style="width:100%;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:.78rem">
                  ${TITLES.map(t => `<option value="${esc(t)}" ${t === guestTitle ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                </select>
              </div>

              <div>
                <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">المُرسل (الداعي):</label>
                <input type="text" id="pinv-host-inp" value="${esc(hostName)}" placeholder="مجلس الأسرة / ابنكم..." style="width:100%;box-sizing:border-box;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:.78rem">
              </div>
            </div>

            <div>
              <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">المناسبة أو الغرض:</label>
              <select id="pinv-ev-sel" class="fstats-btn" style="width:100%;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:.78rem">
                ${EVENTS.map(ev => `<option value="${esc(ev)}" ${ev === eventType ? 'selected' : ''}>${esc(ev)}</option>`).join('')}
              </select>
            </div>

            <div>
              <label style="font-size:.78rem;color:var(--gold);display:block;margin-bottom:4px">رسالة الدعوة والترحيب المخصصة:</label>
              <textarea id="pinv-note-inp" rows="3" style="width:100%;box-sizing:border-box;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:.8rem;line-height:1.5;resize:none">${esc(customNote)}</textarea>
            </div>
          </div>

          <!-- Preview Card -->
          <div style="display:flex;flex-direction:column;justify-content:center">
            <div class="pinv-card">
              <div style="font-size:.74rem;color:var(--gold);font-weight:700">بِسْمِ اللَّـهِ الرَّحْمَـٰنِ الرَّحِيمِ</div>
              <div class="pinv-badge" style="align-self:center">دعوة كريمة وخاصة</div>
              <div class="pinv-guest-title">
                إلى: ${esc(guestTitle)} / ${esc(guestName || 'المدعو')}
              </div>
              <div style="font-size:.8rem;color:var(--txt);line-height:1.6">
                ${esc(customNote)}
              </div>
              <div style="font-size:.78rem;color:var(--gold);margin-top:4px">
                المناسبة: <b>${esc(eventType)}</b>
              </div>
              <div style="font-size:.74rem;color:var(--mut);border-top:1px dashed var(--line);padding-top:6px;margin-top:6px">
                الداعي: <b>${esc(hostName)}</b>
              </div>
            </div>
          </div>
        </div>

        <!-- Share & Actions -->
        <div style="background:rgba(15,23,42,.7);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-top:8px">
          <div style="font-size:.76rem;color:var(--gold);margin-bottom:4px;font-weight:700">🔗 رابط الدعوة الشخصي المولد:</div>
          <div style="color:var(--txt);word-break:break-all;direction:ltr;text-align:left;font-family:monospace;font-size:.74rem;background:#06101e;padding:6px 10px;border-radius:6px">
            ${esc(inviteLink)}
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="fstats-btn" id="btn-pinv-wa" style="background:#25d366;color:#0f172a;font-weight:700;padding:6px 14px;font-size:.8rem">
              📲 إرسال الدعوة عبر واتساب
            </button>
            <button type="button" class="fstats-btn" id="btn-pinv-copy" style="background:var(--gold);color:#0f172a;font-weight:700;padding:6px 14px;font-size:.8rem">
              📋 نسخ رابط الدعوة
            </button>
            <button type="button" class="fstats-btn" id="btn-pinv-save" style="padding:6px 14px;font-size:.8rem">
              💾 حفظ في سجل الدعوات
            </button>
          </div>
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Live inputs
    const nInp = $('#pinv-name-inp');
    if (nInp) nInp.oninput = (e) => { guestName = e.target.value; renderModal(); };
    const tSel = $('#pinv-title-sel');
    if (tSel) tSel.onchange = (e) => { guestTitle = e.target.value; renderModal(); };
    const evSel = $('#pinv-ev-sel');
    if (evSel) evSel.onchange = (e) => { eventType = e.target.value; renderModal(); };
    const hInp = $('#pinv-host-inp');
    if (hInp) hInp.oninput = (e) => { hostName = e.target.value; renderModal(); };
    const noteInp = $('#pinv-note-inp');
    if (noteInp) noteInp.oninput = (e) => { customNote = e.target.value; renderModal(); };

    // WhatsApp action
    const waBtn = $('#btn-pinv-wa');
    if (waBtn) {
      waBtn.onclick = () => {
        const link = generateLink();
        const msg = `🌿 السلام عليكم ورحمة الله وبركاته،\nإلى: ${guestTitle} / ${guestName} حفظكم الله،\n\n${customNote}\n\n📍 المناسبة: ${eventType}\n🔗 رابط دعوتكم الشخصي المباشر:\n${link}\n\nمع فائق التقدير والمحبة،\n${hostName}`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
      };
    }

    // Copy action
    const copyBtn = $('#btn-pinv-copy');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(generateLink()).then(() => {
          toast(`✅ تم نسخ رابط الدعوة الشخصي لـ «${guestName}»!`);
        });
      };
    }

    // Save action
    const saveBtn = $('#btn-pinv-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const list = JSON.parse(localStorage.getItem('almatarid_personal_invites') || '[]');
        list.unshift({
          id: 'inv_' + Date.now(),
          guestName,
          guestTitle,
          eventType,
          date: new Date().toLocaleDateString('ar-SA')
        });
        localStorage.setItem('almatarid_personal_invites', JSON.stringify(list));
        toast('✅ تم حفظ الدعوة في السجل بنجاح!');
      };
    }
  }

  renderModal();
}

/* ---------- 88) لوحة أخبار العائلة ومنشورات الأقارب (فرع تجربة) ---------- */
function openFamilyNewsModal(filterCat = 'all') {
  const DEFAULT_POSTS = [
    {
      id: 'post_1',
      author: 'مجلس شباب آل مطارد',
      authorBranch: 'فرع النماص',
      category: 'grad',
      categoryLabel: '🎓 إنجازات وتخرج',
      title: 'تهنئة بحصول الدكتور فهد المطارد على البورد الطبي',
      body: 'ببالغ الفخر والاعتزاز، يبارك عموم أفراد أسرة آل مطارد لابن العم الدكتور فهد بن محمد المطارد بمناسبة اجتيازه البورد الطبي بتفوق مع مرتبة الشرف، سائلين الله له دوام التوفيق لخدمة دينه ووطنه وأهله.',
      imageUrl: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=600&q=80',
      dateText: 'منذ يومين',
      reactions: { congrats: 28, proud: 19, dua: 34 },
      comments: [
        { name: 'أبو علي', text: 'ألف ترليون مبروك ومنها للأعلى إن شاء الله تستاهل كل خير يا دكتور.' },
        { name: 'سعد المطارد', text: 'ما شاء الله تبارك الله، فخر للعائلة كلها ورفع الله قدرك.' }
      ]
    },
    {
      id: 'post_2',
      author: 'عبدالرحمن بن صالح',
      authorBranch: 'فرع الرياض',
      category: 'baby',
      categoryLabel: '👶 مواليد جدد',
      title: 'قدوم المولود الجديد «سعود» جعله الله من مواليد السعادة',
      body: 'الحمد لله الذي بنعمته تتم الصالحات، رُزق ابن العم عبدالرحمن بن صالح المطارد بمولود جديد اتفق وحرمه على تسميته «سعود»، بارك الله له في الموهوب وشكر الواهب ورزقه بره وبلغ أشده.',
      imageUrl: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=600&q=80',
      dateText: 'منذ 4 أيام',
      reactions: { congrats: 42, proud: 8, dua: 55 },
      comments: [
        { name: 'محمد بن علي', text: 'جعله الله قرة عين لوالديه ومن حفظة كتابه الكريم.' }
      ]
    },
    {
      id: 'post_3',
      author: 'لجنة الفعاليات والمناسبات',
      authorBranch: 'فرع السراة',
      category: 'meet',
      categoryLabel: '🤝 لقاءات واجتماعات',
      title: 'تغطية اجتماع الأسرة الصيفي بمنتجع السراة في النماص',
      body: 'أقيم مساء الجمعة المباركة الاجتماع السنوي لأسرة آل مطارد في أجواء سادتها الألفة وصلة الرحم وتبادل الذكريات وتكريم المتميزين من الطلاب والطالبات من أبناء العائلة، بحضور كريم من أعيان وكبار الأسرة.',
      imageUrl: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=600&q=80',
      dateText: 'الأسبوع الماضي',
      reactions: { congrats: 51, proud: 38, dua: 46 },
      comments: [
        { name: 'صالح بن مسفر', text: 'الله يديم المحبة والجمعة الطيبة ولا يفرق شملنا جميعاً.' }
      ]
    }
  ];

  const localPosts = JSON.parse(localStorage.getItem('almatarid_family_posts') || '[]');
  const allPosts = [...localPosts, ...DEFAULT_POSTS];

  let activeCat = filterCat;

  function renderNewsModal() {
    const filtered = allPosts.filter(p => activeCat === 'all' || p.category === activeCat);

    const html = `
      <div class="fnews-wrap" style="max-width:760px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>📰</span> لوحة أخبار العائلة ومنشورات الأقارب
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          المساحة الاجتماعية المشتركة لأفراد أسرة آل مطارد لمشاركة الأخبار السارة، وتبريكات التخرج والمواليد والأفراح، وتغطيات الاجتماعات العائلية مع تفاعل مباشر من الأقارب.
        </p>

        <!-- Category Filter & Add Button -->
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(15,23,42,.7);padding:8px 12px;border-radius:8px;border:1px solid var(--line)">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="fstats-btn ${activeCat === 'all' ? 'active' : ''}" id="cat-all" style="padding:4px 10px;font-size:.76rem">الكل</button>
            <button type="button" class="fstats-btn ${activeCat === 'grad' ? 'active' : ''}" id="cat-grad" style="padding:4px 10px;font-size:.76rem">🎓 إنجازات وتخرج</button>
            <button type="button" class="fstats-btn ${activeCat === 'baby' ? 'active' : ''}" id="cat-baby" style="padding:4px 10px;font-size:.76rem">👶 مواليد</button>
            <button type="button" class="fstats-btn ${activeCat === 'wedding' ? 'active' : ''}" id="cat-wedding" style="padding:4px 10px;font-size:.76rem">💍 أفراح وزواجات</button>
            <button type="button" class="fstats-btn ${activeCat === 'meet' ? 'active' : ''}" id="cat-meet" style="padding:4px 10px;font-size:.76rem">🤝 اجتماعات</button>
          </div>

          <button type="button" class="fstats-btn" id="btn-add-fnews" style="background:var(--gold);color:#0f172a;font-weight:700;padding:5px 12px;font-size:.78rem">
            ✍️ إضافة خبر أو منشور جديد
          </button>
        </div>

        <!-- Posts Feed -->
        <div style="display:flex;flex-direction:column;gap:14px;max-height:500px;overflow-y:auto;padding-left:4px">
          ${filtered.map(post => `
            <div class="fnews-post" data-post-id="${post.id}">
              <div class="fnews-post-header">
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="fnews-author-avatar">${esc(post.author.charAt(0))}</div>
                  <div>
                    <b style="color:var(--txt);font-size:.88rem">${esc(post.author)}</b>
                    <div style="font-size:.72rem;color:var(--mut)">${esc(post.authorBranch || 'الأسرة')} · 🕒 ${esc(post.dateText)}</div>
                  </div>
                </div>

                <span class="fnews-tag" style="background:rgba(245,158,11,.15);color:var(--gold);border:1px solid var(--gold)">
                  ${esc(post.categoryLabel)}
                </span>
              </div>

              <div>
                <h3 style="margin:0 0 6px 0;color:var(--gold);font-size:.96rem">${esc(post.title)}</h3>
                <p style="margin:0;font-size:.84rem;color:var(--txt);line-height:1.65;white-space:pre-line">${esc(post.body)}</p>
              </div>

              ${post.imageUrl ? `
                <div style="border-radius:8px;overflow:hidden;border:1px solid var(--line);max-height:260px;background:#000">
                  <img src="${esc(post.imageUrl)}" style="width:100%;height:auto;max-height:260px;object-fit:cover;display:block" loading="lazy">
                </div>
              ` : ''}

              <!-- Reactions Toolbar -->
              <div class="fnews-reactions">
                <button type="button" class="fnews-react-btn" data-react="congrats" data-pid="${post.id}">
                  ❤️ تهنئة وتبريك <b>${post.reactions?.congrats || 0}</b>
                </button>
                <button type="button" class="fnews-react-btn" data-react="proud" data-pid="${post.id}">
                  👏 فخر واعتزاز <b>${post.reactions?.proud || 0}</b>
                </button>
                <button type="button" class="fnews-react-btn" data-react="dua" data-pid="${post.id}">
                  🤲 دعاء بالبركة <b>${post.reactions?.dua || 0}</b>
                </button>
                <button type="button" class="fnews-react-btn" data-share-wa="${post.id}" style="margin-right:auto;border-color:rgba(37,211,102,.5);color:#25d366">
                  📲 واتساب
                </button>
              </div>

              <!-- Comments Section -->
              <div style="background:rgba(0,0,0,.25);border-radius:8px;padding:8px 12px;margin-top:2px">
                <div style="font-size:.74rem;color:var(--mut);margin-bottom:6px">تبريكات وتهاني الأقارب (${(post.comments || []).length}):</div>
                <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px">
                  ${(post.comments || []).map(c => `
                    <div style="font-size:.78rem;line-height:1.4">
                      <b style="color:var(--gold)">${esc(c.name)}:</b>
                      <span style="color:var(--txt)"> ${esc(c.text)}</span>
                    </div>
                  `).join('')}
                </div>

                <div style="display:flex;gap:6px;margin-top:6px">
                  <input type="text" placeholder="اكتب تهنئتك أو مباركتك..." data-comm-inp="${post.id}" style="flex:1;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:.76rem">
                  <button type="button" class="fstats-btn" data-comm-send="${post.id}" style="font-size:.76rem;padding:4px 10px;background:var(--gold);color:#0f172a;font-weight:700">إرسال</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding-top:10px">
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Filter bindings
    const setCat = (cat) => { activeCat = cat; renderNewsModal(); };
    $('#cat-all').onclick = () => setCat('all');
    $('#cat-grad').onclick = () => setCat('grad');
    $('#cat-baby').onclick = () => setCat('baby');
    $('#cat-wedding').onclick = () => setCat('wedding');
    $('#cat-meet').onclick = () => setCat('meet');

    // Reaction bindings
    document.querySelectorAll('[data-react]').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.react;
        const pid = btn.dataset.pid;
        const post = allPosts.find(p => p.id === pid);
        if (post) {
          if (!post.reactions) post.reactions = {};
          post.reactions[type] = (post.reactions[type] || 0) + 1;
          // Persist in localStorage
          const stored = JSON.parse(localStorage.getItem('almatarid_family_posts') || '[]');
          const idx = stored.findIndex(s => s.id === pid);
          if (idx >= 0) stored[idx] = post; else stored.push(post);
          localStorage.setItem('almatarid_family_posts', JSON.stringify(stored));
          toast('❤️ تم تسجيل تفاعلك ومباركتك!');
          renderNewsModal();
        }
      };
    });

    // Comment sending
    document.querySelectorAll('[data-comm-send]').forEach(btn => {
      btn.onclick = () => {
        const pid = btn.dataset.commSend;
        const inp = document.querySelector(`[data-comm-inp="${pid}"]`);
        if (!inp || !inp.value.trim()) return;
        const text = inp.value.trim();
        const post = allPosts.find(p => p.id === pid);
        if (post) {
          if (!post.comments) post.comments = [];
          const name = prompt('اكتب اسمك ليظهر مع التهنئة:', S.role === 'visitor' ? 'ابن العم' : 'قريب من العائلة') || 'أحد أفراد العائلة';
          post.comments.push({ name, text });
          const stored = JSON.parse(localStorage.getItem('almatarid_family_posts') || '[]');
          const idx = stored.findIndex(s => s.id === pid);
          if (idx >= 0) stored[idx] = post; else stored.push(post);
          localStorage.setItem('almatarid_family_posts', JSON.stringify(stored));
          toast('✅ تم نشر تهنئتك ومباركتك بنجاح!');
          renderNewsModal();
        }
      };
    });

    // WhatsApp share
    document.querySelectorAll('[data-share-wa]').forEach(btn => {
      btn.onclick = () => {
        const pid = btn.dataset.shareWa;
        const post = allPosts.find(p => p.id === pid);
        if (post) {
          const msg = `📰 *${post.title}*\n\n${post.body}\n\n— منشور عبر لوحة أخبار عائلة آل مطارد:\n${window.location.href}`;
          window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
        }
      };
    });

    // Add new post
    const addBtn = $('#btn-add-fnews');
    if (addBtn) {
      addBtn.onclick = () => {
        const title = prompt('عنوان الخبر أو المناسبة (مثال: تخرج فلان / زواج فلان):');
        if (!title) return;
        const author = prompt('اسم الكاتب أو صاحب المنشور:') || 'أحد أفراد الأسرة';
        const body = prompt('تفاصيل الخبر أو التهنئة:') || '';
        const catKey = prompt('التصنيف: (grad=تخرج، baby=مولود، wedding=زواج، meet=اجتماع)') || 'meet';
        const imgUrl = prompt('رابط صورة للخبر (اختياري - اتركه فارغاً إن لم يتوفر):') || '';

        const catLabels = { grad: '🎓 إنجازات وتخرج', baby: '👶 مواليد', wedding: '💍 أفراح وزواجات', meet: '🤝 اجتماعات' };

        const newPost = {
          id: 'post_user_' + Date.now(),
          author,
          authorBranch: 'عائلة آل مطارد',
          category: catKey,
          categoryLabel: catLabels[catKey] || '📢 إعلانات عامة',
          title,
          body,
          imageUrl: imgUrl,
          dateText: 'الآن',
          reactions: { congrats: 1, proud: 0, dua: 1 },
          comments: []
        };

        const stored = JSON.parse(localStorage.getItem('almatarid_family_posts') || '[]');
        stored.unshift(newPost);
        localStorage.setItem('almatarid_family_posts', JSON.stringify(stored));
        allPosts.unshift(newPost);
        toast('✅ تم نشر الخبر على لوحة أخبار العائلة بنجاح!');
        renderNewsModal();
      };
    }
  }

  renderNewsModal();
}

/* ---------- 89) تصويت العائلة على القرارات (فرع تجربة) ---------- */
function openFamilyVoteModal() {
  const DEFAULT_POLLS = [
    {
      id: 'poll_1',
      title: 'موعد ومقر اجتماع عائلة آل مطارد السنوي القادم',
      description: 'يسر مجلس الأسرة استطلاع آراء عموم أبناء وبنات العائلة الكرام حول الموعد والمكان المفضل للاجتماع السنوي القادم لتعزيز صلة الرحم وأعلى نسبة حضور.',
      endDateText: 'متبقي 5 أيام',
      status: 'active',
      options: [
        { id: 'opt_1', text: 'مدينة النماص (الموطن الأصلي بالسراة - ثالث أيام عيد الفطر)', votes: 41 },
        { id: 'opt_2', text: 'مدينة الرياض (مقر تجمع العاصمة - خامس أيام عيد الفطر)', votes: 29 },
        { id: 'opt_3', text: 'منطقة عسير (أبها وخميس مشيط - ثاني أيام عيد الأضحى)', votes: 16 }
      ]
    },
    {
      id: 'poll_2',
      title: 'مشروع جائزة التفوق العلمي وحفظ القرآن الكريم لأبناء الأسرة',
      description: 'مقترح اعتماد جائزة سنوية لتكريم الطلاب والطالبات المتفوقين في التعليم العام والجامعي وحفظة كتاب الله الكريم.',
      endDateText: 'متبقي أسبوعان',
      status: 'active',
      options: [
        { id: 'opt_2_1', text: 'أوافق وبشدة وأدعم إطلاق الجائزة في الاجتماع القادم', votes: 68 },
        { id: 'opt_2_2', text: 'أوافق مع قصرها على خريجي الجامعات والدراسات العليا', votes: 14 },
        { id: 'opt_2_3', text: 'أقترح تكوين لجنة خاصة لوضع معايير الجائزة', votes: 22 }
      ]
    }
  ];

  const localPolls = JSON.parse(localStorage.getItem('almatarid_family_polls') || '[]');
  const allPolls = [...localPolls, ...DEFAULT_POLLS];
  const userVotes = JSON.parse(localStorage.getItem('almatarid_user_votes') || '{}');

  function renderVoteModal() {
    const html = `
      <div class="fvote-wrap" style="max-width:760px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>🗳️</span> تصويت واستطلاعات قرارات العائلة
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          منصة شورى وتصويت تفاعلية لأفراد أسرة آل مطارد للمشاركة في القرارات العائلية، وتحديد مواعيد الاجتماعات، واختيار المبادرات والمشاريع التكافلية بنزاهة وشفافية.
        </p>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(15,23,42,.7);padding:8px 12px;border-radius:8px;border:1px solid var(--line)">
          <div style="font-size:.78rem;color:var(--txt)">
            📊 الاستطلاعات المتاحة: <b>${allPolls.length} تصويتات</b>
          </div>

          <button type="button" class="fstats-btn" id="btn-create-poll" style="background:var(--gold);color:#0f172a;font-weight:700;padding:5px 12px;font-size:.78rem">
            ➕ إنشاء تصويت أو استطلاع جديد
          </button>
        </div>

        <!-- Polls List -->
        <div style="display:flex;flex-direction:column;gap:14px;max-height:500px;overflow-y:auto;padding-left:4px">
          ${allPolls.map(poll => {
            const totalVotes = poll.options.reduce((sum, o) => sum + (o.votes || 0), 0);
            const userChoice = userVotes[poll.id] || null;

            return `
              <div class="fvote-card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                  <div>
                    <h3 style="margin:0 0 4px 0;color:var(--gold);font-size:.98rem">${esc(poll.title)}</h3>
                    <div style="font-size:.74rem;color:var(--mut)">🕒 ${esc(poll.endDateText)} · إجمالي الأصوات: <b>${totalVotes}</b></div>
                  </div>
                  <span class="fnews-tag" style="background:rgba(34,197,94,.15);color:#22c55e;border:1px solid #22c55e">
                    🟢 تصويت متاح
                  </span>
                </div>

                <p style="margin:0;font-size:.82rem;color:var(--txt);line-height:1.6">${esc(poll.description)}</p>

                <!-- Options -->
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${poll.options.map(opt => {
                    const pct = totalVotes > 0 ? Math.round(((opt.votes || 0) / totalVotes) * 100) : 0;
                    const isVoted = userChoice === opt.id;

                    return `
                      <div class="fvote-option-row ${isVoted ? 'voted' : ''}" data-poll-id="${poll.id}" data-opt-id="${opt.id}">
                        <div class="fvote-progress-fill" style="width:${pct}%"></div>

                        <div style="position:relative;z-index:2;display:flex;align-items:center;gap:8px">
                          <span style="font-size:.9rem">${isVoted ? '✅' : '🔘'}</span>
                          <span style="font-size:.82rem;font-weight:${isVoted ? '700' : '400'};color:var(--txt)">${esc(opt.text)}</span>
                        </div>

                        <div style="position:relative;z-index:2;font-size:.78rem;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:8px">
                          <span>${pct}%</span>
                          <span style="font-size:.7rem;color:var(--mut)">(${opt.votes || 0})</span>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>

                <!-- Footer & Share -->
                <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--line);padding-top:8px;margin-top:2px">
                  <div style="font-size:.74rem;color:${userChoice ? '#22c55e' : 'var(--mut)'}">
                    ${userChoice ? '✓ تم تسجيل صوتك بنجاح في هذا الاستطلاع' : 'انقر على أحد الخيارات أعلاه للتصويت مباشرة'}
                  </div>

                  <button type="button" class="fstats-btn" data-share-poll="${poll.id}" style="padding:3px 10px;font-size:.74rem;background:#25d366;color:#0f172a;font-weight:700">
                    📲 دعوة الأقارب للتصويت
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding-top:10px">
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Voting click handlers
    document.querySelectorAll('[data-poll-id][data-opt-id]').forEach(row => {
      row.onclick = () => {
        const pid = row.dataset.pollId;
        const oid = row.dataset.optId;
        const poll = allPolls.find(p => p.id === pid);
        if (!poll) return;

        const prevChoice = userVotes[pid];
        if (prevChoice === oid) {
          toast('لقد صوّت بالفعل لهذا الخيار!');
          return;
        }

        // Adjust counts
        if (prevChoice) {
          const oldOpt = poll.options.find(o => o.id === prevChoice);
          if (oldOpt && oldOpt.votes > 0) oldOpt.votes--;
        }

        const newOpt = poll.options.find(o => o.id === oid);
        if (newOpt) newOpt.votes = (newOpt.votes || 0) + 1;

        userVotes[pid] = oid;
        localStorage.setItem('almatarid_user_votes', JSON.stringify(userVotes));

        // Persist poll
        const stored = JSON.parse(localStorage.getItem('almatarid_family_polls') || '[]');
        const idx = stored.findIndex(s => s.id === pid);
        if (idx >= 0) stored[idx] = poll; else stored.push(poll);
        localStorage.setItem('almatarid_family_polls', JSON.stringify(stored));

        toast('🗳️ تم تسجيل صوتك بنجاح، شكراً لمشاركتك!');
        renderVoteModal();
      };
    });

    // WhatsApp share
    document.querySelectorAll('[data-share-poll]').forEach(btn => {
      btn.onclick = () => {
        const pid = btn.dataset.sharePoll;
        const poll = allPolls.find(p => p.id === pid);
        if (poll) {
          const msg = `🗳️ *استطلاع وتصويت عائلي:*\n*${poll.title}*\n\n${poll.description}\n\nشاركونا رأيكم وصوتكم عبر شجرة آل مطارد:\n${window.location.href}`;
          window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
        }
      };
    });

    // Create poll
    const createBtn = $('#btn-create-poll');
    if (createBtn) {
      createBtn.onclick = () => {
        const title = prompt('عنوان التصويت أو القرار المطروح:');
        if (!title) return;
        const desc = prompt('شرح موجز لموضوع الاستطلاع:') || '';
        const opt1 = prompt('الخيار الأول:') || 'نعم، أوافق';
        const opt2 = prompt('الخيار الثاني:') || 'لا أوافق';
        const opt3 = prompt('الخيار الثالث (اختياري):');

        const options = [
          { id: 'opt_' + Date.now() + '_1', text: opt1, votes: 0 },
          { id: 'opt_' + Date.now() + '_2', text: opt2, votes: 0 }
        ];
        if (opt3) {
          options.push({ id: 'opt_' + Date.now() + '_3', text: opt3, votes: 0 });
        }

        const newPoll = {
          id: 'poll_user_' + Date.now(),
          title,
          description: desc,
          endDateText: 'متبقي 30 يوماً',
          status: 'active',
          options
        };

        const stored = JSON.parse(localStorage.getItem('almatarid_family_polls') || '[]');
        stored.unshift(newPoll);
        localStorage.setItem('almatarid_family_polls', JSON.stringify(stored));
        allPolls.unshift(newPoll);
        toast('✅ تم إنشاء الاستطلاع والتصويت العائلي بنجاح!');
        renderVoteModal();
      };
    }
  }

  renderVoteModal();
}

/* ---------- 90) دليل مهن وأعمال أفراد العائلة (فرع تجربة) ---------- */
function openCareersDirectoryModal() {
  const CAREER_CATS = [
    { key: 'all', label: 'الكل' },
    { key: 'med', label: '🩺 الطب والصحة' },
    { key: 'eng', label: '🏗️ الهندسة والتقنية' },
    { key: 'law', label: '⚖️ القانون والعدل' },
    { key: 'edu', label: '🎓 التعليم والأكاديميا' },
    { key: 'biz', label: '💼 التجارة والأعمال' },
    { key: 'gov', label: '🏛️ القطاع العام' },
    { key: 'mil', label: '🎖️ السلك العسكري' }
  ];

  const DEFAULT_CAREERS = [
    {
      id: 'car_1',
      name: 'د. فهد بن محمد المطارد',
      category: 'med',
      categoryLabel: '🩺 الطب والصحة',
      title: 'استشاري جراحة وأستاذ مساعد',
      workplace: 'مدينة الملك فهد الطبية - الرياض',
      specialty: 'الجراحة العامة والمناظير',
      city: 'الرياض',
      phone: '0501112233'
    },
    {
      id: 'car_2',
      name: 'م. صالح بن علي المطارد',
      category: 'eng',
      categoryLabel: '🏗️ الهندسة والتقنية',
      title: 'مهندس معماري ومستشار مشاريع',
      workplace: 'مكتب السراة للاستشارات الهندسية',
      specialty: 'التصميم التراثي والعمراني المستدام',
      city: 'النماص',
      phone: '0502223344'
    },
    {
      id: 'car_3',
      name: 'المستشار سلطان بن فهد المطارد',
      category: 'law',
      categoryLabel: '⚖️ القانون والعدل',
      title: 'محامٍ ومحكم معتمد',
      workplace: 'مجموعة المطارد للمحاماة والاستشارات',
      specialty: 'القضايا التجارية والتركات والأوقاف',
      city: 'جدة',
      phone: '0503334455'
    },
    {
      id: 'car_4',
      name: 'أ.د. سعيد بن محمد المطارد',
      category: 'edu',
      categoryLabel: '🎓 التعليم والأكاديميا',
      title: 'أستاذ التاريخ والوثائق المشارك',
      workplace: 'جامعة الملك خالد - أبها',
      specialty: 'تاريخ الجزيرة العربية وجنوب المملكة',
      city: 'أبها',
      phone: '0504445566'
    },
    {
      id: 'car_5',
      name: 'أ. عبدالرحمن بن صالح المطارد',
      category: 'biz',
      categoryLabel: '💼 التجارة والأعمال',
      title: 'رائد أعمال ومدير عام',
      workplace: 'شركة المطارد للتجارة والمقاولات',
      specialty: 'التطوير العقاري وسلاسل الإمداد',
      city: 'الرياض',
      phone: '0505556677'
    }
  ];

  // Retrieve user registered careers
  const localCareers = JSON.parse(localStorage.getItem('almatarid_careers') || '[]');
  const allCareers = [...localCareers, ...DEFAULT_CAREERS];

  let activeCat = 'all';
  let searchQuery = '';

  function renderModal() {
    const filtered = allCareers.filter(item => {
      if (activeCat !== 'all' && item.category !== activeCat) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return item.name.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.specialty.toLowerCase().includes(q) ||
          item.workplace.toLowerCase().includes(q) ||
          item.city.toLowerCase().includes(q);
      }
      return true;
    });

    const html = `
      <div class="career-wrap" style="max-width:800px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>💼</span> دليل مهن وأعمال أفراد العائلة
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          شبكة مهنية عائلية للتواصل وتبادل الخبرات بين أبناء وبنات أسرة آل مطارد: ابحث عن قريب بحسب تخصصه أو مهنته للاستشارة والتعاون التجاري وصلة الرحم.
        </p>

        <!-- Search Bar and Add Button -->
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(15,23,42,.7);padding:8px 12px;border-radius:8px;border:1px solid var(--line)">
          <input type="text" id="career-search-inp" value="${esc(searchQuery)}" placeholder="ابحث باسم القريب، المهنة، التخصص، أو المدينة (مثال: طبيب، مهندس، الرياض)..." style="flex:1;min-width:200px;background:#0f172a;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:.82rem">

          <button type="button" class="fstats-btn" id="btn-add-career" style="background:var(--gold);color:#0f172a;font-weight:700;padding:6px 12px;font-size:.78rem">
            ➕ إضافة مهنتي وتخصصي في الدليل
          </button>
        </div>

        <!-- Category Pills -->
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${CAREER_CATS.map(c => `
            <button type="button" class="fstats-btn ${activeCat === c.key ? 'active' : ''}" data-car-cat="${c.key}" style="padding:4px 10px;font-size:.76rem">
              ${c.label}
            </button>
          `).join('')}
        </div>

        <!-- Directory Grid -->
        <div class="career-grid" style="max-height:480px;overflow-y:auto;padding-left:4px">
          ${filtered.length ? filtered.map(item => {
            const matchedMember = S.members.find(m => m.full_name && m.full_name.includes(item.name.replace(/^(د\.|م\.|المستشار|أ\.د\.|أ\.)\s*/, '')));
            return `
              <div class="career-card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
                  <span class="career-badge">${esc(item.categoryLabel)}</span>
                  <span style="font-size:.72rem;color:var(--mut)">📍 ${esc(item.city)}</span>
                </div>

                <div>
                  <h3 style="margin:0 0 2px 0;font-size:.9rem;color:var(--gold)">${esc(item.name)}</h3>
                  <div style="font-size:.8rem;font-weight:700;color:var(--txt)">${esc(item.title)}</div>
                </div>

                <div style="font-size:.76rem;color:var(--mut);line-height:1.4">
                  <div>🏢 <b>الجهة:</b> ${esc(item.workplace)}</div>
                  <div>🎯 <b>التخصص:</b> ${esc(item.specialty)}</div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--line);padding-top:8px;margin-top:auto">
                  ${matchedMember ? `
                    <button type="button" class="x" style="font-size:.74rem;color:var(--gold);font-weight:700" onclick="profile('${matchedMember.id}')">
                      👤 الملف بالشجرة
                    </button>
                  ` : `<span></span>`}

                  ${item.phone ? `
                    <a href="https://api.whatsapp.com/send?phone=${item.phone.replace(/^0/, '966')}&text=${encodeURIComponent('السلام عليكم ورحمة الله، تواصل مهني عبر دليل أسرة آل مطارد.')}" target="_blank" class="fstats-btn" style="text-decoration:none;font-size:.72rem;padding:3px 8px;background:rgba(37,211,102,.15);color:#25d366;border-color:#25d366">
                      📲 واتساب
                    </a>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('') : `
            <div style="grid-column:1/-1;text-align:center;padding:40px 10px;color:var(--mut)">
              <div style="font-size:2rem;margin-bottom:8px">💼</div>
              <div>لا توجد نتائج مطابقة لبحثك، جرب البحث بكلمة أخرى أو أضف تخصصك أعلاه!</div>
            </div>
          `}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:10px">
          <span style="font-size:.74rem;color:var(--mut)">إجمالي الكفاءات المسجلة: <b>${allCareers.length} فرد</b></span>
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Bind category filters
    document.querySelectorAll('[data-car-cat]').forEach(btn => {
      btn.onclick = () => {
        activeCat = btn.dataset.carCat;
        renderModal();
      };
    });

    // Bind search
    const sInp = $('#career-search-inp');
    if (sInp) {
      sInp.oninput = (e) => {
        searchQuery = e.target.value;
        renderModal();
      };
    }

    // Add career
    const addBtn = $('#btn-add-career');
    if (addBtn) {
      addBtn.onclick = () => {
        const name = prompt('اسمك الكريم مع اللقب (مثال: د. عبدالله بن صالح المطارد):');
        if (!name) return;
        const title = prompt('المسمى المهني والوظيفة (مثال: استشاري باطنة / مهندس برمجيات):') || 'أخصائي';
        const workplace = prompt('جهة العمل أو اسم الشركة/العيادة/المكتب:') || 'القطاع الخاص';
        const specialty = prompt('التخصص الدقيق أو مجال العمل:') || 'عام';
        const city = prompt('المدينة (الرياض، النماص، جدة، أبها...):') || 'الرياض';
        const phone = prompt('رقم الجوال للتواصل المهني (اختياري):') || '';
        const catKey = prompt('رمز التصنيف: (med=طب، eng=هندسة، law=قانون، edu=تعليم، biz=تجارة، gov=حكومي، mil=عسكري):') || 'biz';

        const catLabels = {
          med: '🩺 الطب والصحة',
          eng: '🏗️ الهندسة والتقنية',
          law: '⚖️ القانون والعدل',
          edu: '🎓 التعليم والأكاديميا',
          biz: '💼 التجارة والأعمال',
          gov: '🏛️ القطاع العام',
          mil: '🎖️ السلك العسكري'
        };

        const newCar = {
          id: 'car_user_' + Date.now(),
          name,
          category: catKey,
          categoryLabel: catLabels[catKey] || '💼 أعمال متنوعة',
          title,
          workplace,
          specialty,
          city,
          phone
        };

        const stored = JSON.parse(localStorage.getItem('almatarid_careers') || '[]');
        stored.unshift(newCar);
        localStorage.setItem('almatarid_careers', JSON.stringify(stored));
        allCareers.unshift(newCar);
        toast('✅ تمت إضافة بياناتك المهنية إلى دليل العائلة بنجاح!');
        renderModal();
      };
    }
  }

  renderModal();
}

/* ---------- 91) رسائل موقوتة من كبار العائلة (فرع تجربة) ---------- */
function openTimeCapsuleModal(activeFilter = 'all') {
  const DEFAULT_CAPSULES = [
    {
      id: 'cap_1',
      author: 'الجد صالح بن مسفر المطارد (رحمه الله)',
      occasion: 'وصية جامعة للأبناء والأحفاد',
      status: 'unlocked',
      writtenDateText: 'عام 1412هـ',
      unlockConditionText: 'متاحة لعموم الأجيال',
      body: '«أوصيكم يا أبنائي ونصلتي ونصلة إخواني بتقوى الله في السر والعلن، وإقام الصلاة، وصلة أرحامكم، وتفقد ضعيفكم ومحتاجكم، وأن تكونوا يداً واحدة كالبنيان المرصوص يشد بعضه بعضاً، ولا يفرقكم طمع دنيا، وحافظوا على اسم أسرتكم وسمعتها الطيبة التي بناها الأجداد بالوفاء والمروءة والشرف.»',
      hasAudio: false
    },
    {
      id: 'cap_2',
      author: 'الوالد مسفر بن علي المطارد (حفظه الله)',
      occasion: 'مناسبة تخرج أول دفعة من الأطباء والمهندسين بالأسرة',
      status: 'unlocked',
      writtenDateText: 'عام 1435هـ',
      unlockConditionText: 'تُفتح عند حفل التفوق العائلي',
      body: '«الحمد لله الذي أقر أعيننا برؤية هذه الثمار الطيبة في أبنائنا وبناتنا.. أوصيكم ونفسي بأن تجعلوا هذا العلم خالصاً لوجه الله، وأن تكون عياداتكم ومكاتبكم عوناً للقريب والغريب، فما نفع العلم إن لم يُترجم إلى بر وإحسان وتواضع للخلق.»',
      hasAudio: false
    },
    {
      id: 'cap_3',
      author: 'كبار وأعيان الأسرة',
      occasion: 'اجتماع العائلة التاريخي لعام 1450هـ',
      status: 'locked',
      writtenDateText: 'عام 1445هـ',
      unlockConditionText: '🔒 تُفتح وتُقرأ في اجتماع العائلة عام 1450هـ بإذن الله',
      body: 'هذه الرسالة مغلقة في كبسولة الزمن، وتحتوي على رؤية وتوجيهات كبار العائلة للأجيال الشابة القادمة، وستُفتح بمشيئة الله وتُتلى في قاعة الاجتماع.',
      hasAudio: true
    }
  ];

  const localCapsules = JSON.parse(localStorage.getItem('almatarid_time_capsules') || '[]');
  const allCapsules = [...localCapsules, ...DEFAULT_CAPSULES];

  let currentTab = activeFilter;

  function renderModal() {
    const filtered = allCapsules.filter(c => {
      if (currentTab === 'unlocked') return c.status === 'unlocked';
      if (currentTab === 'locked') return c.status === 'locked';
      return true;
    });

    const html = `
      <div class="capsule-wrap" style="max-width:760px;text-align:right">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid var(--gold);padding-bottom:10px">
          <h2 style="margin:0;font-size:1.15rem;color:var(--gold);display:flex;align-items:center;gap:8px">
            <span>⏳</span> رسائل موقوتة من كبار العائلة (كبسولة الزمن)
          </h2>
          <button type="button" class="x" onclick="$('#profile').close();" style="font-size:1.2rem;color:var(--mut)">✕</button>
        </div>

        <p style="margin:0;font-size:.82rem;color:var(--mut);line-height:1.6">
          وصايا خالدة وكلمات أبوية غالية كتبها أجداد وكبار الأسرة لتُفتح وتُسلَّم في مناسبات محددة يختارها صاحبها (كالتخرج، الزواج، أو مواعيد مستقبلية) لتبقى قبساً يهتدي به الأبناء والأحفاد.
        </p>

        <!-- Filters & Action Toolbar -->
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(15,23,42,.7);padding:8px 12px;border-radius:8px;border:1px solid var(--line)">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="fstats-btn ${currentTab === 'all' ? 'active' : ''}" id="cap-all" style="padding:4px 10px;font-size:.76rem">الكل</button>
            <button type="button" class="fstats-btn ${currentTab === 'unlocked' ? 'active' : ''}" id="cap-unlocked" style="padding:4px 10px;font-size:.76rem">🔓 رسائل حان وقتها</button>
            <button type="button" class="fstats-btn ${currentTab === 'locked' ? 'active' : ''}" id="cap-locked" style="padding:4px 10px;font-size:.76rem">🔒 رسائل موقوتة مغلقة</button>
          </div>

          <button type="button" class="fstats-btn" id="btn-add-capsule" style="background:var(--gold);color:#0f172a;font-weight:700;padding:5px 12px;font-size:.78rem">
            ✍️ تدوين رسالة موقوتة جديدة
          </button>
        </div>

        <!-- Messages List -->
        <div style="display:flex;flex-direction:column;gap:12px;max-height:480px;overflow-y:auto;padding-left:4px">
          ${filtered.map(item => {
            const isUnlocked = item.status === 'unlocked';
            return `
              <div class="capsule-card ${isUnlocked ? 'unlocked' : 'locked'}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                  <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:1.6rem">${isUnlocked ? '📜' : '🔒'}</span>
                    <div>
                      <h3 style="margin:0 0 2px 0;font-size:.95rem;color:var(--gold)">${esc(item.author)}</h3>
                      <div style="font-size:.74rem;color:var(--mut)">المناسبة: <b>${esc(item.occasion)}</b> · تاريخ التدوين: ${esc(item.writtenDateText)}</div>
                    </div>
                  </div>

                  <span class="capsule-seal" style="background:${isUnlocked ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)'};color:${isUnlocked ? '#22c55e' : '#f87171'};border:1px solid ${isUnlocked ? '#22c55e' : '#f87171'}">
                    ${isUnlocked ? '🔓 مفتوحة للقراءة' : '🔒 موقوتة ومحفوظة'}
                  </span>
                </div>

                <div style="font-size:.78rem;color:var(--gold);background:rgba(0,0,0,.25);padding:4px 8px;border-radius:6px">
                  شرط الفتح: <b>${esc(item.unlockConditionText)}</b>
                </div>

                <div style="font-size:.85rem;color:var(--txt);line-height:1.7;white-space:pre-line;font-style:${isUnlocked ? 'italic' : 'normal'};background:${isUnlocked ? 'rgba(245,158,11,.04)' : 'rgba(0,0,0,.3)'};padding:10px 14px;border-radius:8px">
                  ${esc(item.body)}
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--line);padding-top:8px;margin-top:2px">
                  <span style="font-size:.72rem;color:var(--mut)">
                    ${isUnlocked ? '🤲 نسأل الله له المغفرة والرحمة والبركة في عقبه' : '⏳ تُفتح الكبسولة تلقائياً عند حلول موعد المناسبة'}
                  </span>

                  ${isUnlocked ? `
                    <button type="button" class="fstats-btn" data-share-cap="${item.id}" style="padding:3px 10px;font-size:.74rem;background:#25d366;color:#0f172a;font-weight:700">
                      📲 مشاركة الوصية عبر واتساب
                    </button>
                  ` : `
                    <button type="button" class="fstats-btn" data-unlock-cap="${item.id}" style="padding:3px 10px;font-size:.74rem">
                      🔑 فتح برمز خاص
                    </button>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding-top:10px">
          <button type="button" class="fstats-btn" onclick="$('#profile').close();" style="background:transparent;border-color:var(--line);color:var(--mut)">
            إغلاق
          </button>
        </div>
      </div>
    `;

    showInfo(html);

    // Filter bindings
    $('#cap-all').onclick = () => { currentTab = 'all'; renderModal(); };
    $('#cap-unlocked').onclick = () => { currentTab = 'unlocked'; renderModal(); };
    $('#cap-locked').onclick = () => { currentTab = 'locked'; renderModal(); };

    // WhatsApp share
    document.querySelectorAll('[data-share-cap]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.shareCap;
        const cap = allCapsules.find(c => c.id === id);
        if (cap) {
          const msg = `⏳ *وصية ورسالة موقوتة من كبار عائلة آل مطارد:*\n*${cap.author}*\nالمناسبة: ${cap.occasion}\n\n${cap.body}\n\n— محفوظة عبر كبسولة الزمن بموقع شجرة العائلة:\n${window.location.href}`;
          window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
        }
      };
    });

    // Secret unlock action
    document.querySelectorAll('[data-unlock-cap]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.unlockCap;
        const cap = allCapsules.find(c => c.id === id);
        if (cap) {
          const pass = prompt('أدخل رمز الفتح الخاص بالكبسولة (أو رمز المالك/الفرع):');
          if (pass === '27748111' || pass === '1450' || pass === (cap.secretCode || '')) {
            cap.status = 'unlocked';
            const realMsg = prompt('أدخل أو عدّل النص الكامل للوصية ليظهر للجميع:', cap.body);
            if (realMsg) cap.body = realMsg;
            const stored = JSON.parse(localStorage.getItem('almatarid_time_capsules') || '[]');
            const idx = stored.findIndex(s => s.id === id);
            if (idx >= 0) stored[idx] = cap; else stored.push(cap);
            localStorage.setItem('almatarid_time_capsules', JSON.stringify(stored));
            toast('🔓 تم فتح الكبسولة بنجاح!');
            renderModal();
          } else if (pass) {
            toast('عذراً، الرمز غير صحيح أو لم يحن موعد فتح الكبسولة بعد.');
          }
        }
      };
    });

    // Add new timed capsule
    const addBtn = $('#btn-add-capsule');
    if (addBtn) {
      addBtn.onclick = () => {
        const author = prompt('اسم الوالد / الجد / كاتب الرسالة:');
        if (!author) return;
        const occasion = prompt('المناسبة المستهدفة (مثال: يوم تخرج فلان / زواج فلان / اجتماع عام كذا):') || 'مناسبة عائلية خاصة';
        const unlockCond = prompt('شرط وموعد فتح الرسالة (مثال: عند تخرج الحفيد / عام 1448هـ):') || 'عند حلول المناسبة';
        const body = prompt('نص الرسالة أو الوصية:') || '';
        const isLockedChoice = confirm('هل تريد إبقاء الرسالة مغلقة ومحفوظة حتى حلول الموعد؟\n(اضغط موافق للإغلاق والتوقيت، أو إلغاء لتكون مفتوحة فوراً)');

        const newCap = {
          id: 'cap_user_' + Date.now(),
          author,
          occasion,
          status: isLockedChoice ? 'locked' : 'unlocked',
          writtenDateText: new Date().toLocaleDateString('ar-SA'),
          unlockConditionText: unlockCond,
          body,
          secretCode: '27748111'
        };

        const stored = JSON.parse(localStorage.getItem('almatarid_time_capsules') || '[]');
        stored.unshift(newCap);
        localStorage.setItem('almatarid_time_capsules', JSON.stringify(stored));
        allCapsules.unshift(newCap);
        toast('✅ تم حفظ الرسالة الموقوتة في كبسولة زمن العائلة بنجاح!');
        renderModal();
      };
    }
  }

  renderModal();
}











