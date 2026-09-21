/* Каркас приложения: верхняя панель, экраны-вкладки, нижняя навигация.
   Оба приложения строятся на нём — поэтому ощущаются как одна система. */

import { el, mount, icons, haptic } from './ui.js';

export function createShell({ root, tabs, onTabChange }) {
  const titleNode = el('div.topbar__title');
  const topbarExtra = el('div.hstack');
  const topbar = el('header.topbar', {}, [titleNode, el('div.spacer'), topbarExtra]);
  const screen = el('main.screen', { id: 'screen' });

  const tabbarInner = el('div.tabbar__inner');
  const tabbar = el('nav.tabbar', { 'aria-label': 'Разделы' }, [tabbarInner]);

  const buttons = new Map();
  for (const tab of tabs) {
    const btn = el('button.tab', {
      type: 'button',
      onclick: () => { haptic(); go(tab.id); },
    }, [
      el('span', { html: icons[tab.icon] || '' }),
      el('span', { text: tab.label }),
    ]);
    buttons.set(tab.id, btn);
    tabbarInner.append(btn);
  }

  const app = el('div.app', {}, [topbar, screen]);
  mount(root, [app, tabbar]);

  let current = null;

  function go(id, opts = {}) {
    const tab = tabs.find(t => t.id === id) || tabs[0];
    const changed = current !== tab.id;
    current = tab.id;

    for (const [tid, btn] of buttons) {
      if (tid === tab.id) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }

    render();

    if (changed && !opts.silent) {
      screen.scrollTop = 0;
      window.scrollTo(0, 0);
      location.hash = '#' + tab.id;
      onTabChange?.(tab.id);
    }
  }

  /** Перерисовать текущий экран (вызывается при любом изменении данных). */
  function render() {
    const tab = tabs.find(t => t.id === current);
    if (!tab) return;
    titleNode.textContent = tab.title ?? tab.label;
    mount(topbarExtra, tab.actions?.() ?? []);
    mount(screen, tab.view());
  }

  /** Обновить подписи вкладок после смены языка. */
  function relabel() {
    for (const tab of tabs) {
      const btn = buttons.get(tab.id);
      if (btn) btn.lastChild.textContent = tab.label;
    }
    render();
  }

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id && id !== current && tabs.some(t => t.id === id)) go(id, { silent: true });
  });

  const initial = location.hash.slice(1);
  go(tabs.some(t => t.id === initial) ? initial : tabs[0].id, { silent: true });

  return { go, render, relabel, get current() { return current; }, screen, topbarExtra };
}
