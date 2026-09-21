/* Вход и хранение данных в Supabase.

   Обычные запросы вместо библиотеки: приложение без сборщика, а нужны
   ровно четыре вызова — регистрация, вход, чтение и запись.

   Ключ ниже публичный и предназначен для встраивания в клиент: сами
   данные закрыты правилами на уровне базы, которые пропускают человека
   только к его собственным строкам. */

export const CLOUD = {
  url: 'https://irjpseestsddpifmphhd.supabase.co',
  key: 'sb_publishable_xHBT5SHUkyfcyQ-SWFJy1A_Nm8uuG7N',
};

/* Сессия общая для обоих приложений: они на одном адресе,
   поэтому вход в Milpa открывает и Ritmo. */
const SESSION_KEY = 'lifeos.session';

class CloudError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
export { CloudError };

/* ─────────── Сессия ─────────── */

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function saveSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* приватный режим */ }
}

function toSession(raw) {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    // просим обновить чуть раньше срока, чтобы не ловить отказ на полпути
    expiresAt: Date.now() + Math.max(0, (raw.expires_in || 3600) - 120) * 1000,
    email: raw.user?.email || '',
    userId: raw.user?.id || '',
  };
}

export function currentUser() {
  const s = loadSession();
  return s ? { email: s.email, id: s.userId } : null;
}

export const signedIn = () => !!loadSession();

/* ─────────── Обращения к серверу ─────────── */

async function call(path, { method = 'POST', body, token, headers = {}, query = '' } = {}) {
  let res;
  try {
    res = await fetch(CLOUD.url + path + query, {
      method,
      headers: {
        apikey: CLOUD.key,
        'content-type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new CloudError('network', e.message);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }

  if (!res.ok) {
    const msg = json?.msg || json?.message || json?.error_description || text.slice(0, 200);
    const code = json?.error_code || json?.code;
    if (res.status === 400 && /already registered/i.test(msg)) throw new CloudError('email-taken', msg);
    if (res.status === 400 && code === 'email_address_invalid') throw new CloudError('bad-email', msg);
    if (res.status === 400 && /invalid login/i.test(msg)) throw new CloudError('bad-login', msg);
    if (res.status === 400 && /email not confirmed/i.test(msg)) throw new CloudError('unconfirmed', msg);
    if (res.status === 422) throw new CloudError('weak-password', msg);
    if (res.status === 401 || res.status === 403) throw new CloudError('unauthorised', msg);
    if (res.status === 429) throw new CloudError('too-often', msg);
    if (res.status >= 500) throw new CloudError('server', msg);
    throw new CloudError('http-' + res.status, msg);
  }

  return { json, res };
}

/* ─────────── Вход ─────────── */

export async function signUp(email, password) {
  const { json } = await call('/auth/v1/signup', {
    body: { email: String(email).trim(), password },
  });

  // если подтверждение почты включено, токена не будет — придёт письмо
  if (json?.access_token) {
    saveSession(toSession(json));
    return { signedIn: true };
  }
  return { signedIn: false, needsConfirmation: true };
}

export async function signIn(email, password) {
  const { json } = await call('/auth/v1/token', {
    query: '?grant_type=password',
    body: { email: String(email).trim(), password },
  });
  saveSession(toSession(json));
  return { signedIn: true };
}

export function signOut() { saveSession(null); }

/** Обновить просроченный пропуск. Возвращает действующий токен. */
async function validToken() {
  const s = loadSession();
  if (!s) throw new CloudError('signed-out');
  if (Date.now() < s.expiresAt) return s.accessToken;

  try {
    const { json } = await call('/auth/v1/token', {
      query: '?grant_type=refresh_token',
      body: { refresh_token: s.refreshToken },
    });
    saveSession(toSession(json));
    return json.access_token;
  } catch (e) {
    // обновить не удалось — просим войти заново, но данные на устройстве не трогаем
    if (e.code === 'unauthorised' || e.code === 'http-400') {
      saveSession(null);
      throw new CloudError('signed-out');
    }
    throw e;
  }
}

/* ─────────── Данные ─────────── */

/** Прочитать снимок с сервера. null — если его там ещё нет. */
export async function pull(app) {
  const token = await validToken();
  const userId = loadSession().userId;
  const { json } = await call('/rest/v1/app_state', {
    method: 'GET',
    token,
    query: `?user_id=eq.${userId}&app=eq.${app}&select=data,revision`,
  });
  const row = Array.isArray(json) ? json[0] : null;
  return row ? { data: row.data, revision: row.revision } : null;
}

/**
 * Записать снимок. expectedRevision — то, что мы читали.
 * Если другое устройство успело записать раньше, сервер ничего не меняет,
 * и мы возвращаем conflict: надо перечитать и слить заново.
 */
export async function push(app, data, expectedRevision) {
  const token = await validToken();
  const userId = loadSession().userId;
  const headers = { Prefer: 'return=representation' };

  if (expectedRevision == null) {
    const { json } = await call('/rest/v1/app_state', {
      token, headers,
      body: { user_id: userId, app, data },
    }).catch(e => {
      // строка успела появиться с другого устройства
      if (e.code === 'http-409') return { json: null };
      throw e;
    });
    if (!json) return { conflict: true };
    return { revision: json[0]?.revision };
  }

  const { json } = await call('/rest/v1/app_state', {
    method: 'PATCH',
    token, headers,
    query: `?user_id=eq.${userId}&app=eq.${app}&revision=eq.${expectedRevision}`,
    body: { data },
  });

  if (!Array.isArray(json) || !json.length) return { conflict: true };
  return { revision: json[0].revision };
}
