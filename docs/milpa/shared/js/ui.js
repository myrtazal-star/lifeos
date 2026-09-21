/* Мелкие помощники интерфейса: создание элементов, листы снизу, тосты, иконки. */

/** el('div.card', { onclick }, [дети]) — короткая запись создания узла. */
export function el(spec, props = {}, children = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = node.className ? node.className + ' ' + v : v;
    else if (k === 'html') node.innerHTML = v;             // только для доверенной разметки (иконки)
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }

  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function mount(node, children) {
  clear(node);
  for (const c of [].concat(children)) if (c != null && c !== false) node.append(c);
  return node;
}

/* ─────────── Иконки (Lucide-подобные, 24×24 штрих) ─────────── */

const P = 'stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${P}>${inner}</svg>`;

export const icons = {
  home:    svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  wallet:  svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M21 10v6h-4a3 3 0 0 1 0-6h4Z"/>'),
  list:    svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>'),
  chart:   svg('<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3.2" height="7" rx="1"/><rect x="11" y="6" width="3.2" height="12" rx="1"/><rect x="16" y="14" width="3.2" height="4" rx="1"/>'),
  gear:    svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 14a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 18a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.7 7.4a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  plus:    svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  x:       svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  check:   svg('<polyline points="20 6 9 17 4 12"/>'),
  chevL:   svg('<polyline points="15 18 9 12 15 6"/>'),
  chevR:   svg('<polyline points="9 18 15 12 9 6"/>'),
  chevD:   svg('<polyline points="6 9 12 15 18 9"/>'),
  flame:   svg('<path d="M12 22c4 0 7-2.7 7-6.5 0-4.3-4-6-5-9.5-2 1.5-2.5 3.5-2 5.5-1-.6-1.8-1.8-2-3-2 2-5 4.2-5 7C5 19.3 8 22 12 22Z"/>'),
  calendar:svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>'),
  target:  svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>'),
  repeat:  svg('<polyline points="17 2 21 6 17 10"/><path d="M3 12V10a4 4 0 0 1 4-4h14"/><polyline points="7 22 3 18 7 14"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>'),
  arrowUp: svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/>'),
  arrowDn: svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>'),
  swap:    svg('<polyline points="16 3 21 8 16 13"/><line x1="21" y1="8" x2="7" y2="8"/><polyline points="8 11 3 16 8 21"/><line x1="3" y1="16" x2="17" y2="16"/>'),
  download:svg('<path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><path d="M4 19h16"/>'),
  upload:  svg('<path d="M12 21V9"/><polyline points="7 13 12 8 17 13"/><path d="M4 5h16"/>'),
  trash:   svg('<polyline points="3 6 21 6"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>'),
  book:    svg('<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v4H6.5A2.5 2.5 0 0 1 4 20.5Z"/>'),
  bolt:    svg('<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/>'),
  heart:   svg('<path d="M12 20.5 4.3 13a4.8 4.8 0 0 1 6.8-6.8l.9.9.9-.9A4.8 4.8 0 0 1 19.7 13Z"/>'),
  brief:   svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/>'),
  user:    svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  news:    svg('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5V19H5a2 2 0 0 1-2-2Z"/><path d="M17 9h2.5A1.5 1.5 0 0 1 21 10.5V17a2 2 0 0 1-2 2h-2"/><line x1="6.5" y1="9" x2="13.5" y2="9"/><line x1="6.5" y1="12.5" x2="13.5" y2="12.5"/><line x1="6.5" y1="16" x2="11" y2="16"/>'),
};

export function icon(name, cls) {
  return el('span' + (cls ? '.' + cls : ''), { html: icons[name] || '' });
}

/* ─────────── Лист снизу (модальное окно) ─────────── */

let openSheets = 0;

export function sheet({ title, body, actions, onClose }) {
  const backdrop = el('div.sheet-backdrop', { role: 'dialog', 'aria-modal': 'true' });
  const panel = el('div.sheet');

  function close() {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    openSheets = Math.max(0, openSheets - 1);
    if (!openSheets) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  panel.append(
    el('div.sheet__grip'),
    el('div.sheet__head', {}, [
      el('div.sheet__title', { text: title || '' }),
      el('button.icon-btn', { onclick: close, 'aria-label': 'Закрыть', html: icons.x }),
    ]),
    el('div.sheet__body', {}, body || []),
  );
  if (actions?.length) panel.append(el('div.sheet__actions', {}, actions));

  // клик по затемнению закрывает, клик внутри — нет
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.append(panel);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  openSheets++;
  document.addEventListener('keydown', onKey);

  // фокус на первое поле — но не на телефоне, чтобы клавиатура не прыгала
  if (!matchMedia('(pointer: coarse)').matches) {
    panel.querySelector('input, select, textarea')?.focus();
  }
  return { close, panel };
}

export function confirmSheet({ title, text, confirmLabel, cancelLabel, danger = true, onConfirm }) {
  const s = sheet({
    title,
    body: [el('p.muted', { text: text || '' })],
    actions: [
      el('button.btn.btn--ghost', { text: cancelLabel || 'Отмена', onclick: () => s.close() }),
      el('button' + (danger ? '.btn.btn--danger' : '.btn.btn--primary'), {
        text: confirmLabel || 'Удалить',
        onclick: () => { s.close(); onConfirm?.(); },
      }),
    ],
  });
  return s;
}

/* ─────────── Тосты ─────────── */

let toastHost = null;
export function toast(message, { error = false, ms = 2200 } = {}) {
  if (!toastHost) {
    toastHost = el('div.toast-host', { 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div.toast' + (error ? '.toast--err' : ''), { text: message });
  toastHost.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/* ─────────── Лёгкая вибрация (тактильный отклик) ─────────── */

export function haptic(ms = 12) {
  try { navigator.vibrate?.(ms); } catch {}
}

/* ─────────── Выгрузка файла ─────────── */

export function downloadFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = 'application/json') {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      // байты нужны там, где кодировка файла не UTF-8 (банковские выписки)
      const buffer = await file.arrayBuffer();
      resolve({ name: file.name, buffer, text: new TextDecoder('utf-8').decode(buffer) });
    });
    document.body.append(input);
    input.click();
  });
}

/* ─────────── Поля формы ─────────── */

export function field(label, control) {
  return el('label.field', {}, [el('span.label', { text: label }), control]);
}

export function input(props = {}) { return el('input.input', props); }
export function textarea(props = {}) { return el('textarea.textarea', props); }

export function select(options, props = {}) {
  const node = el('select.select', props);
  for (const o of options) {
    node.append(el('option', { value: o.value, selected: o.value === props.value }, [o.label]));
  }
  // атрибут selected не всегда срабатывает при динамическом создании
  if (props.value != null) node.value = props.value;
  return node;
}

export function segmented(options, value, onPick, { accent = false } = {}) {
  const wrap = el('div.seg' + (accent ? '.seg--accent' : ''), { role: 'group' });
  for (const o of options) {
    wrap.append(el('button', {
      type: 'button',
      text: o.label,
      'aria-pressed': String(o.value === value),
      onclick: () => { haptic(); onPick(o.value); },
    }));
  }
  return wrap;
}

export function emptyState(iconChar, title, text, action) {
  return el('div.empty', {}, [
    el('div.empty__icon', { text: iconChar }),
    el('div.empty__title', { text: title }),
    text && el('div.empty__text', { text }),
    action,
  ]);
}
