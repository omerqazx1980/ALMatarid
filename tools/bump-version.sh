#!/usr/bin/env bash
# bump-version.sh — توحيد إصدار الكاش (M-02)
# يضبط كل معاملات ?v= في index.html واسم كاش service worker في sw.js على رمز واحد.
# الرمز = مختصر SHA للالتزام الحالي (HEAD) وقت التشغيل؛ يُشغَّل قبل كل دفع
# ويُلتزم معه، فيتغير الرمز مع كل دفعة وتبطل كل النسخ المحفوظة معاً.
# (لا يمكن أن يساوي الرمز SHA الالتزام نفسه لأنه جزء من محتواه — لذا هو SHA
#  آخر التزام كود قبل الرفع، وهو ما يكفي لتمييز كل دفعة عن سابقتها.)
# الاستخدام: bash tools/bump-version.sh   (من جذر المستودع)
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="$(git rev-parse --short HEAD)"
echo "bump-version: HEAD=$SHA"
sed -i -E "s/\?v=[A-Za-z0-9_-]+/?v=$SHA/g" index.html
sed -i -E "s/const C = 'almatarid-[^']*';/const C = 'almatarid-$SHA';/" sw.js
echo "--- index.html:"; grep -o '?v=[A-Za-z0-9_-]*' index.html | sort | uniq -c
echo "--- sw.js:"; grep -o "almatarid-[A-Za-z0-9_-]*" sw.js
