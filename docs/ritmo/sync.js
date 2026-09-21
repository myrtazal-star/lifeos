/* Настройка обмена для Ritmo. */

import { createSyncRunner } from './shared/js/sync-runner.js';
import { store } from './data.js';

/* cells — отметки привычек: дата → привычка → значение, сливаются по ячейке.
   maps  — одно значение на день (заметка, самочувствие). */
const SHAPE = {
  lists: { habits: 'id' },
  cells: { values: 'logs', meta: 'logsMeta' },
  maps: { notes: 'notesMeta', mood: 'moodMeta' },
  singles: ['settings'],
};

let onChange = null;

export const runner = createSyncRunner({
  app: 'ritmo',
  store,
  shape: SHAPE,
  onState: (s) => onChange?.(s),
});

export function watchSync(fn) { onChange = fn; }
