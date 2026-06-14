// Gerador de ícones WideTV — puro Node.js, sem dependências
import { writeFileSync } from 'fs';

// CRC32 para chunks PNG
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32BE(n) {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
}

// Deflate/zlib simplificado (sem compressão — raw deflate blocks)
function deflateRaw(data) {
  const BLOCK_SIZE = 65535;
  const out = [];
  // zlib header (CM=8, CINFO=7, FLEVEL=0, FCHECK)
  out.push(0x78, 0x01);
  for (let i = 0; i < data.length; i += BLOCK_SIZE) {
    const block = data.slice(i, i + BLOCK_SIZE);
    const isLast = (i + BLOCK_SIZE >= data.length) ? 1 : 0;
    out.push(isLast);
    const len = block.length;
    out.push(len & 0xFF, (len >> 8) & 0xFF, (~len) & 0xFF, ((~len) >> 8) & 0xFF);
    for (const b of block) out.push(b);
  }
  // Adler-32
  let a = 1, b = 0;
  for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  out.push((b >> 8) & 0xFF, b & 0xFF, (a >> 8) & 0xFF, a & 0xFF);
  return new Uint8Array(out);
}

function makePNG(pixels, size) {
  // pixels: Uint8Array de size*size*4 (RGBA)
  // Scanlines com filtro 0
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (size * 4 + 1) + 1 + x * 4;
      raw[dst] = pixels[src]; raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2]; raw[dst+3] = pixels[src+3];
    }
  }

  const compressed = deflateRaw(raw);

  function chunk(type, data) {
    const typeBytes = [...type].map(c => c.charCodeAt(0));
    const crcData = new Uint8Array([...typeBytes, ...data]);
    return [...uint32BE(data.length), ...typeBytes, ...data, ...uint32BE(crc32(crcData))];
  }

  const ihdr = [...uint32BE(size), ...uint32BE(size), 8, 2, 0, 0, 0]; // RGB
  // Convert RGBA to RGB
  const rgbData = [];
  for (let i = 0; i < pixels.length; i += 4) {
    rgbData.push(pixels[i], pixels[i+1], pixels[i+2]);
  }
  // Redo with RGB
  const rawRGB = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    rawRGB[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (size * 3 + 1) + 1 + x * 3;
      rawRGB[dst] = pixels[src]; rawRGB[dst+1] = pixels[src+1]; rawRGB[dst+2] = pixels[src+2];
    }
  }
  const compRGB = deflateRaw(rawRGB);

  const bytes = [
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', [...compRGB]),
    ...chunk('IEND', []),
  ];
  return Buffer.from(bytes);
}

