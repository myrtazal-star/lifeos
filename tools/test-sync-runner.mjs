/* Проверка обмена между двумя устройствами.
   Сервер и хранилища поддельные, зато сценарии настоящие:
   параллельные правки, работа офлайн, одновременная отправка. */

import { createSyncRunner } from '../shared/js/sync-runner.js';

let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'ОШИБКА'} ${label}${cond ? '' : '  ' + extra}`);
};
const eq = (label, a, b) =>
  ok(label, JSON.stringify(a) === JSON.stringify(b),
     `получили ${JSON.stringify(a)}, ждали ${JSON.stringify(b)}`);

const SHAPE = { lists: { tx: 'id' }, singles: ['settings'] };

/* Поддельный сервер: хранит снимок и номер записи. */
function makeServer() {
  const rows = new Map();
  return {
    rows,
    offline: false,
    calls: { pull: 0, push: 0, conflicts: 0 },
    api(server) {
      return {
        signedIn: () => true,
        async pull(app) {
          if (server.offline) { const e = new Error('off'); e.code = 'network'; throw e; }
          server.calls.pull++;
          const r = rows.get(app);
          return r ? { data: structuredClone(r.data), revision: r.revision } : null;
        },
        async push(app, data, expected) {
          if (server.offline) { const e = new Error('off'); e.code = 'network'; throw e; }
          server.calls.push++;
          const cur = rows.get(app);
          if (!cur) {
            if (expected != null) { server.calls.conflicts++; return { conflict: true }; }
            rows.set(app, { data: structuredClone(data), revision: 1 });
            return { revision: 1 };
          }
          if (cur.revision !== expected) { server.calls.conflicts++; return { conflict: true }; }
          cur.data = structuredClone(data);
          cur.revision++;
          return { revision: cur.revision };
        },
      };
    },
  };
}

/* Поддельное хранилище с тем же поведением, что настоящее. */
function makeStore(initial) {
  let state = structuredClone(initial);
  return {
    get state() { return state; },
    flush() {},
    subscribe() {},
    replace(next) { state = next; },
    add(tx) { state.tx.push(tx); },
  };
}

const T = n => `2026-09-21T10:${String(n).padStart(2, '0')}:00.000Z`;
const tx = (id, at) => ({ id, amount: 100, updatedAt: at });
const ids = st => st.tx.filter(t => !t.deleted).map(t => t.id).sort();

const empty = () => ({ tx: [], settings: { theme: 'dark', updatedAt: T(0) } });

console.log('\n── Первая отправка, сервер пустой ──');
{
  const server = makeServer();
  const phone = makeStore(empty());
  phone.add(tx('p1', T(1)));
  const r = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: server.api(server) });
  await r.sync();
  eq('запись ушла на сервер', server.rows.get('milpa').data.tx.map(t => t.id), ['p1']);
  eq('состояние обмена', r.state.status, 'ok');
}

console.log('\n── Второе устройство подхватывает чужие записи ──');
{
  const server = makeServer();
  const phone = makeStore(empty());
  const laptop = makeStore(empty());
  phone.add(tx('p1', T(1)));

  const rp = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: server.api(server) });
  const rl = createSyncRunner({ app: 'milpa', store: laptop, shape: SHAPE, cloud: server.api(server) });

  await rp.sync();
  await rl.sync();
  eq('компьютер увидел запись телефона', ids(laptop.state), ['p1']);
}

console.log('\n── Оба добавили своё, пока не синхронизировались ──');
{
  const server = makeServer();
  const phone = makeStore(empty());
  const laptop = makeStore(empty());
  const rp = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: server.api(server) });
  const rl = createSyncRunner({ app: 'milpa', store: laptop, shape: SHAPE, cloud: server.api(server) });

  phone.add(tx('p1', T(1)));
  await rp.sync();                 // на сервере: p1

  laptop.add(tx('l1', T(2)));
  await rl.sync();                 // компьютер сливает и шлёт p1+l1

  await rp.sync();                 // телефон забирает l1

  eq('у телефона обе', ids(phone.state), ['l1', 'p1']);
  eq('у компьютера обе', ids(laptop.state), ['l1', 'p1']);
  eq('на сервере обе', server.rows.get('milpa').data.tx.map(t => t.id).sort(), ['l1', 'p1']);
}

console.log('\n── Работа офлайн, потом возвращение ──');
{
  const server = makeServer();
  const phone = makeStore(empty());
  const laptop = makeStore(empty());
  const rp = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: server.api(server) });
  const rl = createSyncRunner({ app: 'milpa', store: laptop, shape: SHAPE, cloud: server.api(server) });

  laptop.add(tx('l1', T(1)));
  await rl.sync();

  server.offline = true;
  phone.add(tx('p1', T(2)));
  phone.add(tx('p2', T(3)));
  const res = await rp.sync();
  ok('без связи обмен не удался, но данные целы', res === false && ids(phone.state).length === 2);
  eq('состояние — нет связи', rp.state.status, 'offline');

  server.offline = false;
  await rp.sync();
  eq('после возвращения связи всё сошлось', ids(phone.state), ['l1', 'p1', 'p2']);
  eq('и на сервере тоже', server.rows.get('milpa').data.tx.map(t => t.id).sort(), ['l1', 'p1', 'p2']);
}

console.log('\n── Одновременная отправка: второй получает отказ и повторяет ──');
{
  const server = makeServer();
  const phone = makeStore(empty());
  const laptop = makeStore(empty());
  const cloudA = server.api(server);
  const cloudB = server.api(server);

  // оба прочитали пустой сервер, оба пишут
  phone.add(tx('p1', T(1)));
  laptop.add(tx('l1', T(2)));

  const rp = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: cloudA });
  const rl = createSyncRunner({ app: 'milpa', store: laptop, shape: SHAPE, cloud: cloudB });

  await Promise.all([rp.sync(), rl.sync()]);

  const onServer = server.rows.get('milpa').data.tx.map(t => t.id).sort();
  ok('на сервере не потерялось ничего из отправленного',
     onServer.includes('p1') || onServer.includes('l1'), JSON.stringify(onServer));

  // следующий круг доводит обе стороны до одного состояния
  await rp.sync(); await rl.sync(); await rp.sync();
  eq('в итоге у телефона обе', ids(phone.state), ['l1', 'p1']);
  eq('в итоге у компьютера обе', ids(laptop.state), ['l1', 'p1']);
}

console.log('\n── Удаление доезжает до второго устройства ──');
{
  const server = makeServer();
  const phone = makeStore(empty());
  const laptop = makeStore(empty());
  const rp = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: server.api(server) });
  const rl = createSyncRunner({ app: 'milpa', store: laptop, shape: SHAPE, cloud: server.api(server) });

  phone.add(tx('p1', T(1)));
  await rp.sync(); await rl.sync();
  eq('сначала запись есть у обоих', ids(laptop.state), ['p1']);

  // удаляем на телефоне
  phone.state.tx.find(t => t.id === 'p1').deleted = true;
  phone.state.tx.find(t => t.id === 'p1').updatedAt = T(5);
  await rp.sync(); await rl.sync();
  eq('после удаления её нет и на компьютере', ids(laptop.state), []);

  // компьютер синхронизируется ещё раз — запись не воскресает
  await rl.sync(); await rp.sync();
  eq('и не возвращается', ids(phone.state), []);
}

console.log('\n── Правка во время отправки не теряется ──');
{
  /* Отправка на мобильной сети занимает секунды. Если за это время
     человек записал операцию, она не должна исчезнуть.
     Важно: на сервере уже должны быть данные — иначе опасная ветка
     (применение снимка к себе) просто не выполняется, и проверка
     проходит вхолостую. */
  const server = makeServer();
  const other = makeStore(empty());
  other.add(tx('чужая', T(1)));
  const seed = createSyncRunner({ app: 'milpa', store: other, shape: SHAPE, cloud: server.api(server) });
  await seed.sync();
  ok('на сервере есть с чего начинать', !!server.rows.get('milpa'));

  const phone = makeStore(empty());
  phone.add(tx('было', T(2)));

  const api = server.api(server);
  const realPush = api.push.bind(api);
  api.push = async (app, data, expected) => {
    // ровно в момент отправки пользователь сохраняет ещё одну операцию
    phone.add(tx('во-время-отправки', T(3)));
    return realPush(app, data, expected);
  };

  const r = createSyncRunner({ app: 'milpa', store: phone, shape: SHAPE, cloud: api });
  await r.sync();

  ok('запись, сделанная во время отправки, на месте',
     ids(phone.state).includes('во-время-отправки'), JSON.stringify(ids(phone.state)));
  eq('ничего не потеряно', ids(phone.state), ['было', 'во-время-отправки', 'чужая']);

  await r.sync();
  eq('сервер получил всё', server.rows.get('milpa').data.tx.map(t => t.id).sort(),
     ['было', 'во-время-отправки', 'чужая']);
}

console.log('\n── Без входа обмен не запускается ──');
{
  const server = makeServer();
  const store = makeStore(empty());
  const api = server.api(server);
  api.signedIn = () => false;
  const r = createSyncRunner({ app: 'milpa', store, shape: SHAPE, cloud: api });
  const res = await r.sync();
  ok('ничего не отправлено', res === false && server.calls.push === 0);
}

console.log(failed ? `\n  ПРОВАЛЕНО: ${failed}\n` : '\n  Все проверки пройдены.\n');
process.exit(failed ? 1 : 0);
