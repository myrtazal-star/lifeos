/* Проверка офлайн-режима: ставим приложение, отключаем сеть, перезагружаем. */

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
if (!url) { console.error('укажите адрес'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

// ждём, пока офлайн-кэш возьмёт страницу под контроль
const ready = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'нет поддержки';
  const reg = await navigator.serviceWorker.ready;
  for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) {
    await new Promise(r => setTimeout(r, 250));
  }
  const names = await caches.keys();
  return { активен: !!reg.active, управляет: !!navigator.serviceWorker.controller, кэши: names };
});
console.log('  офлайн-кэш:', JSON.stringify(ready, null, 0));

const cachedCount = await page.evaluate(async () => {
  const names = await caches.keys();
  let n = 0;
  for (const k of names) n += (await (await caches.open(k)).keys()).length;
  return n;
});
console.log(`  файлов в кэше: ${cachedCount}`);

// рвём сеть и перезагружаем
await page.setOfflineMode(true);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 1500));

const state = await page.evaluate(() => ({
  вкладок: document.querySelectorAll('.tab').length,
  заголовок: document.querySelector('.topbar__title')?.textContent ?? '',
  карточек: document.querySelectorAll('.card').length,
}));
console.log('  без сети:', JSON.stringify(state, null, 0));

await page.screenshot({ path: `.shots/offline-${new URL(url).pathname.split('/').filter(Boolean).pop()}.png` });
await browser.close();

const ok = state.вкладок === 4 && state.карточек > 0 && !errors.length;
console.log(ok ? '  РАБОТАЕТ БЕЗ ИНТЕРНЕТА\n' : `  ПРОБЛЕМА: ${errors.join('; ') || 'экран не построился'}\n`);
process.exit(ok ? 0 : 1);
