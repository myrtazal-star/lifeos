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
    cl_title: 'Общий доступ с телефона и компьютера',
    cl_what: 'Войдите одним и тем же адресом на всех устройствах — записи будут сливаться автоматически. Ничего не теряется: правки с разных устройств объединяются по каждой записи отдельно.',
    cl_email: 'Почта', cl_password: 'Пароль',
    cl_sign_in: 'Войти', cl_sign_up: 'Создать',
    cl_sign_out: 'Выйти',
    cl_sign_out_warn: 'Данные на этом устройстве останутся, но обмен прекратится.',
    cl_signed_out_done: 'Вы вышли',
    cl_welcome: 'Готово — данные синхронизируются',
    cl_check_email: 'Письмо отправлено. Откройте его и подтвердите адрес, затем нажмите «Войти».',
    cl_privacy: 'Данные закрыты на уровне базы: к ним есть доступ только у вас. Приложение продолжает работать без интернета, обмен происходит, когда связь появится.',
    cl_email_taken: 'Такой адрес уже зарегистрирован — нажмите «Войти»',
    cl_bad_email: 'Адрес почты выглядит неверным',
    cl_bad_login: 'Неверная почта или пароль',
    cl_unconfirmed: 'Адрес не подтверждён — откройте письмо и перейдите по ссылке',
    cl_weak_password: 'Пароль слишком короткий — нужно минимум 6 знаков',
    cl_too_often: 'Слишком много попыток — подождите немного',
    cl_network: 'Нет связи с сервером',
    cl_server: 'Сервер временно недоступен',
    cl_signed_out: 'Сессия истекла — войдите снова',
    cl_failed: 'Не получилось',
    sync_idle: 'Обмен не настроен',
    sync_running: 'Синхронизирую…',
    sync_ok: 'Синхронизировано',
    sync_error: 'Не удалось синхронизировать',
    sync_offline: 'Нет связи — обменяемся, когда появится',
    sync_now: 'Обновить',
    sync_done: 'Данные сошлись',
    sync_hint: 'Обмен идёт сам: при открытии приложения и через несколько секунд после правок.',
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
    cl_title: 'Compartir entre teléfono y computadora',
    cl_what: 'Entra con el mismo correo en todos tus dispositivos y los registros se combinan solos, sin perder nada.',
    cl_email: 'Correo', cl_password: 'Contraseña',
    cl_sign_in: 'Entrar', cl_sign_up: 'Crear cuenta',
    cl_sign_out: 'Salir',
    cl_sign_out_warn: 'Los datos de este dispositivo se quedan, pero deja de sincronizarse.',
    cl_signed_out_done: 'Sesión cerrada',
    cl_welcome: 'Listo: los datos se sincronizan',
    cl_check_email: 'Te enviamos un correo. Confirma tu dirección y luego pulsa «Entrar».',
    cl_privacy: 'Los datos están protegidos en la base: solo tú accedes a ellos. La app sigue funcionando sin internet.',
    cl_email_taken: 'Ese correo ya está registrado: pulsa «Entrar»',
    cl_bad_email: 'El correo no parece válido',
    cl_bad_login: 'Correo o contraseña incorrectos',
    cl_unconfirmed: 'Correo sin confirmar: abre el mensaje y sigue el enlace',
    cl_weak_password: 'Contraseña muy corta: mínimo 6 caracteres',
    cl_too_often: 'Demasiados intentos: espera un momento',
    cl_network: 'Sin conexión con el servidor',
    cl_server: 'El servidor no está disponible',
    cl_signed_out: 'La sesión expiró: entra de nuevo',
    cl_failed: 'No se pudo',
    sync_idle: 'Sin sincronización',
    sync_running: 'Sincronizando…',
    sync_ok: 'Sincronizado',
    sync_error: 'No se pudo sincronizar',
    sync_offline: 'Sin conexión: se hará cuando vuelva',
    sync_now: 'Actualizar',
    sync_done: 'Datos al día',
    sync_hint: 'Se sincroniza solo: al abrir la app y poco después de cada cambio.',
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
    cl_title: 'Share between phone and computer',
    cl_what: 'Sign in with the same address on every device and records merge automatically, record by record, losing nothing.',
    cl_email: 'Email', cl_password: 'Password',
    cl_sign_in: 'Sign in', cl_sign_up: 'Create account',
    cl_sign_out: 'Sign out',
    cl_sign_out_warn: 'Data on this device stays, but syncing stops.',
    cl_signed_out_done: 'Signed out',
    cl_welcome: 'Done — your data is syncing',
    cl_check_email: 'Email sent. Confirm your address, then press «Sign in».',
    cl_privacy: 'Data is protected at the database level: only you can reach it. The app keeps working offline.',
    cl_email_taken: 'That address is already registered — press «Sign in»',
    cl_bad_email: 'That email address looks wrong',
    cl_bad_login: 'Wrong email or password',
    cl_unconfirmed: 'Address not confirmed — open the email and follow the link',
    cl_weak_password: 'Password too short — at least 6 characters',
    cl_too_often: 'Too many attempts — wait a moment',
    cl_network: 'No connection to the server',
    cl_server: 'The server is unavailable',
    cl_signed_out: 'Session expired — sign in again',
    cl_failed: 'Did not work',
    sync_idle: 'Not syncing',
    sync_running: 'Syncing…',
    sync_ok: 'Synced',
    sync_error: 'Could not sync',
    sync_offline: 'Offline — will sync when back',
    sync_now: 'Refresh',
    sync_done: 'Everything is up to date',
    sync_hint: 'Syncs by itself: when the app opens and a few seconds after each change.',
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
