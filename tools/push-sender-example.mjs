// push-sender-example.mjs — مثال خادم إرسال إشعارات Web Push (E-01)
// ---------------------------------------------------------------------------
// هذا مثال تشغيلي لا جزء من التطبيق: يُشغَّل على جهاز/خادم خارجي، لا في المتصفح.
// يقرأ الاشتراكات من جدول push_subscriptions ويرسل لها عبر Web Push.
// متطلبات التشغيل:
//   1) npm install web-push
//   2) متغيرات البيئة (لا تُكتب أي مفاتيح في هذا الملف أبداً):
//        SUPABASE_URL            مثال: https://xxxx.supabase.co
//        SUPABASE_SERVICE_KEY    مفتاح service_role (سرّي — يبقى على الخادم فقط)
//        VAPID_PUBLIC_KEY        المفتاح العام (نفسه في js/app.js)
//        VAPID_PRIVATE_KEY       المفتاح الخاص (في ملف منفصل سلّمه المنسق لعمر)
//        VAPID_SUBJECT           مثال: mailto:owner@example.com
//   3) التشغيل: node tools/push-sender-example.mjs '{"title":"...","body":"..."}'
// ملاحظات:
//   - الاشتراكات المنتهية (410/404 من خدمة الدفع) تُحذف تلقائياً من الجدول.
//   - بلا هذا الخادم لا يصل أي إشعار أبداً — التطبيق يجمع الاشتراكات فقط.
// ---------------------------------------------------------------------------
import webpush from 'web-push';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT })) {
  if (!v) { console.error('missing env: ' + k); process.exit(1); }
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const payload = JSON.parse(process.argv[2] || '{}');
if (!payload.title && !payload.body) { console.error('usage: node push-sender-example.mjs \'{"title":"...","body":"..."}\''); process.exit(1); }

const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth`, {
  headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
});
if (!res.ok) { console.error('fetch subscriptions failed:', res.status); process.exit(1); }
const subs = await res.json();
let sent = 0, failed = 0, pruned = 0;
for (const s of subs) {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
    sent++;
  } catch (e) {
    failed++;
    if (e.statusCode === 410 || e.statusCode === 404) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
        method: 'DELETE', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      pruned++;
    } else console.error('send failed:', e.statusCode || e.message);
  }
}
console.log(`done: sent=${sent} failed=${failed} pruned=${pruned} total=${subs.length}`);
