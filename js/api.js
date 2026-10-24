// كل التواصل مع Supabase يمر من هنا. لا قراءة ولا كتابة مباشرة على الجداول.
async function rpc(name, args) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(`${CFG.URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: CFG.KEY, Authorization: `Bearer ${CFG.KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: ctl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم، حاول مرة أخرى');
    throw new Error('تعذر الاتصال بالخادم، تحقق من اتصال الإنترنت وحاول مجددًا'); /* ann61: ترجمة خطأ الشبكة بدل TypeError الإنجليزي */
  } finally { clearTimeout(timer); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `${name}: ${res.status}`); }
  return res.json();
}
