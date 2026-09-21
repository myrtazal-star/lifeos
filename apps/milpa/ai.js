/* Распознавание чеков и платёжек через Claude.

   Запрос отправляется прямо из браузера, без своего сервера: в приложении
   нет сборки и нет серверной части, поэтому ключ хранится на устройстве
   пользователя и подписывает его собственные запросы. Заголовок
   anthropic-dangerous-direct-browser-access разрешает такой вызов
   (проверено по исходникам @anthropic-ai/sdk 0.127).

   Обращение идёт обычным fetch, а не через SDK: приложение намеренно
   без сборщика и без зависимостей, а здесь ровно один POST — тянуть ради
   него библиотеку с CDN значит сломать работу без интернета и добавить
   чужой домен в критический путь.

   Ключ лежит отдельно от остальных данных и НЕ попадает в резервные копии. */

const KEY_STORAGE = 'lifeos.milpa.aikey';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';
const API_VERSION = '2023-06-01';

/* Длинная сторона снимка. Больше — дороже и медленнее, меньше — мелкий
   текст на чеке перестаёт читаться. 1600 px держит баланс. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/* ─────────── Ключ ─────────── */

export function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

export function setKey(value) {
  try {
    const v = String(value || '').trim();
    if (v) localStorage.setItem(KEY_STORAGE, v);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* приватный режим */ }
}

export const hasKey = () => !!getKey();

/* ─────────── Подготовка снимка ─────────── */

/** Файл → уменьшенный JPEG в base64. Большие фото с телефона
    иначе отправляются целиком: дорого, медленно и без пользы. */
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  const base64 = await blobToBase64(blob);

  return { base64, mediaType: 'image/jpeg', width: w, height: h, bytes: blob.size };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    // результат вида "data:image/jpeg;base64,XXXX" — нужна только часть после запятой
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

/* ─────────── Запрос ─────────── */

const SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    kind: { type: 'string', enum: ['expense', 'income', 'unknown'] },
    amount: { type: 'number' },
    currency: { type: 'string', enum: ['MXN', 'USD', 'unknown'] },
    date: { type: 'string' },
    merchant: { type: 'string' },
    category: { type: 'string' },
    note: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    problem: { type: 'string' },
  },
  required: ['readable', 'kind', 'amount', 'currency', 'date',
             'merchant', 'category', 'note', 'confidence', 'problem'],
  additionalProperties: false,
};

function buildPrompt({ categories, today, bookName }) {
  return `You are reading a photo or screenshot sent by the owner of a small business in Mexico City. It is one of: a store or restaurant receipt (ticket), a bank transfer confirmation from a Mexican banking app, an invoice (factura/CFDI), or a payment screen.

Extract a single transaction. Rules:

- amount: the FINAL total actually paid, in major units (e.g. 1450.50). On a Mexican ticket this is the line marked TOTAL, not SUBTOTAL and not the IVA line. If a tip (propina) is included in the total, use the total including it. If several totals appear, take the one actually charged.
- currency: MXN unless the document clearly shows US dollars (USD, DLS, "dólares"). Mexican receipts use "$" for pesos — do not read "$" as dollars.
- date: the transaction date as YYYY-MM-DD. Mexican documents are day/month/year. If no date is visible, use "${today}".
- kind: "expense" when money left the account (a purchase, a payment, a transfer sent). "income" when money arrived (a transfer received, a deposit, a sale). If genuinely unclear, "unknown".
- merchant: who was paid, or who paid. Short, as printed.
- category: choose the single best match from this list, copied exactly: ${categories.join(' | ')}. If nothing fits, return "".
- note: a short human description in Russian, e.g. "Обед с клиентом" or "Перевод от клиента". Max 60 characters.
- confidence: "high" if the total and date are clearly legible; "medium" if you had to infer something; "low" if the image is blurry, cropped or ambiguous.
- readable: false if this is not a financial document at all, or nothing can be extracted. Then put the reason in "problem" (in Russian) and leave the other fields empty or 0.
- problem: "" when readable is true.

These numbers become accounting entries for the wallet "${bookName}". Never invent a value you cannot see — lower the confidence or set readable=false instead.`;
}

class AiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/** Отправить снимок и получить разобранную операцию. */
export async function readReceipt({ base64, mediaType, categories, today, bookName, signal }) {
  const key = getKey();
  if (!key) throw new AiError('no-key');

  const body = {
    model: MODEL,
    max_tokens: 2048,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [{
      role: 'user',
      content: [
        // снимок раньше текста — так модель читает документы точнее
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: buildPrompt({ categories, today, bookName }) },
      ],
    }],
  };

  const res = await post(body, key, signal);
  const json = await res.json();

  if (json.stop_reason === 'refusal') {
    throw new AiError('refused', json.stop_details?.explanation || '');
  }

  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new AiError('bad-answer', text.slice(0, 200)); }

  return normalise(parsed);
}

async function post(body, key, signal) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new AiError('cancelled');
    throw new AiError('network', e.message);
  }

  if (res.ok) return res;

  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* не JSON */ }

  if (res.status === 401 || res.status === 403) throw new AiError('bad-key', detail);
  if (res.status === 429) throw new AiError('rate-limit', detail);
  if (res.status === 400) throw new AiError('bad-request', detail);
  if (res.status >= 500) throw new AiError('server', detail);
  throw new AiError('http-' + res.status, detail);
}

/** Приводим ответ к тому, что ждёт форма операции. */
function normalise(raw) {
  const amountCents = Math.round(Math.abs(Number(raw.amount) || 0) * 100);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : null;

  return {
    readable: raw.readable === true && amountCents > 0,
    kind: raw.kind === 'income' ? 'income' : 'expense',
    kindKnown: raw.kind === 'income' || raw.kind === 'expense',
    amountCents,
    currency: raw.currency === 'USD' ? 'USD' : (raw.currency === 'MXN' ? 'MXN' : null),
    date,
    merchant: String(raw.merchant || '').trim().slice(0, 80),
    category: String(raw.category || '').trim(),
    note: String(raw.note || '').trim().slice(0, 80),
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    problem: String(raw.problem || '').trim(),
  };
}

/** Проверка ключа — один дешёвый запрос без картинки. */
export async function testKey(key) {
  const saved = getKey();
  setKey(key);
  try {
    await post({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'ok' }],
    }, key);
    return { ok: true };
  } catch (e) {
    setKey(saved);
    return { ok: false, code: e.code, detail: e.message };
  }
}

export { AiError };


/* ─────────── Выписка в PDF ─────────── */

/* Ограничения Claude: 32 МБ на запрос и 600 страниц. Выписка за месяц
   в них укладывается с огромным запасом, но проверить дешевле, чем
   получить отказ после минуты ожидания. */
export const PDF_MAX_BYTES = 28 * 1024 * 1024;

const STATEMENT_SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    problem: { type: 'string' },
    currency: { type: 'string', enum: ['MXN', 'USD', 'unknown'] },
    account: { type: 'string' },
    period: { type: 'string' },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          kind: { type: 'string', enum: ['expense', 'income'] },
          amount: { type: 'number' },
          merchant: { type: 'string' },
          note: { type: 'string' },
          category: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['date', 'kind', 'amount', 'merchant', 'note', 'category', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['readable', 'problem', 'currency', 'account', 'period', 'transactions'],
  additionalProperties: false,
};

