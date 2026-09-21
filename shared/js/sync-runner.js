/* Обмен данными с сервером: прочитать чужое, слить со своим, отправить обратно.

   Порядок важен. Сначала читаем, потом сливаем, потом пишем — и только
   с проверкой, что за это время никто не успел записать раньше нас.
   Если успел, повторяем цикл, а не затираем. */

import { mergeState } from './sync.js';
import * as defaultCloud from './cloud.js';

const MAX_ATTEMPTS = 3;

/* cloud подменяется в проверках: так механизм обмена тестируется
   без сервера и без браузера. */
export function createSyncRunner({ app, store, shape, onState, cloud = defaultCloud }) {
  const state = {
    status: 'idle',      // idle | syncing | ok | error | offline
    lastAt: null,
    lastError: null,
    revision: null,
  };

  let timer = null;
  let running = false;
  let queued = false;

  function set(patch) {
    Object.assign(state, patch);
    onState?.({ ...state });
  }

  /** Полный цикл обмена. Возвращает true, если данные сошлись. */
  async function sync({ reason = 'manual' } = {}) {
    if (!cloud.signedIn()) { set({ status: 'idle' }); return false; }
    if (running) { queued = true; return false; }

    running = true;
    set({ status: 'syncing' });

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const remote = await cloud.pull(app);

        // Сливаем на момент отправки: пока шёл запрос, пользователь мог
        // что-то записать, и это не должно потеряться.
        store.flush();
        const merged = mergeState(store.state, remote?.data, shape);

        const res = await cloud.push(app, merged, remote?.revision);

        if (res.conflict) continue;      // кто-то успел раньше — читаем заново

        // применяем к себе только то, что реально пришло с той стороны
        if (remote?.data) store.replace(merged);

        set({ status: 'ok', lastAt: Date.now(), lastError: null, revision: res.revision });
        return true;
      }

      set({ status: 'error', lastError: 'busy' });
      return false;
    } catch (e) {
      const offline = e.code === 'network';
      set({ status: offline ? 'offline' : 'error', lastError: e.code || 'unknown' });
      return false;
    } finally {
      running = false;
      if (queued) { queued = false; setTimeout(() => sync({ reason: 'queued' }), 300); }
    }
  }

  /** Отложенный обмен после правок: не дёргаем сервер на каждое касание. */
  function schedule(delay = 4000) {
    if (!cloud.signedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync({ reason: 'auto' }), delay);
  }

  /** Подписаться на изменения и на возвращение в приложение. */
  function start() {
    if (!cloud.signedIn()) return;

    // во время обмена состояние меняем мы сами — не запускаем новый круг
    store.subscribe(() => { if (!running) schedule(); });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sync({ reason: 'visible' });
    });
    window.addEventListener('online', () => sync({ reason: 'online' }));

    sync({ reason: 'start' });
  }

  return { sync, schedule, start, get state() { return { ...state }; } };
}
