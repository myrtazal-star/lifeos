/* Механизм переводов.
   Все тексты интерфейса берутся через t('ключ') — поэтому добавить
   испанский или английский = дописать словарь, а не править экраны. */

export const LANGS = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'es', label: 'Español', flag: '🇲🇽' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

/** Строки, общие для обоих приложений. */
export const commonDict = {
  ru: {
    save: 'Сохранить', cancel: 'Отмена', delete: 'Удалить', edit: 'Изменить',
    add: 'Добавить', done: 'Готово', close: 'Закрыть', back: 'Назад',
    confirm: 'Подтвердить', yes: 'Да', no: 'Нет', all: 'Все', none: 'Нет',
    today: 'Сегодня', yesterday: 'Вчера', tomorrow: 'Завтра',
    week: 'Неделя', month: 'Месяц', year: 'Год', day: 'День',
    settings: 'Настройки', language: 'Язык', theme: 'Оформление',
    theme_dark: 'Тёмное', theme_light: 'Светлое', theme_auto: 'Как в системе',
    data: 'Данные', export: 'Выгрузить копию', import: 'Загрузить копию',
    reset: 'Стереть все данные', about: 'О приложении',
    saved: 'Сохранено', deleted: 'Удалено', copied: 'Скопировано',
    nothing_yet: 'Пока пусто', search: 'Поиск',
    name: 'Название', note: 'Заметка', date: 'Дата', amount: 'Сумма',
    category: 'Категория', total: 'Итого', install: 'Установить на телефон',
    export_done: 'Файл с копией сохранён',
    import_ok: 'Данные восстановлены',
    import_err: 'Не удалось прочитать файл — он повреждён или от другого приложения',
    reset_confirm: 'Стереть все данные без возможности восстановления?',
    delete_confirm: 'Удалить безвозвратно?',
    storage_full: 'Память устройства переполнена. Выгрузите копию и удалите старые записи.',
    required: 'Заполните поле',
  },
  es: {
    save: 'Guardar', cancel: 'Cancelar', delete: 'Eliminar', edit: 'Editar',
    add: 'Añadir', done: 'Listo', close: 'Cerrar', back: 'Atrás',
    confirm: 'Confirmar', yes: 'Sí', no: 'No', all: 'Todos', none: 'Ninguno',
    today: 'Hoy', yesterday: 'Ayer', tomorrow: 'Mañana',
    week: 'Semana', month: 'Mes', year: 'Año', day: 'Día',
    settings: 'Ajustes', language: 'Idioma', theme: 'Apariencia',
    theme_dark: 'Oscuro', theme_light: 'Claro', theme_auto: 'Del sistema',
    data: 'Datos', export: 'Exportar copia', import: 'Importar copia',
    reset: 'Borrar todos los datos', about: 'Acerca de',
    saved: 'Guardado', deleted: 'Eliminado', copied: 'Copiado',
    nothing_yet: 'Aún no hay nada', search: 'Buscar',
    name: 'Nombre', note: 'Nota', date: 'Fecha', amount: 'Importe',
    category: 'Categoría', total: 'Total', install: 'Instalar en el teléfono',
    export_done: 'Copia guardada',
    import_ok: 'Datos restaurados',
    import_err: 'No se pudo leer el archivo: está dañado o es de otra app',
    reset_confirm: '¿Borrar todos los datos sin posibilidad de recuperarlos?',
    delete_confirm: '¿Eliminar definitivamente?',
    storage_full: 'Memoria del dispositivo llena. Exporta una copia y borra registros antiguos.',
    required: 'Completa este campo',
  },
  en: {
    save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit',
    add: 'Add', done: 'Done', close: 'Close', back: 'Back',
    confirm: 'Confirm', yes: 'Yes', no: 'No', all: 'All', none: 'None',
    today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow',
    week: 'Week', month: 'Month', year: 'Year', day: 'Day',
    settings: 'Settings', language: 'Language', theme: 'Appearance',
    theme_dark: 'Dark', theme_light: 'Light', theme_auto: 'System',
    data: 'Data', export: 'Export backup', import: 'Import backup',
    reset: 'Erase all data', about: 'About',
    saved: 'Saved', deleted: 'Deleted', copied: 'Copied',
    nothing_yet: 'Nothing yet', search: 'Search',
    name: 'Name', note: 'Note', date: 'Date', amount: 'Amount',
    category: 'Category', total: 'Total', install: 'Install on phone',
    export_done: 'Backup saved',
    import_ok: 'Data restored',
    import_err: 'Could not read the file — it is damaged or from another app',
    reset_confirm: 'Erase all data permanently?',
    delete_confirm: 'Delete permanently?',
    storage_full: 'Device storage is full. Export a backup and remove old records.',
    required: 'This field is required',
  },
};

function detectLang() {
  const nav = (navigator.language || 'ru').slice(0, 2).toLowerCase();
  return LANGS.some(l => l.code === nav) ? nav : 'ru';
}

export function createI18n(appDict, initial) {
  const merged = {};
  for (const l of LANGS) {
    merged[l.code] = { ...(commonDict[l.code] || {}), ...((appDict || {})[l.code] || {}) };
  }

  let lang = initial || detectLang();
  const subs = new Set();

  /** t('key', { n: 5 }) — {n} подставляется в строку. */
  function t(key, vars) {
    const dict = merged[lang] || merged.ru;
    // Если перевода нет — откатываемся на русский, затем показываем сам ключ.
    let s = dict[key] ?? merged.ru[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', String(v));
    }
    return s;
  }

  function setLang(next) {
    if (!merged[next]) return;
    lang = next;
    document.documentElement.lang = next;
    for (const fn of subs) fn(next);
  }

  document.documentElement.lang = lang;

  return {
    t,
    setLang,
    get lang() { return lang; },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
