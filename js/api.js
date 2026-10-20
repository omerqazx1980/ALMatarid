// كل التواصل مع Supabase يمر من هنا. لا قراءة ولا كتابة مباشرة على الجداول.
async function rpc(name, args) {
  const res = await fetch(`${CFG.URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: CFG.KEY, Authorization: `Bearer ${CFG.KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `${name}: ${res.status}`); }
  return res.json();
}
