// Evidence uploads: check the real file type from its first bytes (not the browser's claim),
// and remove embedded metadata (GPS position, camera, time) from photos before storing them.
// Videos cannot have metadata removed without extra software, so they are only ever shown to staff.

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image', ext: '.jpg', mime: 'image/jpeg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image', ext: '.png', mime: 'image/png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { type: 'image', ext: '.webp', mime: 'image/webp' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    return brand.startsWith('qt') ? { type: 'video', ext: '.mov', mime: 'video/quicktime' } : { type: 'video', ext: '.mp4', mime: 'video/mp4' };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { type: 'video', ext: '.webm', mime: 'video/webm' };
  return null;
}

// JPEG: drop APP1–APP15 (EXIF, XMP, ICC…) and comment segments before the image data
function stripJpeg(buf) {
  const out = [buf.slice(0, 2)];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) return buf; // unexpected; keep original rather than corrupt it
    const m = buf[i + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(buf.slice(i, i + 2)); i += 2; continue; }
    if (m === 0xda) { out.push(buf.slice(i)); break; } // start of scan: copy the rest
    const len = buf.readUInt16BE(i + 2);
    const keep = !((m >= 0xe1 && m <= 0xef) || m === 0xfe);
    if (keep) out.push(buf.slice(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}
// PNG: drop text, EXIF and time chunks
function stripPng(buf) {
  const out = [buf.slice(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8);
    const end = i + 12 + len;
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) out.push(buf.slice(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}
// WebP: drop EXIF and XMP chunks and clear their flags
function stripWebp(buf) {
  const chunks = [];
  let i = 12, vp8x = null;
  while (i + 8 <= buf.length) {
    const type = buf.toString('ascii', i, i + 4), len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    const c = Buffer.from(buf.slice(i, end));
    if (type === 'VP8X') vp8x = c;
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push(c);
    i = end;
  }
  if (vp8x) vp8x[8] &= ~(0x08 | 0x04);
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, body]);
}

function clean(buf) {
  const kind = sniff(buf);
  if (!kind) return null;
  let data = buf;
  try {
    if (kind.ext === '.jpg') data = stripJpeg(buf);
    else if (kind.ext === '.png') data = stripPng(buf);
    else if (kind.ext === '.webp') data = stripWebp(buf);
  } catch (e) { data = buf; kind.unstripped = true; }
  return { ...kind, data };
}

module.exports = { sniff, clean, stripJpeg, stripPng, stripWebp };
