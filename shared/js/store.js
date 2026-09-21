/* Локальное хранилище с версионированием и событиями.
   Данные живут на устройстве (localStorage) — приложение работает офлайн.
   Слой намеренно изолирован: когда подключим облако (Supabase),
   меняется только реализация save/load, экраны не трогаем. */

export function createStore({ key, version, seed, migrate }) {
  let migrated = false;
  let state = load();
  const subs = new Set();
  let saveTimer = null;
  let dirty = false;

  // Миграцию закрепляем сразу: иначе на диске останется старая форма данных
  // и преобразование будет повторяться при каждом запуске.
  if (migrated) persist();

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch { /* приватный режим Safari — работаем в памяти */ }

    if (!raw) return structuredClone(seed);

    let data;
    try { data = JSON.parse(raw); }
    catch {
      // Битые данные не затираем: откладываем копию, чтобы можно было спасти вручную.
      try { localStorage.setItem(key + ':corrupt:' + Date.now(), raw); } catch {}
      return structuredClone(seed);
    }

    if (data.v !== version) {
      if (typeof migrate === 'function') {
        try { data = migrate(data, data.v ?? 0, version); }
        catch (e) { console.error('Миграция не удалась', e); return structuredClone(seed); }
      }
      migrated = true;
    }
    // недостающие ключи добираем из seed — чтобы новые функции не ломали старые данные
    return { ...structuredClone(seed), ...data, v: version };
  }

  function persist() {
    dirty = false;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      // QuotaExceeded или заблокированное хранилище
      emitError(e);
    }
  }

  function emitError(e) {
    window.dispatchEvent(new CustomEvent('store:error', { detail: e }));
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (dirty) persist();
  }

  function notify() {
    for (const fn of subs) { try { fn(state); } catch (e) { console.error(e); } }
  }

  /** Изменить состояние. mutator получает черновик и меняет его на месте. */
  function update(mutator) {
    mutator(state);
    state.updatedAt = new Date().toISOString();
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);   // пачкой, чтобы не писать на каждый чих
    notify();
  }

  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  // Страховка: записать всё перед уходом со страницы / сворачиванием на телефоне
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  return {
    get state() { return state; },
    update, subscribe, flush,

    /** Выгрузка всех данных — резервная копия в файл. */
    export() {
      flush();
      return JSON.stringify({ app: key, v: version, exportedAt: new Date().toISOString(), data: state }, null, 2);
    },

    /** Загрузка резервной копии. Возвращает { ok, error }. */
    import(text) {
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { return { ok: false, error: 'not-json' }; }

      const incoming = parsed?.data ?? parsed;
      if (!incoming || typeof incoming !== 'object') return { ok: false, error: 'bad-shape' };
      if (parsed?.app && parsed.app !== key) return { ok: false, error: 'wrong-app' };

      let next = incoming;
      if (next.v !== version && typeof migrate === 'function') {
        try { next = migrate(next, next.v ?? 0, version); }
        catch { return { ok: false, error: 'migrate-failed' }; }
      }
      state = { ...structuredClone(seed), ...next, v: version };
      persist();
      notify();
      return { ok: true };
    },

    /** Полный сброс к начальному состоянию. */
    reset() {
      state = structuredClone(seed);
      persist();
      notify();
    },
  };
}

/** Короткий уникальный id, устойчивый к столкновениям при офлайн-правках. */
export function uid(prefix = '') {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('');
  return prefix + Date.now().toString(36) + hex.slice(0, 8);
}
