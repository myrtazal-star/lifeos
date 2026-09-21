/* Проверка слияния двух устройств.
   Каждый случай — это реальная история: что-то записали на телефоне,
   что-то на компьютере, где-то были офлайн. Ни одна запись не должна
   пропасть, и обе стороны должны прийти к одному и тому же. */

import { mergeList, mergeCells, mergeMap, mergeSingle, mergeState,
         pruneTombstones, alive, stamp, tombstone } from '../shared/js/sync.js';

let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'ОШИБКА'} ${label}${cond ? '' : '  ' + extra}`);
};
const eq = (label, a, b) =>
  ok(label, JSON.stringify(a) === JSON.stringify(b),
     `получили ${JSON.stringify(a)}, ждали ${JSON.stringify(b)}`);

const tx = (id, amount, at, extra = {}) => ({ id, amount, updatedAt: at, ...extra });
const ids = list => alive(list).map(r => r.id).sort();
const T = n => `2026-09-21T10:${String(n).padStart(2, '0')}:00.000Z`;

console.log('\n── Обе стороны добавили своё ──');
{
  const phone = [tx('a', 100, T(1)), tx('b', 200, T(2))];
  const laptop = [tx('a', 100, T(1)), tx('c', 300, T(3))];
  const m = mergeList(phone, laptop);
  eq('все три записи на месте', ids(m), ['a', 'b', 'c']);
}

console.log('\n── Одну запись правили на одном устройстве ──');
{
  const phone = [tx('a', 999, T(5))];            // исправили сумму позже
  const laptop = [tx('a', 100, T(1))];
  eq('побеждает более свежая правка', mergeList(phone, laptop)[0].amount, 999);
  eq('порядок сторон не влияет', mergeList(laptop, phone)[0].amount, 999);
}

console.log('\n── Удаление ──');
{
  const phone = [tombstone(tx('a', 100, T(1)), T(5))];
  const laptop = [tx('a', 100, T(1))];           // компьютер про удаление не знает
  ok('запись не воскресает', alive(mergeList(phone, laptop)).length === 0);
  ok('и в обратную сторону', alive(mergeList(laptop, phone)).length === 0);
}

console.log('\n── Удалили здесь, но позже исправили там ──');
{
  const phone = [tombstone(tx('a', 100, T(1)), T(2))];
  const laptop = [tx('a', 555, T(9))];           // правка позже удаления
  const m = mergeList(phone, laptop);
  ok('более поздняя правка отменяет удаление', alive(m).length === 1);
  eq('с новой суммой', alive(m)[0].amount, 555);
}

console.log('\n── Ровно одинаковое время ──');
{
  const a = [tombstone(tx('a', 100, T(1)), T(4))];
  const b = [tx('a', 200, T(4))];
  ok('обе стороны решают одинаково (удалено)',
     alive(mergeList(a, b)).length === 0 && alive(mergeList(b, a)).length === 0);
}

console.log('\n── Долго работали офлайн ──');
{
  const phone = Array.from({ length: 5 }, (_, i) => tx('p' + i, 100, T(10 + i)));
  const laptop = Array.from({ length: 3 }, (_, i) => tx('l' + i, 200, T(20 + i)));
  const m = mergeList(phone, laptop);
  eq('ничего не потеряно', alive(m).length, 8);
}

console.log('\n── Устойчивость ──');
{
  const phone = [tx('a', 1, T(1)), tombstone(tx('b', 2, T(2)), T(3))];
  const laptop = [tx('a', 9, T(5)), tx('c', 3, T(4))];
  const once = mergeList(phone, laptop);
  const twice = mergeList(once, laptop);
  eq('повторное слияние ничего не меняет', ids(twice), ids(once));
  eq('обе стороны приходят к одному', ids(mergeList(phone, laptop)), ids(mergeList(laptop, phone)));
  eq('слияние с самим собой', ids(mergeList(once, once)), ids(once));
}

console.log('\n── Уборка пометок об удалении ──');
{
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();
  const list = [tx('a', 1, recent), { id: 'b', deleted: true, updatedAt: old },
                { id: 'c', deleted: true, updatedAt: recent }];
  const pruned = pruneTombstones(list);
  eq('старая пометка убрана, свежая осталась',
     pruned.map(r => r.id).sort(), ['a', 'c']);
  ok('живая запись не тронута', pruned.find(r => r.id === 'a').amount === 1);
}

console.log('\n── Отметки привычек за один день с двух устройств ──');
{
  const phoneV = { '2026-09-21': { sport: 1 } };
  const phoneM = { '2026-09-21': { sport: T(8) } };
  const lapV = { '2026-09-21': { reading: 20 } };
  const lapM = { '2026-09-21': { reading: T(20) } };
  const m = mergeCells(phoneV, phoneM, lapV, lapM);
  eq('обе отметки сохранились', m.values['2026-09-21'], { sport: 1, reading: 20 });
}

console.log('\n── Одна и та же привычка, поправили позже ──');
{
  const phoneV = { '2026-09-21': { reading: 20 } };
  const phoneM = { '2026-09-21': { reading: T(8) } };
  const lapV = { '2026-09-21': { reading: 45 } };
  const lapM = { '2026-09-21': { reading: T(30) } };
  eq('берётся более поздняя',
     mergeCells(phoneV, phoneM, lapV, lapM).values['2026-09-21'].reading, 45);
  eq('порядок не влияет',
     mergeCells(lapV, lapM, phoneV, phoneM).values['2026-09-21'].reading, 45);
}

console.log('\n── Снятая отметка ──');
{
  const phoneV = {};                                  // отметку сняли
  const phoneM = { '2026-09-21': { sport: T(30) } };
  const lapV = { '2026-09-21': { sport: 1 } };
  const lapM = { '2026-09-21': { sport: T(8) } };
  const m = mergeCells(phoneV, phoneM, lapV, lapM);
  ok('снятие позже отметки побеждает', !m.values['2026-09-21']);
}

console.log('\n── Заметка дня и самочувствие (одно значение на дату) ──');
{
  // на телефоне заметка за 21-е, на компьютере за 20-е — нужны обе
  const phoneV = { '2026-09-21': 'Тяжёлый день' };
  const phoneM = { '2026-09-21': T(8) };
  const lapV = { '2026-09-20': 'Хорошо поработала' };
  const lapM = { '2026-09-20': T(9) };
  const m = mergeMap(phoneV, phoneM, lapV, lapM);
  eq('обе заметки сохранились', Object.keys(m.values).sort(), ['2026-09-20', '2026-09-21']);

  // одну и ту же заметку переписали позже на другом устройстве
  const laterV = { '2026-09-21': 'Передумала' };
  const laterM = { '2026-09-21': T(30) };
  eq('берётся более поздняя правка',
     mergeMap(phoneV, phoneM, laterV, laterM).values['2026-09-21'], 'Передумала');
  eq('порядок сторон не влияет',
     mergeMap(laterV, laterM, phoneV, phoneM).values['2026-09-21'], 'Передумала');

  // заметку стёрли
  const clearedM = { '2026-09-21': T(30) };
  ok('позднее стирание побеждает',
     !mergeMap({}, clearedM, phoneV, phoneM).values['2026-09-21']);
}

console.log('\n── Состояние Ritmo целиком ──');
{
  // ровно та форма, которую объявляет apps/ritmo/sync.js
  const shape = {
    lists: { habits: 'id' },
    cells: { values: 'logs', meta: 'logsMeta' },
    maps: { notes: 'notesMeta', mood: 'moodMeta' },
    singles: ['settings'],
  };
  const phone = {
    habits: [tx('h1', 100, T(1))],
    logs: {}, logsMeta: {},
    notes: { '2026-09-21': 'С телефона' }, notesMeta: { '2026-09-21': T(5) },
    mood: { '2026-09-21': 4 }, moodMeta: { '2026-09-21': T(5) },
    settings: { updatedAt: T(1) },
  };
  const laptop = {
    habits: [tx('h1', 100, T(1))],
    logs: {}, logsMeta: {},
    notes: { '2026-09-20': 'С компьютера' }, notesMeta: { '2026-09-20': T(6) },
    mood: { '2026-09-20': 2 }, moodMeta: { '2026-09-20': T(6) },
    settings: { updatedAt: T(1) },
  };
  const m = mergeState(phone, laptop, shape);
  eq('заметки с обоих устройств на месте',
     Object.keys(m.notes).sort(), ['2026-09-20', '2026-09-21']);
  eq('самочувствие с обоих устройств на месте',
     Object.keys(m.mood).sort(), ['2026-09-20', '2026-09-21']);
  ok('отметки времени сохранены', !!m.notesMeta['2026-09-20'] && !!m.moodMeta['2026-09-21']);
}

console.log('\n── Настройки ──');
{
  const local = { base: 'MXN', updatedAt: T(1) };
  const remote = { base: 'USD', updatedAt: T(9) };
  eq('берутся более свежие', mergeSingle(local, remote).base, 'USD');
  eq('если на сервере пусто — свои', mergeSingle(local, null).base, 'MXN');
}

console.log('\n── Состояние целиком ──');
{
  const shape = { lists: { tx: 'id', accounts: 'id' },
                  cells: { values: 'logs', meta: 'logsMeta' },
                  singles: ['settings'] };
  const local = {
    tx: [tx('t1', 100, T(1))],
    accounts: [tx('a1', 0, T(1))],
    logs: { '2026-09-21': { h1: 1 } }, logsMeta: { '2026-09-21': { h1: T(1) } },
    settings: { theme: 'dark', updatedAt: T(1) },
    habits: [{ id: 'h1' }],
  };
  const remote = {
    tx: [tx('t2', 200, T(2))],
    accounts: [tx('a1', 0, T(1))],
    logs: { '2026-09-21': { h2: 5 } }, logsMeta: { '2026-09-21': { h2: T(2) } },
    settings: { theme: 'light', updatedAt: T(9) },
  };
  const m = mergeState(local, remote, shape);
  eq('операции слиты', ids(m.tx), ['t1', 't2']);
  eq('счета не задвоились', m.accounts.length, 1);
  eq('отметки слиты', m.logs['2026-09-21'], { h1: 1, h2: 5 });
  eq('настройки свежее — с сервера', m.settings.theme, 'light');
  eq('поля вне описания остались от своих', m.habits.length, 1);
}

console.log('\n── Отметка времени ──');
{
  const r = stamp({ id: 'x' }, T(7));
  eq('stamp проставляет время', r.updatedAt, T(7));
  const d = tombstone({ id: 'y' }, T(7));
  ok('tombstone помечает удалённой', d.deleted === true && d.updatedAt === T(7));
}

console.log(failed ? `\n  ПРОВАЛЕНО: ${failed}\n` : '\n  Все проверки пройдены.\n');
process.exit(failed ? 1 : 0);
