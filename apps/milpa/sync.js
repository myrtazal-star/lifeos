/* Настройка обмена для Milpa: что именно и как сливать. */

import { createSyncRunner } from './shared/js/sync-runner.js';
import { store } from './data.js';

/* lists — списки записей, сливаются по каждой отдельно.
   singles — настройки, берутся целиком у более свежей стороны. */
const SHAPE = {
  lists: {
    tx: 'id',
    accounts: 'id',
    categories: 'id',
    recurring: 'id',
    books: 'id',
    goals: 'id',
    savings: 'id',
  },
  singles: ['settings'],
};

let onChange = null;

export const runner = createSyncRunner({
  app: 'milpa',
  store,
  shape: SHAPE,
  onState: (s) => onChange?.(s),
});

/** Кому сообщать об изменении состояния обмена. */
export function watchSync(fn) { onChange = fn; }
