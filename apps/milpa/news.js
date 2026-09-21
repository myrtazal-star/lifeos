/* Вкладка «Новости»: курс доллара и что произошло в финансах за день.
   Данные лежат готовым файлом рядом с приложением — его раз в сутки
   обновляет задание на GitHub. Своего сервера нет, поэтому и ломаться нечему. */

import { el, icons, emptyState, haptic } from './shared/js/ui.js';
import { formatDate, toISODate } from './shared/js/format.js';
import * as D from './data.js';

const FEED_URL = './data/news.json';

const state = {
  data: null,
  loading: false,
  failed: false,
  loadedAt: null,
};

/** Загрузка ленты. rerender вызывается, когда данные приехали. */
export async function loadNews(rerender, { force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.failed = false;
  // Первый вызов случается прямо во время сборки каркаса приложения,
  // когда перерисовывать ещё нечего — поэтому откладываем на следующий тик.
  queueMicrotask(() => rerender?.());

  try {
    const res = await fetch(FEED_URL, { cache: force ? 'reload' : 'default' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
    state.loadedAt = Date.now();
    applyRate(state.data);
  } catch {
    // офлайн или файла ещё нет — показываем то, что уже есть
    state.failed = true;
  } finally {
    state.loading = false;
    rerender?.();
  }
}

/** Подставить свежий курс в настройки, если пользователь не задал свой. */
function applyRate(data) {
  const rate = data?.fx?.usdMxn;
  if (!rate || !Number.isFinite(rate)) return;
  const s = D.S().settings;
  if (s.fxAuto === false) return;                      // курс правили вручную
  if (Math.abs((s.fx?.USD ?? 0) - rate) < 0.0001) return;

  D.store.update(st => {
    st.settings.fx.USD = rate;
    st.settings.fxUpdated = data.fx.date || new Date().toISOString().slice(0, 10);
    st.settings.fxSource = data.fx.source || null;
  });
}

export function hasNews() { return !!state.data?.items?.length; }
export function currentFx() { return state.data?.fx || null; }

/* ─────────── Экран ─────────── */

export function newsView(t, lang, rerender) {
  // первая отрисовка запускает загрузку
  if (!state.data && !state.loading && !state.failed) {
    loadNews(rerender);
  }

  const nodes = [];
  const fx = state.data?.fx;

  /* Курс доллара — то, что влияет на деньги прямо сейчас */
  if (fx) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [
        el('div.card__title', { text: t('news_fx') }),
        el('button.btn.btn--sm.btn--ghost', {
          text: t('news_refresh'),
          onclick: () => { haptic(); loadNews(rerender, { force: true }); },
        }),
      ]),
      el('div.hstack', { style: { alignItems: 'baseline', gap: '8px' } }, [
        el('div.amount.amount--xl.num', { text: fx.usdMxn.toFixed(4) }),
        el('div.small.muted', { text: t('news_fx_unit') }),
      ]),
      el('div.tiny.muted-3', { style: { marginTop: '6px' },
        text: `${fx.source}${fx.official ? '' : ' · ' + t('news_fx_unofficial')}${fx.date ? ' · ' + fx.date : ''}` }),
      D.S().settings.fxAuto === false && el('div.tiny', {
        style: { marginTop: '8px', color: 'var(--warn)' },
        text: t('news_fx_manual', { v: (D.S().settings.fx?.USD ?? 0) }),
      }),
    ]));
  }

  /* Состояния загрузки */
  if (state.loading && !state.data) {
    nodes.push(el('div.empty', {}, [
      el('div.empty__icon', { text: '⏳' }),
      el('div.empty__title', { text: t('news_loading') }),
    ]));
    return nodes;
  }

  if (!state.data) {
    nodes.push(emptyState('📰', t('news_none'), t('news_none_hint'),
      el('button.btn.btn--primary', { text: t('news_refresh'),
        onclick: () => loadNews(rerender, { force: true }) })));
    return nodes;
  }

  if (state.failed) {
    nodes.push(el('div.card.card--flat', {}, [
      el('p.small', { style: { color: 'var(--warn)' }, text: '⚠️ ' + t('news_offline') }),
    ]));
  }

  /* Когда обновлялось */
  const upd = state.data.updatedAt;
  nodes.push(el('div.hstack', { style: { padding: '0 2px' } }, [
    el('div.tiny.muted-3', {
      text: t('news_updated', { d: formatDate(upd.slice(0, 10), lang, { day: 'numeric', month: 'long' }),
                                h: upd.slice(11, 16) }),
    }),
    el('div.spacer'),
    !fx && el('button.btn.btn--sm.btn--ghost', { text: t('news_refresh'),
      onclick: () => loadNews(rerender, { force: true }) }),
  ]));

  /* Новости по дням */
  const groups = new Map();
  for (const item of state.data.items) {
    const day = (item.date || upd).slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }

  const today = toISODate();
  for (const [day, items] of groups) {
    nodes.push(el('div.section-title', {
      text: day === today ? t('today') : formatDate(day, lang, { day: 'numeric', month: 'long' }),
    }));
    nodes.push(el('div.card', {}, [
      el('div.list', {}, items.map(item => newsRow(item, lang))),
    ]));
  }

  nodes.push(el('div.tiny.muted-3', {
    style: { textAlign: 'center', padding: '10px 16px', lineHeight: '1.5' },
    text: t('news_sources_note'),
  }));

  return nodes;
}

function newsRow(item, lang) {
  const time = item.date ? item.date.slice(11, 16) : '';
  return el('a.row', {
    href: item.link, target: '_blank', rel: 'noopener noreferrer',
    style: { color: 'inherit' },
  }, [
    el('div.row__main', {}, [
      el('div', {
        style: { fontSize: '14.5px', fontWeight: '560', lineHeight: '1.35',
                 display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical',
                 overflow: 'hidden' },
        text: item.title,
      }),
      el('div.tiny.muted-3', { style: { marginTop: '5px' },
        text: [item.source, time].filter(Boolean).join(' · ') }),
    ]),
    el('span.muted-3', { style: { flex: '0 0 auto' }, html: icons.chevR }),
  ]);
}
