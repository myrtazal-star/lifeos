/* Сборка для публикации: каждое приложение становится самодостаточной папкой.
   Общий код подкладывается реальной копией (симлинк на хостинге не работает). */

import { cp, rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'docs');
const APPS = ['milpa', 'ritmo'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

/* Метка сборки — попадает в имя кэша, чтобы у пользователей
   гарантированно подхватилась новая версия. */
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

for (const app of APPS) {
  const src = resolve(ROOT, 'apps', app);
  const out = resolve(DIST, app);

  await cp(src, out, {
    recursive: true,
    dereference: true,                      // симлинк shared → настоящие файлы
    filter: (p) => !/\/\.(DS_Store|git)/.test(p),
  });

  /* Метка сборки внутри приложения: человек должен видеть, какая версия
     у него стоит, иначе «я не вижу, что поменялось» не проверить. */
  await writeFile(join(out, 'version.js'),
    `export const BUILD = '${stamp}';\nexport const BUILT_AT = '${new Date().toISOString()}';\n`);

  // версия кэша: при каждой сборке новая
  const swPath = join(out, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  await writeFile(swPath, sw.replace(/const VERSION = '([^']+)'/, `const VERSION = '$1-${stamp}'`));

  // Лента новостей должна лежать внутри папки приложения: офлайн-кэш
  // не может обслуживать файлы выше своей области.
  if (app === 'milpa') {
    try {
      await mkdir(resolve(out, 'data'), { recursive: true });
      await cp(resolve(ROOT, 'data', 'news.json'), resolve(out, 'data', 'news.json'));
    } catch {
      console.warn('  (ленты новостей нет — запустите node tools/fetch-news.mjs)');
    }
  }

  const files = await countFiles(out);
  console.log(`  ${app.padEnd(8)} → docs/${app}  (${files} файлов)`);
}

/* Приложение Milpa раньше называлось Kapital и жило по другому адресу.
   Оставляем переадресацию, чтобы старая ссылка и уже установленный значок
   не вели в никуда. Можно удалить, когда старый адрес перестанет
   использоваться. */
await mkdir(resolve(DIST, 'kapital'), { recursive: true });
await writeFile(resolve(DIST, 'kapital', 'index.html'), legacyRedirect('../milpa/'));
console.log('  переадресация → docs/kapital');

/* Страница-указатель: откуда ставить оба приложения. */
await writeFile(resolve(DIST, 'index.html'), landingPage());

/* GitHub Pages иначе прогоняет всё через Jekyll и выкидывает файлы с «_» */
await writeFile(resolve(DIST, '.nojekyll'), '');
console.log(`  указатель → docs/index.html`);

await writeFile(resolve(DIST, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: same-origin',
  '  X-Frame-Options: SAMEORIGIN',
  '',
  '/*/sw.js',
  '  Cache-Control: no-cache',
  '  Service-Worker-Allowed: /',
  '',
  '/*/index.html',
  '  Cache-Control: no-cache',
  '',
].join('\n'));

console.log(`\n  Готово. Метка сборки: ${stamp}\n`);

async function countFiles(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) n++;
  }
  return n;
}

function legacyRedirect(target) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Приложение переехало</title>
<meta http-equiv="refresh" content="0; url=${target}">
<style>body{margin:0;display:grid;place-items:center;min-height:100dvh;
background:#0b0d10;color:#e8ecf2;font:16px -apple-system,system-ui,sans-serif;text-align:center}
a{color:#34d399}</style>
</head>
<body>
<div>
  <p>Приложение теперь называется <b>Milpa</b>.</p>
  <p><a href="${target}">Открыть</a></p>
</div>
<script>
  // снимаем старый офлайн-кэш, иначе он продолжит открывать прежнюю версию
  navigator.serviceWorker?.getRegistrations?.().then(rs => rs.forEach(r => {
    if (r.scope.includes('/kapital/')) r.unregister();
  }));
  location.replace('${target}');
</script>
</body>
</html>`;
}

function landingPage() {
  return `<!doctype html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Мои приложения</title>
<meta name="theme-color" content="#0b0d10">
<link rel="stylesheet" href="./milpa/shared/css/base.css">
<style>
  .app { padding: 28px 20px; gap: 18px; }
  .hero { text-align: center; padding: 24px 0 8px; }
  .hero h1 { font-size: 26px; }
  .hero p { color: var(--text-2); font-size: 14.5px; margin-top: 8px; }
  .tile { display: flex; align-items: center; gap: 15px; padding: 18px;
          border-radius: var(--r-lg); background: var(--surface);
          border: 1px solid var(--line-soft); }
  .tile img { width: 58px; height: 58px; border-radius: 15px; }
  .tile h2 { font-size: 17px; }
  .tile--milpa h2 { color: #34d399; }
  .tile--ritmo h2 { color: #8b6dff; }
  .tile p { color: var(--text-2); font-size: 13.5px; margin-top: 3px; }
  .how { background: var(--surface-2); border-radius: var(--r-lg); padding: 18px;
         font-size: 14px; color: var(--text-2); line-height: 1.6; }
  .how b { color: var(--text); }
</style>
</head>
<body>
<div class="app">
  <div class="hero">
    <h1>Мои приложения</h1>
    <p>Откройте нужное и добавьте на экран «Домой» — дальше работают как обычные приложения, в том числе без интернета.</p>
  </div>

  <a class="tile tile--milpa" href="./milpa/">
    <img src="./milpa/icons/icon-192.png" alt="">
    <div>
      <h2>Milpa</h2>
      <p>Финансы: личные и по компании, песо и доллары, отчёты</p>
    </div>
  </a>

  <a class="tile tile--ritmo" href="./ritmo/">
    <img src="./ritmo/icons/icon-192.png" alt="">
    <div>
      <h2>Ritmo</h2>
      <p>Привычки, режим дня и дисциплина: отметки, серии, прогресс</p>
    </div>
  </a>

  <div class="how">
    <b>Как поставить на iPhone:</b> откройте приложение в Safari → кнопка «Поделиться» внизу → «На экран «Домой».<br><br>
    <b>На Android:</b> откройте в Chrome → меню «⋮» → «Установить приложение».
  </div>
</div>
</body>
</html>`;
}