function statementPrompt({ categories, bookName }) {
  return `This PDF is a bank statement (estado de cuenta) from a Mexican bank, belonging to the owner of a small business in Mexico City. Extract EVERY transaction line, in the order they appear.

Rules:

- Extract only real movements of money. Skip: opening and closing balances, subtotals, page totals, interest-rate tables, advertising, legal notices, and any summary block that repeats amounts already listed as individual lines.
- date: YYYY-MM-DD. Mexican statements are day/month/year, and the year often appears only in the period header — use it. Statements sometimes show two dates per line (operation and settlement); use the operation date.
- amount: the amount of that single line, as a positive number in major units (1450.50). Never a running balance.
- kind: "expense" when money left the account (CARGO, RETIRO, COMPRA, PAGO, TRASPASO ENVIADO). "income" when money arrived (ABONO, DEPOSITO, TRASPASO RECIBIDO, SPEI RECIBIDO).
- merchant: the counterparty as printed, trimmed of reference numbers when they are clearly separate. Keep it short.
- note: a short description in Russian, up to 60 characters.
- category: the single best match from this list, copied exactly: ${categories.join(' | ')}. Return "" if nothing fits.
- confidence: "low" for any line where the amount or date was hard to read; "high" only when both are unmistakable.
- currency: MXN unless the statement is clearly in US dollars. "$" on a Mexican statement means pesos.
- account: the account number as printed, or "".
- period: the statement period as printed, or "".
- readable: false only if this is not a bank statement or no lines could be read. Then explain in "problem" in Russian and return an empty list.

These become accounting entries for the wallet "${bookName}". A missed line is better than an invented one: never output a transaction you cannot actually see.`;
}

/** Прочитать выписку целиком. Возвращает список операций для проверки человеком. */
export async function readStatement({ base64, categories, bookName, signal }) {
  const key = getKey();
  if (!key) throw new AiError('no-key');

  const body = {
    model: MODEL,
    // выписка может быть длинной: места должно хватить на все строки
    max_tokens: 16000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: STATEMENT_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: [
        // документ раньше текста — так модель читает точнее
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: statementPrompt({ categories, bookName }) },
      ],
    }],
  };

  const res = await post(body, key, signal);
  const json = await res.json();

  if (json.stop_reason === 'refusal') {
    throw new AiError('refused', json.stop_details?.explanation || '');
  }
  if (json.stop_reason === 'max_tokens') {
    throw new AiError('too-long');
  }

  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new AiError('bad-answer', text.slice(0, 200)); }

  return {
    readable: parsed.readable === true,
    problem: String(parsed.problem || '').trim(),
    currency: parsed.currency === 'USD' ? 'USD' : (parsed.currency === 'MXN' ? 'MXN' : null),
    account: String(parsed.account || '').trim(),
    period: String(parsed.period || '').trim(),
    transactions: (parsed.transactions || [])
      .map(normaliseLine)
      .filter(Boolean),
  };
}

function normaliseLine(raw) {
  const amountCents = Math.round(Math.abs(Number(raw.amount) || 0) * 100);
  if (!amountCents) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) return null;

  return {
    date: raw.date,
    kind: raw.kind === 'income' ? 'income' : 'expense',
    amount: amountCents,
    merchant: String(raw.merchant || '').trim().slice(0, 80),
    note: String(raw.note || '').trim().slice(0, 80),
    category: String(raw.category || '').trim(),
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
  };
}

/** Файл PDF → base64 без заголовка. */
export function pdfToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;   // по частям: длинный apply переполняет стек
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Код ошибки → понятный текст. */
export function aiMessage(t, e) {
  const map = {
    'no-key': 'ai_no_key',
    'bad-key': 'ai_bad_key',
    'rate-limit': 'ai_rate_limit',
    'network': 'ai_network',
    'server': 'ai_server',
    'refused': 'ai_refused',
    'bad-answer': 'ai_bad_answer',
    'bad-request': 'ai_bad_request',
    'too-long': 'ai_too_long',
    'cancelled': 'cancel',
  };
  const key = map[e?.code];
  return key ? t(key) : (t('ai_failed') + (e?.message ? ': ' + e.message.slice(0, 120) : ''));
}