// Desenha o ícone WideTV em um array de pixels RGBA
function drawWideTV(size, isAdaptive = false) {
  const pixels = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blending sobre o existente
    const alpha = a / 255;
    pixels[i]   = Math.round(pixels[i]   * (1-alpha) + r * alpha);
    pixels[i+1] = Math.round(pixels[i+1] * (1-alpha) + g * alpha);
    pixels[i+2] = Math.round(pixels[i+2] * (1-alpha) + b * alpha);
    pixels[i+3] = 255;
  }

  function fillRect(x0, y0, w, h, r, g, b, a = 255) {
    for (let y = y0; y < y0+h; y++)
      for (let x = x0; x < x0+w; x++)
        setPixel(x, y, r, g, b, a);
  }

  function fillCircle(cx, cy, radius, r, g, b, a = 255) {
    for (let y = cy-radius; y <= cy+radius; y++)
      for (let x = cx-radius; x <= cx+radius; x++)
        if ((x-cx)**2 + (y-cy)**2 <= radius**2)
          setPixel(x, y, r, g, b, a);
  }

  function drawLine(x0, y0, x1, y1, thickness, r, g, b) {
    const dx = x1-x0, dy = y1-y0, len = Math.sqrt(dx*dx+dy*dy);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i/steps;
      const cx = Math.round(x0 + dx*t), cy = Math.round(y0 + dy*t);
      fillCircle(cx, cy, Math.round(thickness/2), r, g, b);
    }
  }

  // ── Fundo ──────────────────────────────────────────────────────────────
  const [bgR, bgG, bgB] = isAdaptive ? [13, 27, 53] : [10, 15, 30];
  fillRect(0, 0, size, size, bgR, bgG, bgB);

  // ── Corpo da TV ─────────────────────────────────────────────────────────
  const tvW = Math.round(size * 0.60);
  const tvH = Math.round(size * 0.46);
  const tvX = Math.round((size - tvW) / 2);
  const tvY = Math.round(size * 0.32);

  // Fill TV (azul escuro)
  fillRect(tvX, tvY, tvW, tvH, 20, 45, 95, 80);

  // Border TV (azul claro)
  const bord = Math.round(size * 0.025);
  for (let t = 0; t < bord; t++) {
    for (let x = tvX+t; x < tvX+tvW-t; x++) {
      setPixel(x, tvY+t, 74, 158, 255);
      setPixel(x, tvY+tvH-1-t, 74, 158, 255);
    }
    for (let y = tvY+t; y < tvY+tvH-t; y++) {
      setPixel(tvX+t, y, 74, 158, 255);
      setPixel(tvX+tvW-1-t, y, 74, 158, 255);
    }
  }

  // ── Antenas ──────────────────────────────────────────────────────────────
  const antMidX = Math.round(size / 2);
  const antBaseY = tvY - Math.round(size * 0.01);
  const antTopY  = tvY - Math.round(size * 0.13);
  const antL = Math.round(size * 0.18);
  const thick = Math.round(size * 0.022);

  drawLine(antMidX, antBaseY, antMidX - antL, antTopY, thick, 74, 158, 255);
  drawLine(antMidX, antBaseY, antMidX + antL, antTopY, thick, 74, 158, 255);
  fillCircle(antMidX - antL, antTopY, Math.round(thick * 1.2), 74, 158, 255);
  fillCircle(antMidX + antL, antTopY, Math.round(thick * 1.2), 74, 158, 255);

  // ── Letra "W" dentro da TV ────────────────────────────────────────────────
  // Desenha W pixel-por-pixel (bitmap simples escalado)
  const wBitmap = [
    [1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1],
    [1,0,0,1,0,0,1],
    [1,0,1,0,1,0,1],
    [1,1,0,0,0,1,1],
    [1,0,0,0,0,0,1],
    [0,0,0,0,0,0,0],
  ];
  const wH = wBitmap.length;
  const wW = wBitmap[0].length;
  const wScale = Math.round(tvH * 0.65 / wH);
  const wTotalW = wW * wScale;
  const wTotalH = wH * wScale;
  const wStartX = tvX + Math.round((tvW - wTotalW) / 2);
  const wStartY = tvY + Math.round((tvH - wTotalH) / 2);

  for (let row = 0; row < wH; row++) {
    for (let col = 0; col < wW; col++) {
      if (wBitmap[row][col]) {
        for (let dy = 0; dy < wScale; dy++)
          for (let dx = 0; dx < wScale; dx++)
            setPixel(wStartX + col*wScale + dx, wStartY + row*wScale + dy, 255, 255, 255);
      }
    }
  }

  return pixels;
}

const SIZE = 1024;
const paths = [
  ['assets/icon.png', false],
  ['assets/adaptive-icon.png', true],
  ['assets/splash-icon.png', false],
];

for (const [relPath, isAdaptive] of paths) {
  const pixels = drawWideTV(SIZE, isAdaptive);
  const png = makePNG(pixels, SIZE);
  writeFileSync(relPath, png);
  console.log(`✓ ${relPath} (${SIZE}x${SIZE})`);
}
console.log('Ícones gerados com sucesso!');
