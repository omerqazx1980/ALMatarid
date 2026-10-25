/* PWA: تسجيل عامل الخدمة + تلميح التثبيت (آيفون: مشاركة ← إضافة للشاشة الرئيسية؛ أندرويد: زر تثبيت).
   لا يظهر بسطح المكتب، ولا داخل تطبيق Capacitor، ولا إذا كان مثبتًا أصلًا */
(() => {
  const inApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) document.documentElement.classList.add('pwa-standalone');
  if ('serviceWorker' in navigator && !inApp && (location.protocol === 'https:' || location.hostname === 'localhost'))
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  if (inApp || standalone) return;
  const KEY = 'pwaHintDismissed';
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iOSSafari = iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line\//.test(ua);
  const share = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  function show(html, onInstall) {
    const d = document.createElement('div'); d.id = 'pwa-hint'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'تثبيت التطبيق');
    d.innerHTML = `<img src="icons/icon-192.png" alt="" width="40" height="40"><div class="ph-t">${html}</div>${onInstall ? '<button class="ph-i" type="button">ثبّت التطبيق</button>' : ''}<button class="ph-x" type="button" aria-label="إغلاق">✕</button>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); try { localStorage.setItem(KEY, '1'); } catch (e) {} };
    d.querySelector('.ph-x').onclick = close;
    if (onInstall) d.querySelector('.ph-i').onclick = () => { onInstall(); close(); };
  }
  if (iOSSafari) { window.addEventListener('load', () => setTimeout(() => show(`<b>ثبّت تطبيق آل مطارد</b><span>لتثبيت التطبيق: اضغط زر المشاركة ${share} ثم «إضافة إلى الشاشة الرئيسية»</span>`), 1200)); return; }
  window.addEventListener('beforeinstallprompt', ev => {
    if (!window.matchMedia('(pointer: coarse)').matches) return; /* سطح المكتب: لا تلميح */
    ev.preventDefault();
    show('<b>ثبّت تطبيق آل مطارد</b><span>افتحه من الشاشة الرئيسية مثل أي تطبيق</span>', () => ev.prompt());
  });
})();
