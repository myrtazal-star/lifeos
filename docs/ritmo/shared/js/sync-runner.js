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

        store.flush();
        const outgoing = mergeState(store.state, remote?.data, shape);

        const res = await cloud.push(app, outgoing, remote?.revision);

        if (res.conflict) continue;      // кто-то успел раньше — читаем заново

        /* Отправка занимает на мобильной сети секунды, и за это время
           человек мог записать ещё одну операцию. Если положить к себе
           снимок, сделанный ДО отправки, эта запись исчезнет — и с
           устройства, и из облака, хотя он видел «Сохранено».
           Поэтому сливаем заново, уже на момент применения. */
        if (remote?.data) store.replace(mergeState(store.state, remote.data, shape));

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

    store.subscribe(() => {
      // Во время обмена состояние меняем мы сами, поэтому новый круг не
      // запускаем сразу — но и не теряем: ставим в очередь, иначе правка,
      // сделанная в эти секунды, осталась бы неотправленной.
      if (running) queued = true;
      else schedule();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sync({ reason: 'visible' });
    });
    window.addEventListener('online', () => sync({ reason: 'online' }));

    sync({ reason: 'start' });
  }

  return { sync, schedule, start, get state() { return { ...state }; } };
}
