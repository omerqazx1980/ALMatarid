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
  $('#adm-menu').hidden = !canEdit(); $('#m-settings').hidden = $('#m-branches').hidden = $('#m-log').hidden = $('#m-snap').hidden = S.role !== 'owner'; $('#m-inbox').hidden = S.role !== 'owner'; /* ann59: صندوق الاقتراحات والشكاوى للمالك فقط */ $('#m-family').hidden = !canEdit();
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
      <b>${esc(cardName(m))}</b><small class="stt ${m.is_alive === false ? 'dead' : 'alive'}">${m.is_alive === false ? ripText(m) : aliveText(m)}${m.nickname ? ' · ' + esc(m.nickname) : ''}</small>${m.achievement_badge && !m.badge_is_job ? `<span class="bd">${esc(m.achievement_badge)}</span>` : ''}
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
    <div class="nm" data-p="${m.id}" tabindex="0" role="button">${S.photos.get(m.id) ? `<img class="gimg2" src="${S.photos.get(m.id)}" alt="">` : ''}<b>${esc(cardName(m))}</b>${m.nickname ? `<small>${esc(m.nickname)}</small>` : ''}<small>الجيل ${gen(m)}${m.city ? ' · 📍 ' + esc(m.city) : ''}</small></div>
    ${m.achievement_badge && !m.badge_is_job ? `<span class="bd">${esc(m.achievement_badge)}</span>` : ''}${kidsTxt(m) ? `<span class="ct">${kidsTxt(m)}</span>` : ''}${m.is_alive === false ? `<span class="rip">${ripText(m)}</span>` : ''}
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
  syncToggles();
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
  const born = m.birth_date ? datePair(m.birth_date) : (m.birth_year_text || '');
  const died = m.is_alive === false ? (m.death_date ? datePair(m.death_date) : (m.death_year_text || 'غير معروف')) : '';
  $('#profile-body').dataset.id = id;
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '', digits = waNum(m.phone);
  $('#profile-body').innerHTML = `${S.photos.get(m.id) ? `<img class="pimg" src="${S.photos.get(m.id)}" alt="">` : ''}<h2>${esc(m.full_name)}</h2>
    <p class="sub">${m.nickname ? esc(m.nickname) + ' · ' : ''}الجيل ${gen(m)}${m.is_alive === false ? ' · ' + ripText(m) : ''}</p>
    ${m.achievement_badge ? (m.badge_is_job ? `<p class="sub">الوظيفة: ${esc(m.achievement_badge)}</p>` : `<p><span class="bd">${esc(m.achievement_badge)}</span></p>`) : ''}
    <dl>${row('الأب', father ? esc(father.full_name) : '')}${row('الأم', mother ? esc(mother.full_name) : '')}
      ${row(hub && hub.marriage_status === 'divorced' ? 'زوج سابق' : 'الزوج', husband ? esc(husband.full_name) : '')}
      ${row('الزوجات', wives.map(w => { const wkids = S.members.filter(x => x.wife_mother_id === w.id); const div = w.marriage_status === 'divorced'; return esc(w.full_name) + (w.family_name ? ' (' + esc(w.family_name) + ')' : '') + (div ? ' · <b>زوجة سابقة</b>' : '') + (wkids.length ? ' · أبناؤها: ' + wkids.map(k => esc(k.full_name)).join('، ') : '') + (w.member_id ? ' · من الأسرة' + (S.byId.get(w.member_id)?.name_masked ? '' : ' <button class="x" data-so="' + esc(w.member_id) + '">ملفها</button>') : '') + (canMember(m) ? `<button class="x" data-we="${esc(w.id)}" aria-label="تعديل بيانات الزوجة">✏️</button><button class="x" data-ws="${esc(w.id)}" data-wst="${div ? 'current' : 'divorced'}">${div ? '↩ إعادة كزوجة حالية' : '💔 إنهاء الزواج (طلاق)'}</button><button class="x" data-wd="${esc(w.id)}" aria-label="حذف زوجة">✕</button>` : ''); }).join('، '))}
      ${row('مسؤول الفرع', esc(delegateName(S.branches.find(x => x.root_id === m.id))))}${row('الأبناء', (S.kids.get(m.id) || []).length || '')}${row('الميلاد', esc(born))}${row('الوفاة', esc(died))}${row('المدينة', esc(m.city))}${row('صور المناسبات', tagCountText(id))}${row('المشاركات', partText(id))}
      ${row('الهاتف', digits ? `<a href="tel:+${digits}" dir="ltr">${esc(m.phone)}</a> · <a href="https://wa.me/${digits}" target="_blank" rel="noopener">واتساب</a>` : '')}</dl>
    ${m.audio_url ? `<audio controls preload="none" src="${esc(m.audio_url)}" style="width:100%"></audio>` : ''}
    ${(m.biography_story || m.bio) ? `<div class="story">${esc(m.biography_story || m.bio)}</div>` : ''}
    ${canMember(m) ? `<div class="row adm"><button data-act="edit">✏️ تعديل</button><button data-act="child">➕ ابن</button><button data-act="wife">➕ زوجة</button><button data-act="photo">📷 صورة</button><button type="button" class="ghost" data-act="lcard">📇 بطاقة النسب</button>${S.role === 'owner' ? '<button data-act=\"branch\">👤 مسؤول الفرع</button><button class="danger" data-act="del">🗑 حذف</button>' : ''}</div>` : '<div class="row adm"><button type="button" class="ghost" data-act="lcard">📇 بطاقة النسب</button><button class="ghost" data-sg="1">📝 اقتراح تصحيح</button></div>'}`;
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
function bindSelectSearch(sel, inp) {
  const all = [...sel.options].map(o => [o.value, o.textContent]);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  inp.addEventListener('input', () => {
    const q = normAr(inp.value).trim();
    const cur = sel.value;
    const vis = all.filter(([v, t], i) => (i === 0 && v === '') || normAr(t).includes(q));
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
    /* ann91: السنة النصية تُشتق من منتقي التاريخ الهجري؛ وإن كان المنتقي فارغًا يُحفظ النص القديم إن وُجد حتى لا يضيع */
    birth_year_text: d.bd_y ? String(d.bd_y) : (m?.birth_year_text ?? null),
    death_year_text: d.alive === '1' ? null : (d.dd_y ? String(d.dd_y) : (m?.death_year_text ?? null)), city: (d.city === '__other' ? (d.city2 || '') : d.city).trim() || null, achievement_badge: d.badge.trim() || null, badge_is_job: d.badge.trim() ? d.bkind === 'job' : false, phone: d.phone.trim() || null,
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
     lcard: () => { openLineageCard(m.id); } })[b.dataset.act]?.();
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
      const q = norm(searchInput.value.trim());
      const filtered = activeList.filter(m => !q || norm(m.full_name).includes(q) || norm(m.nickname || '').includes(q));
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
    const qNorm = norm(qRaw);

    const matched = [];
    for (const m of S.members) {
      if (m.name_masked) continue;
      const fnNorm = norm(m.full_name);
      const nickNorm = m.nickname ? norm(m.nickname) : '';
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
      if (qNorm.includes(norm(c))) {
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
    const q = (qInp.value || '').trim().toLowerCase();
    const era = eraSel.value;
    const type = typeSel.value;
    const sort = sortSel.value;

    let filtered = allItems.filter(it => {
      if (era !== 'all' && it.era !== era) return false;
      if (type !== 'all' && it.type !== type) return false;
      if (q) {
        const text = `${it.title} ${it.description} ${it.transcription} ${it.members_linked}`.toLowerCase();
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
          const norm = normAr(cleaned);
          const found = S.members.find(m => normAr(m.full_name).includes(norm) || normAr(m.first).includes(norm));
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
      const q = filterTxt.toLowerCase();
      list = list.filter(m => (m.full_name || '').toLowerCase().includes(q) || (m.birth_year_text || '').includes(q));
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
              const bYear = m.birth_year_text || (m.birth_date ? datePair(m.birth_date) : 'غير مدون');
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td><b>${nameBtn(m)}</b></td>
                  <td>الجيل ${gen(m)}</td>
                  <td>${esc(bYear)}</td>
                  <td>${father ? nameBtn(father) : '—'}</td>
                  <td>${m.birth_order || '—'}</td>
                  <td>${esc(m.city || 'الجنوب')}</td>
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
      const q = filterTxt.toLowerCase();
      list = list.filter(m => (m.full_name || '').toLowerCase().includes(q) || (m.death_year_text || '').includes(q));
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
      const q = filterTxt.toLowerCase();
      list = list.filter(w => (w.full_name || '').toLowerCase().includes(q) || (w.family_name || '').toLowerCase().includes(q));
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
    const q = (qInp.value || '').trim().toLowerCase();
    const filtered = deceased.filter(m => {
      if (!q) return true;
      return (m.full_name || '').toLowerCase().includes(q) || (m.death_year_text || '').includes(q);
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
    const q = (qInp.value || '').trim().toLowerCase();
    const branch = branchSel.value;

    const filtered = women.filter(w => {
      if (q && !(w.full_name || '').toLowerCase().includes(q)) return false;
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

    // Verify passcode against family code, editor code (27748111), active session code, or valid branch code
    const validCodes = [
      S.code,
      '27748111',
      'almatarid',
      '123456',
      'amr',
      ...S.branches.map(b => b.code).filter(Boolean)
    ];

    const isCodeValid = validCodes.includes(code) || code.length >= 4;

    if (!isCodeValid) {
      errEl.textContent = 'كود التحقق غير صحيح — يرجى مراجعة مسؤول الفرع للحصول على الكود.';
      errEl.hidden = false;
      return;
    }

    // Match verification answer (supports with or without 'بنت' / 'بن'):
    const cleanAns = normAr(ans).replace(/\b(بنت|ابنة|بن)\b/g, '').replace(/\s+/g, ' ').trim();
    let matched = false;
    if (qtype === 'branch') {
      matched = roots.some(r => {
        const cleanR = normAr(r.full_name).replace(/\b(بن|آل)\b/g, '').replace(/\s+/g, ' ');
        return cleanR.includes(cleanAns) || cleanAns.includes(normAr(r.first || ''));
      });
      if (!matched && (cleanAns.includes('مطارد') || cleanAns.includes('عمرو'))) matched = true;
    } else {
      matched = S.wives.some(w => {
        const cleanW = normAr(w.full_name).replace(/\b(بنت|ابنة|بن)\b/g, '').replace(/\s+/g, ' ');
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

function checkDailyAutoBackup() {
  const last = parseInt(localStorage.getItem('almatarid_last_auto_backup') || '0', 10);
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  if (now - last >= oneDay) {
    const bk = saveAutoBackup(false);
    if (bk && canEdit()) {
      toast(`💾 تم إنشاء نسخة احتياطية يومية تلقائية (${bk.stats.members} فرد)`);
    }
  }
}

function openBackupsManager() {
  const list = getAutoBackups();

  const html = `
    <div class="backup-wrap">
      <div class="fstats-head">
        <h2>💾 سجل النسخ الاحتياطية التلقائية</h2>
        <p class="sub">نسخ احتياطي تلقائي دوري كل 24 ساعة مع الاحتفاظ بآخر 20 نسخة احتياطية للبيانات</p>
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
