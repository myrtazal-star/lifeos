/* Слияние данных двух устройств.

   Наивная синхронизация («чей файл новее, тот и прав») теряет записи:
   добавили пять расходов на телефоне, открыли компьютер со вчерашними
   данными — и они затёрли телефон. Поэтому сливаем не файл целиком,
   а каждую запись отдельно: у кого свежее отметка времени, та и берётся.

   Удаление не стирает запись, а помечает её удалённой — иначе второе
   устройство, не знающее об удалении, вернёт её обратно. Такие пометки
   подчищаются через TOMBSTONE_DAYS дней. */

export const TOMBSTONE_DAYS = 120;

export const now = () => new Date().toISOString();

/** Отметить запись изменённой. Вызывается при любой правке. */
export function stamp(record, at = now()) {
  record.updatedAt = at;
  return record;
}

/** Пометить удалённой вместо стирания. */
export function tombstone(record, at = now()) {
  record.deleted = true;
  record.updatedAt = at;
  return record;
}

const ts = (r) => r?.updatedAt || '';

/* ─────────── Списки записей (операции, счета, привычки…) ─────────── */

/** Слияние двух списков по ключу. Побеждает запись с более поздней отметкой;
    при равных отметках выигрывает удалённая — так расхождение
    разрешается одинаково на обоих устройствах. */
export function mergeList(local = [], remote = [], key = 'id') {
  const out = new Map();

  for (const r of local) if (r && r[key] != null) out.set(r[key], r);

  for (const r of remote) {
    if (!r || r[key] == null) continue;
    const mine = out.get(r[key]);
    if (!mine) { out.set(r[key], r); continue; }

    if (ts(r) > ts(mine)) out.set(r[key], r);
    else if (ts(r) === ts(mine) && r.deleted && !mine.deleted) out.set(r[key], r);
  }

  return [...out.values()];
}

/* ─────────── Словари по дате (отметки привычек) ─────────── */

/** logs: { 'YYYY-MM-DD': { habitId: число } }
    meta: { 'YYYY-MM-DD': { habitId: отметка времени } }
    Сливаем каждую ячейку отдельно, чтобы утренняя отметка с телефона
    и вечерняя с компьютера не затирали друг друга. */
export function mergeCells(localValues = {}, localMeta = {},
                           remoteValues = {}, remoteMeta = {}) {
  const values = {}, meta = {};
  const days = new Set([...Object.keys(localValues), ...Object.keys(remoteValues),
                        ...Object.keys(localMeta), ...Object.keys(remoteMeta)]);

  for (const day of days) {
    const lv = localValues[day] || {}, rv = remoteValues[day] || {};
    const lm = localMeta[day] || {}, rm = remoteMeta[day] || {};
    const ids = new Set([...Object.keys(lv), ...Object.keys(rv),
                         ...Object.keys(lm), ...Object.keys(rm)]);

    const dayValues = {}, dayMeta = {};
    for (const id of ids) {
      const takeRemote = (rm[id] || '') > (lm[id] || '');
      const value = takeRemote ? rv[id] : lv[id];
      const at = takeRemote ? rm[id] : lm[id];

      if (at) dayMeta[id] = at;
      // ноль и отсутствие значения — это «снятая отметка», её не храним
      if (value != null && value !== 0) dayValues[id] = value;
    }

    if (Object.keys(dayValues).length) values[day] = dayValues;
    if (Object.keys(dayMeta).length) meta[day] = dayMeta;
  }

  return { values, meta };
}

/** Словарь «дата → одно значение»: заметка дня, самочувствие.
    Отличается от mergeCells тем, что на дату приходится одно значение,
    а не набор по привычкам. */
export function mergeMap(localValues = {}, localMeta = {},
                         remoteValues = {}, remoteMeta = {}) {
  const values = {}, meta = {};
  const days = new Set([...Object.keys(localValues), ...Object.keys(remoteValues),
                        ...Object.keys(localMeta), ...Object.keys(remoteMeta)]);

  for (const day of days) {
    const takeRemote = (remoteMeta[day] || '') > (localMeta[day] || '');
    const value = takeRemote ? remoteValues[day] : localValues[day];
    const at = takeRemote ? remoteMeta[day] : localMeta[day];

    if (at) meta[day] = at;
    if (value != null && value !== '') values[day] = value;
  }

  return { values, meta };
}

/* ─────────── Отдельные объекты (настройки) ─────────── */

/** Настройки — маленький объект, его берём целиком у более свежей стороны. */
export function mergeSingle(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return ts(remote) > ts(local) ? remote : local;
}

/* ─────────── Уборка ─────────── */

/** Выбросить пометки об удалении старше TOMBSTONE_DAYS.
    К этому моменту все устройства уже узнали об удалении. */
export function pruneTombstones(list = [], days = TOMBSTONE_DAYS, at = Date.now()) {
  const edge = new Date(at - days * 86400000).toISOString();
  return list.filter(r => !(r.deleted && ts(r) < edge));
}

/** Видимые записи — то, что показывают экраны. */
export const alive = (list = []) => list.filter(r => !r.deleted);

/* ─────────── Сборка целого состояния ─────────── */

/**
 * Описание приложения:
 *   lists:      { имяПоля: 'ключ' }       — списки записей
 *   cells:      { values: 'logs', meta: 'logsMeta' } — словари по дате
 *   singles:    ['settings']              — объекты целиком
 * Остальные поля остаются от локального состояния.
 */
export function mergeState(local, remote, shape) {
  if (!remote) return local;
  const out = { ...local };

  for (const [field, key] of Object.entries(shape.lists || {})) {
    out[field] = pruneTombstones(mergeList(local[field], remote[field], key));
  }

  if (shape.cells) {
    const { values, meta } = shape.cells;
    const merged = mergeCells(local[values], local[meta], remote[values], remote[meta]);
    out[values] = merged.values;
    out[meta] = merged.meta;
  }

  for (const [values, meta] of Object.entries(shape.maps || {})) {
    const merged = mergeMap(local[values], local[meta], remote[values], remote[meta]);
    out[values] = merged.values;
    out[meta] = merged.meta;
  }

  for (const field of shape.singles || []) {
    out[field] = mergeSingle(local[field], remote[field]);
  }

  return out;
}
