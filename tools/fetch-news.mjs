/* Ежедневный сбор новостей и курса доллара.
   Запускается по расписанию на GitHub и кладёт готовый файл в data/news.json,
   который приложение просто читает. Своего сервера не нужно.

   Запуск вручную: node tools/fetch-news.mjs */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'data', 'news.json');
const MAX_ITEMS = 45;
const TIMEOUT = 15000;

/* topical: лента уже про финансы — брать всё подряд.
   Иначе отбираем по ключевым словам. */
const FEEDS = [
  { name: 'El Economista', lang: 'es', topical: false,
    url: 'https://www.eleconomista.com.mx/rss/ultimas-noticias' },
  { name: 'Expansión',     lang: 'es', topical: true,
    url: 'https://expansion.mx/rss/economia' },
  { name: 'El Financiero', lang: 'es', topical: false,
    url: 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml' },
  { name: 'Investing MX',  lang: 'es', topical: true,
    url: 'https://mx.investing.com/rss/news_1.rss' },
  { name: 'WSJ Markets',   lang: 'en', topical: true,
    url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
];

const KEYWORDS = [
  'banco', 'banca', 'bancari', 'peso', 'dólar', 'dolar', 'banxico', 'sat ',
  'inflaci', 'tasa', 'crédito', 'credito', 'fintech', 'bolsa', 'mercado',
  'economía', 'economia', 'impuesto', 'hacienda', 'fiscal', 'inversión',
  'inversion', 'remesas', 'deuda', 'financier', 'divisa', 'bmv', 'cetes',
  'bank', 'markets', 'rate', 'inflation', 'fed', 'stocks', 'bonds', 'tariff',
];

/* ─────────── Разбор RSS без сторонних библиотек ─────────── */

const strip = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ')
  .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : '';
};

function parseFeed(xml, feed) {
  const out = [];
  // RSS <item> и Atom <entry> — форма разная, суть одна
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];

  for (const b of blocks) {
    const title = tag(b, 'title');
    if (!title) continue;

    let link = tag(b, 'link');
    if (!link) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? href[1] : '';
    }
    if (!link) continue;

    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const d = dateRaw ? new Date(dateRaw) : null;

    out.push({
      title,
      link: link.trim(),
      date: d && !isNaN(d) ? d.toISOString() : null,
      source: feed.name,
      lang: feed.lang,
    });
  }
  return out;
}

function isRelevant(item, feed) {
  if (feed.topical) return true;
  const t = item.title.toLowerCase();
  return KEYWORDS.some(k => t.includes(k));
}

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MilpaNews/1.0)' },
      redirect: 'follow',
      ...opts,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  } finally { clearTimeout(timer); }
}

/* ─────────── Курс доллара ─────────── */

async function fetchRate() {
  // Официальный курс Banxico (FIX) — если задан бесплатный токен
  const token = process.env.BANXICO_TOKEN;
  if (token) {
    try {
      const res = await get(
        'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno?token=' + token);
      const j = await res.json();
      const d = j?.bmx?.series?.[0]?.datos?.[0];
      if (d?.dato) {
        return { usdMxn: Number(d.dato), date: isoFromDDMMYYYY(d.fecha),
                 source: 'Banxico (FIX)', official: true };
      }
    } catch (e) { console.warn('  Banxico недоступен:', e.message); }
  }

  // Запасной источник — курс рынка, не официальный
  try {
    const res = await get('https://open.er-api.com/v6/latest/USD');
    const j = await res.json();
    if (j?.rates?.MXN) {
      return { usdMxn: Number(j.rates.MXN.toFixed(4)),
               date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10),
               source: 'exchangerate-api', official: false };
    }
  } catch (e) { console.warn('  запасной источник курса недоступен:', e.message); }

  return null;
}

function isoFromDDMMYYYY(s) {
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/* ─────────── Сборка ─────────── */

console.log('\n── Сбор новостей ──');
const collected = [];

for (const feed of FEEDS) {
  try {
    const res = await get(feed.url);
    const xml = await res.text();
    const items = parseFeed(xml, feed).filter(i => isRelevant(i, feed));
    collected.push(...items);
    console.log(`  ${feed.name.padEnd(15)} ${String(items.length).padStart(3)} подходящих`);
  } catch (e) {
    console.warn(`  ${feed.name.padEnd(15)} не ответил: ${e.message}`);
  }
}

// убираем повторы: одна и та же новость приходит из разных лент
const seen = new Set();
const unique = [];
for (const it of collected) {
  const key = it.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 60);
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(it);
}

unique.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const items = unique.slice(0, MAX_ITEMS);

console.log('\n── Курс доллара ──');
const fx = await fetchRate();
if (fx) console.log(`  ${fx.usdMxn} песо за доллар · ${fx.source} · ${fx.date}`);
else console.log('  получить не удалось');

/* Если сбор полностью провалился — не затираем вчерашний файл пустотой */
if (!items.length) {
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    if (prev.items?.length) {
      console.log('\n  Ни одна лента не ответила — оставляем вчерашние данные.\n');
      process.exit(0);
    }
  } catch { /* файла ещё нет */ }
}

await mkdir(resolve(ROOT, 'data'), { recursive: true });
await writeFile(OUT, JSON.stringify({
  updatedAt: new Date().toISOString(),
  fx,
  items,
}, null, 1));

console.log(`\n  Записано: ${items.length} новостей → data/news.json\n`);
