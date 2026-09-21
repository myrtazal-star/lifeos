/* Генератор иконок приложений: рисует фигуры и пишет PNG без сторонних библиотек.
   Сглаживание — усреднением 4×4 подпикселей. */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/* ─────── PNG ─────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // бит на канал
  ihdr[9] = 6;      // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // фильтр «none»
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ─────── Фигуры (функция расстояния: <=0 значит «внутри») ─────── */

const roundedRect = (cx, cy, w, h, r) => (x, y) => {
  const qx = Math.abs(x - cx) - (w / 2 - r);
  const qy = Math.abs(y - cy) - (h / 2 - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Капсула — отрезок заданной толщины со скруглёнными концами. */
const capsule = (x1, y1, x2, y2, r) => (x, y) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) - r;
};

const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

const union = (...fs) => (x, y) => Math.min(...fs.map(f => f(x, y)));
const subtract = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));

const hex = (s) => {
  const v = s.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

/** Слои рисуются по порядку, каждый — {shape, color}. */
function render(size, layers) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;                       // подпикселей на сторону
  const step = 1 / SS;
  const offset = step / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (const layer of layers) {
        const [lr, lg, lb] = hex(layer.color);
        let cov = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const x = px + offset + sx * step;
            const y = py + offset + sy * step;
            if (layer.shape(x, y) <= 0) cov++;
          }
        }
        const alpha = (cov / (SS * SS)) * (layer.alpha ?? 1);
        if (alpha <= 0) continue;
        // обычное наложение «source-over»
        r = lr * alpha + r * (1 - alpha);
        g = lg * alpha + g * (1 - alpha);
        b = lb * alpha + b * (1 - alpha);
        a = alpha + a * (1 - alpha);
      }

      const i = (py * size + px) * 4;
      buf[i] = Math.round(r); buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b); buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

/* ─────── Рисунки приложений ─────── */

/** Milpa — три восходящих столбика (рост капитала). */
function milpaLayers(S, { maskable = false } = {}) {
  const bgRadius = maskable ? S / 2 : S * 0.225;
  const bg = maskable
    ? roundedRect(S / 2, S / 2, S, S, 0)          // во весь квадрат: систему сама обрежет
    : roundedRect(S / 2, S / 2, S, S, bgRadius);

  // при maskable значок ужимаем в безопасную зону (центральные 80%)
  const k = maskable ? 0.72 : 1;
  const u = S / 100 * k;
  const cx = S / 2, cy = S / 2;
  const w = 13 * u, gap = 20 * u, r = 5 * u;
  const base = cy + 26 * u;
  const heights = [30, 44, 58].map(h => h * u);

  const bars = heights.map((h, i) =>
    roundedRect(cx + (i - 1) * gap, base - h / 2, w, h, r));

  return [
    { shape: bg, color: '#10b981' },
    { shape: union(...bars), color: '#04231a' },
  ];
}

/** Ritmo — галочка в круге (дисциплина, замкнутый круг дня). */
function ritmoLayers(S, { maskable = false } = {}) {
  const bg = maskable
    ? roundedRect(S / 2, S / 2, S, S, 0)
    : roundedRect(S / 2, S / 2, S, S, S * 0.225);

  const k = maskable ? 0.72 : 1;
  const u = S / 100 * k;
  const cx = S / 2, cy = S / 2;

  const ring = subtract(circle(cx, cy, 33 * u), circle(cx, cy, 25.5 * u));
  const check = union(
    capsule(cx - 14 * u, cy + 1 * u, cx - 4 * u, cy + 11 * u, 4.6 * u),
    capsule(cx - 4 * u, cy + 11 * u, cx + 15 * u, cy - 11 * u, 4.6 * u),
  );

  return [
    { shape: bg, color: '#7c5cff' },
    { shape: ring, color: '#ffffff', alpha: 0.38 },
    { shape: check, color: '#ffffff' },
  ];
}

/* ─────── Сборка ─────── */

const APPS = {
  milpa: milpaLayers,
  ritmo: ritmoLayers,
};

const SIZES = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'favicon-64.png', size: 64 },
];

const rootDir = resolve(import.meta.dirname, '..');

for (const [app, layersFn] of Object.entries(APPS)) {
  const dir = resolve(rootDir, 'apps', app, 'icons');
  mkdirSync(dir, { recursive: true });

  for (const spec of SIZES) {
    const rgba = render(spec.size, layersFn(spec.size, { maskable: spec.maskable }));
    const png = encodePNG(spec.size, spec.size, rgba);
    writeFileSync(resolve(dir, spec.name), png);
    console.log(`${app}/${spec.name.padEnd(24)} ${String(png.length).padStart(7)} байт`);
  }
}
