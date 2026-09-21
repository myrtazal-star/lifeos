/* Сборка для публикации: каждое приложение становится самодостаточной папкой.
   Общий код подкладывается реальной копией (симлинк на хостинге не работает). */

import { cp, rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'docs');
const APPS = ['kapital', 'ritmo'];

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

  // версия кэша: при каждой сборке новая
  const swPath = join(out, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  await writeFile(swPath, sw.replace(/const VERSION = '([^']+)'/, `const VERSION = '$1-${stamp}'`));

  const files = await countFiles(out);
  console.log(`  ${app.padEnd(8)} → docs/${app}  (${files} файлов)`);
}

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

function landingPage() {
  return `<!doctype html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Мои приложения</title>
<meta name="theme-color" content="#0b0d10">
<link rel="stylesheet" href="./kapital/shared/css/base.css">
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

  <a class="tile" href="./kapital/">
    <img src="./kapital/icons/icon-192.png" alt="">
    <div>
      <h2>Kapital</h2>
      <p>Финансы: личные и по компании, песо и доллары, отчёты</p>
    </div>
  </a>

  <a class="tile" href="./ritmo/">
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
