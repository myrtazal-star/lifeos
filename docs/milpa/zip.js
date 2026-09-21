/* Чтение ZIP-архивов прямо в браузере.

   Банки нередко отдают выписку архивом, а не готовым файлом. Распаковка
   делается встроенным в браузер разжатием (DecompressionStream) — библиотека
   не нужна, и приложение остаётся без зависимостей.

   Разбираем по оглавлению в конце архива, а не по заголовкам подряд:
   у части архивов длины в локальных заголовках не заполнены. */

const SIG_EOCD = 0x06054b50;   // конец оглавления
const SIG_ENTRY = 0x02014b50;  // запись оглавления

export const looksLikeZip = (bytes) =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
  (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);

export function supported() {
  return typeof DecompressionStream === 'function';
}

/** Список файлов в архиве: [{ name, size, read() }] */
export function listZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const eocd = findEOCD(view, bytes.length);
  if (eocd < 0) throw new Error('not-a-zip');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length) break;
    if (view.getUint32(offset, true) !== SIG_ENTRY) break;

    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = new TextDecoder('utf-8')
      .decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    offset += 46 + nameLen + extraLen + commentLen;

    // папки внутри архива нам не нужны
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;

    entries.push({
      name, size, method,
      read: () => readEntry(view, bytes, localOffset, method, compSize),
    });
  }

  return entries;
}

function findEOCD(view, length) {
  // оглавление в конце, но после него может быть комментарий — ищем назад
  const from = Math.max(0, length - 66000);
  for (let i = length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

async function readEntry(view, bytes, localOffset, method, compSize) {
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLen + extraLen;
  const chunk = bytes.subarray(start, start + compSize);

  if (method === 0) return chunk.slice().buffer;          // без сжатия
  if (method !== 8) throw new Error('unsupported-method');
  if (!supported()) throw new Error('no-decompressor');

  const stream = new Blob([chunk]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

/** Выбрать из архива файл, похожий на выписку. */
export function pickStatement(entries) {
  const score = (name) => {
    const n = name.toLowerCase();
    if (n.endsWith('.csv')) return 3;
    if (n.endsWith('.txt')) return 2;
    if (/\.(xls|xlsx|pdf)$/.test(n)) return -1;   // поддержим отдельно
    return 1;
  };
  const ranked = entries
    .map(e => ({ e, s: score(e.name) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.e.size - a.e.size);

  return ranked[0]?.e || null;
}
