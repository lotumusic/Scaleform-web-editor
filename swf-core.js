// swf-core.js: SWF / Scaleform GFx parsing, display-list evaluation and
// PlaceObject rewriting. No DOM use, so it runs in the browser and in Node.
(function (global) {
  'use strict';

  // ---------- byte / bit readers ----------
  class Reader {
    constructor(bytes, pos = 0) {
      this.b = bytes; this.pos = pos; this.bitPos = 0; this.bitBuf = 0;
      this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    align() { this.bitPos = 0; }
    u8() { this.align(); return this.b[this.pos++]; }
    u16() { this.align(); const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
    s16() { this.align(); const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
    u32() { this.align(); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
    bytes(n) { this.align(); const v = this.b.subarray(this.pos, this.pos + n); this.pos += n; return v; }
    str() {
      this.align(); const s = this.pos;
      while (this.pos < this.b.length && this.b[this.pos] !== 0) this.pos++;
      const v = utf8(this.b.subarray(s, this.pos)); this.pos++; return v;
    }
    ub(n) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (this.bitPos === 0) { this.bitBuf = this.b[this.pos++]; this.bitPos = 8; }
        this.bitPos--;
        v = (v * 2) + ((this.bitBuf >> this.bitPos) & 1);
      }
      return v;
    }
    sb(n) {
      if (n === 0) return 0;
      const v = this.ub(n);
      const sign = Math.pow(2, n - 1);
      return v >= sign ? v - sign * 2 : v;
    }
    fb(n) { return this.sb(n) / 65536; }
    rect() {
      const n = this.ub(5);
      const r = { xmin: this.sb(n), xmax: this.sb(n), ymin: this.sb(n), ymax: this.sb(n) };
      this.align(); return r;
    }
    rgb() { return [this.u8(), this.u8(), this.u8(), 255]; }
    rgba() { return [this.u8(), this.u8(), this.u8(), this.u8()]; }
    matrix() {
      this.align();
      const m = [1, 0, 0, 1, 0, 0];
      if (this.ub(1)) { const n = this.ub(5); m[0] = this.fb(n); m[3] = this.fb(n); }
      if (this.ub(1)) { const n = this.ub(5); m[1] = this.fb(n); m[2] = this.fb(n); }
      const n = this.ub(5); m[4] = this.sb(n); m[5] = this.sb(n);
      this.align(); return m;
    }
    cxform(alpha) {
      this.align();
      const hasAdd = this.ub(1), hasMult = this.ub(1), n = this.ub(4);
      const c = { m: [256, 256, 256, 256], a: [0, 0, 0, 0] };
      const k = alpha ? 4 : 3;
      if (hasMult) for (let i = 0; i < k; i++) c.m[i] = this.sb(n);
      if (hasAdd) for (let i = 0; i < k; i++) c.a[i] = this.sb(n);
      this.align(); return c;
    }
  }

  class Writer {
    constructor() { this.chunks = []; this.cur = []; this.bitPos = 8; this.len = 0; }
    _flushBits() { this.bitPos = 8; }
    u8(v) { this._flushBits(); this.cur.push(v & 255); }
    u16(v) { this.u8(v); this.u8(v >> 8); }
    u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
    s16(v) { this.u16(v & 0xffff); }
    bytes(arr) { this._flushBits(); for (let i = 0; i < arr.length; i++) this.cur.push(arr[i]); }
    str(s) { this.bytes(utf8enc(s)); this.u8(0); }
    ub(n, v) {
      for (let i = n - 1; i >= 0; i--) {
        if (this.bitPos === 8) { this.cur.push(0); this.bitPos = 0; }
        const bit = Math.floor(v / Math.pow(2, i)) & 1;
        this.cur[this.cur.length - 1] |= bit << (7 - this.bitPos);
        this.bitPos++;
      }
    }
    sb(n, v) { this.ub(n, v < 0 ? v + Math.pow(2, n) : v); }
    rect(r) {
      this._flushBits();
      const n = Math.max(sbits(r.xmin), sbits(r.xmax), sbits(r.ymin), sbits(r.ymax));
      this.ub(5, n); this.sb(n, r.xmin); this.sb(n, r.xmax); this.sb(n, r.ymin); this.sb(n, r.ymax);
      this._flushBits();
    }
    matrix(m) { this.bytes(encodeMatrix(m)); }
    rgba(c) { this.u8(c[0]); this.u8(c[1]); this.u8(c[2]); this.u8(c[3]); }
    toBytes() { return Uint8Array.from(this.cur); }
  }

  function sbits(v) {
    v = Math.round(v);
    if (v === 0) return 0;
    let n = 1;
    while (!(v >= -Math.pow(2, n - 1) && v < Math.pow(2, n - 1))) n++;
    return n;
  }

  function encodeMatrix(m) {
    const w = new Writer();
    const a = Math.round(m[0] * 65536), d = Math.round(m[3] * 65536);
    const b = Math.round(m[1] * 65536), c = Math.round(m[2] * 65536);
    const tx = Math.round(m[4]), ty = Math.round(m[5]);
    w.bitPos = 8;
    if (a !== 65536 || d !== 65536) {
      const n = Math.max(sbits(a), sbits(d));
      w.ub(1, 1); w.ub(5, n); w.sb(n, a); w.sb(n, d);
    } else w.ub(1, 0);
    if (b !== 0 || c !== 0) {
      const n = Math.max(sbits(b), sbits(c));
      w.ub(1, 1); w.ub(5, n); w.sb(n, b); w.sb(n, c);
    } else w.ub(1, 0);
    const n = Math.max(sbits(tx), sbits(ty));
    w.ub(5, n); w.sb(n, tx); w.sb(n, ty);
    return w.toBytes();
  }

  function encodeCxform(cx, alpha) {
    const w = new Writer(); const k = alpha ? 4 : 3;
    const m = cx.m.slice(0, k).map(Math.round), a = cx.a.slice(0, k).map(Math.round);
    const hasMult = m.some((v) => v !== 256), hasAdd = a.some((v) => v !== 0);
    const n = Math.max(1, ...(hasMult ? m : []).map(sbits), ...(hasAdd ? a : []).map(sbits));
    w.ub(1, hasAdd ? 1 : 0); w.ub(1, hasMult ? 1 : 0); w.ub(4, n);
    if (hasMult) for (const v of m) w.sb(n, v);
    if (hasAdd) for (const v of a) w.sb(n, v);
    return w.toBytes();
  }

  function utf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return String.fromCharCode.apply(null, bytes);
  }
  function utf8enc(s) { return new TextEncoder().encode(s); }

  function concat(arrs) {
    let n = 0; for (const a of arrs) n += a.length;
    const out = new Uint8Array(n); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const chunks = []; const rd = stream.getReader();
    // A truncated or padded zlib stream can error after all data arrived; keep what we got.
    try { for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); } }
    catch (e) { if (!chunks.length) throw e; }
    return concat(chunks);
  }
  async function deflate(bytes) {
    const cs = new CompressionStream('deflate');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  }

  // ---------- tag names ----------
  const TAG = {
    End: 0, ShowFrame: 1, DefineShape: 2, PlaceObject: 4, RemoveObject: 5, DefineBits: 6,
    DefineButton: 7, JPEGTables: 8, SetBackgroundColor: 9, DefineText: 11, DefineBitsLossless: 20,
    DefineBitsJPEG2: 21, DefineShape2: 22, PlaceObject2: 26, RemoveObject2: 28, DefineShape3: 32,
    DefineText2: 33, DefineButton2: 34, DefineBitsJPEG3: 35, DefineBitsLossless2: 36,
    DefineEditText: 37, DefineSprite: 39, FrameLabel: 43, DefineMorphShape: 46, DefineFont2: 48,
    ExportAssets: 56, ImportAssets: 57, PlaceObject3: 70, ImportAssets2: 71, DefineFont3: 75,
    SymbolClass: 76, DoABC: 82, DefineShape4: 83, DefineMorphShape2: 84, DefineBitsJPEG4: 90,
    DefineExternalImage: 1001, DefineExternalImage2: 1009,
  };
  const SHAPE_TAGS = new Set([2, 22, 32, 83]);

  // ---------- container ----------
  async function decodeContainer(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    const version = bytes[3];
    const declaredLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    let body;
    if (sig === 'FWS' || sig === 'GFX') body = bytes.subarray(8);
    else if (sig === 'CWS' || sig === 'CFX') body = await inflate(bytes.subarray(8));
    else if (sig === 'ZWS') throw new Error('This SWF uses LZMA compression. Open it in JPEXS FFDec, choose File → Save as uncompressed (or zlib), then load that file.');
    else throw new Error('Not a SWF or Scaleform file (header "' + sig.replace(/[^\x20-\x7e]/g, '?') + '").');
    return { sig, version, declaredLen, body };
  }

  function parseTags(bytes, start, end) {
    const r = new Reader(bytes, start); const tags = [];
    while (r.pos + 2 <= end) {
      const hdr = r.u16(); const code = hdr >> 6; let len = hdr & 0x3f; let long = false;
      if (len === 0x3f) { len = r.u32(); long = true; }
      const bodyEnd = Math.min(r.pos + len, end);
      const tag = { code, long, body: bytes.slice(r.pos, bodyEnd) };
      r.pos = bodyEnd;
      if (code === TAG.DefineSprite) parseSpriteTag(tag);
      tags.push(tag);
      if (code === TAG.End) break;
    }
    return { tags, trailing: r.pos < end ? bytes.slice(r.pos, end) : null };
  }

  function parseSpriteTag(tag) {
    const b = tag.body; const r = new Reader(b);
    tag.spriteId = r.u16(); tag.frameCount = r.u16();
    const p = parseTags(b, 4, b.length);
    tag.children = p.tags; tag.trailing = p.trailing;
  }

  function serializeTags(tags, trailing) {
    const parts = [];
    for (const t of tags) {
      let body = t.body;
      if (t.code === TAG.DefineSprite && t.children) {
        const w = new Writer(); w.u16(t.spriteId); w.u16(t.frameCount);
        body = concat([w.toBytes(), serializeTags(t.children, t.trailing)]);
        t.body = body;
      }
      const w = new Writer();
      if (t.long || body.length >= 0x3f) { w.u16((t.code << 6) | 0x3f); w.u32(body.length); }
      else w.u16((t.code << 6) | body.length);
      parts.push(w.toBytes(), body);
    }
    if (trailing) parts.push(trailing);
    return concat(parts);
  }

  async function load(input) {
    const c = await decodeContainer(input);
    const r = new Reader(c.body);
    const stage = r.rect();
    const frameRate = r.u16() / 256, frameCount = r.u16();
    const headerBytes = c.body.slice(0, r.pos);
    const p = parseTags(c.body, r.pos, c.body.length);
    const movie = {
      sig: c.sig, version: c.version, stage, frameRate, frameCount, headerBytes,
      tags: p.tags, trailing: p.trailing, dict: new Map(), names: new Map(), imports: [],
      warnings: [],
    };
    if (c.declaredLen !== c.body.length + 8) movie.warnings.push('File length in header (' + c.declaredLen + ') differs from actual (' + (c.body.length + 8) + '); export will write the correct length.');
    buildDictionary(movie);
    return movie;
  }

  async function save(movie, { compress } = {}) {
    const tagBytes = serializeTags(movie.tags, movie.trailing);
    const body = concat([movie.headerBytes, tagBytes]);
    let sig = movie.sig;
    if (compress === false) sig = sig === 'CFX' ? 'GFX' : sig === 'CWS' ? 'FWS' : sig;
    if (compress === true) sig = sig === 'GFX' ? 'CFX' : sig === 'FWS' ? 'CWS' : sig;
    const hdr = new Uint8Array(8);
    hdr[0] = sig.charCodeAt(0); hdr[1] = sig.charCodeAt(1); hdr[2] = sig.charCodeAt(2); hdr[3] = movie.version;
    new DataView(hdr.buffer).setUint32(4, body.length + 8, true);
    const payload = (sig === 'CWS' || sig === 'CFX') ? await deflate(body) : body;
    return concat([hdr, payload]);
  }

  // ---------- dictionary ----------
  function buildDictionary(movie) {
    const visit = (tags) => {
      for (const t of tags) {
        try { defineFromTag(movie, t); } catch (e) { movie.warnings.push('Could not read tag ' + t.code + ': ' + e.message); }
        if (t.code === TAG.DefineSprite && t.children) visit(t.children);
      }
    };
    visit(movie.tags);
  }

  function defineFromTag(movie, t) {
    const r = new Reader(t.body);
    const d = movie.dict;
    switch (t.code) {
      case 2: case 22: case 32: case 83: {
        const id = r.u16(); const bounds = r.rect();
        d.set(id, { type: 'shape', id, bounds, tag: t }); break;
      }
      case TAG.DefineSprite: d.set(t.spriteId, { type: 'sprite', id: t.spriteId, tag: t, frameCount: t.frameCount }); break;
      case TAG.DefineEditText: { const e = parseEditText(t.body); d.set(e.id, Object.assign({ type: 'text', tag: t, bodyRef: t.body }, e)); break; }
      case TAG.DefineText: case TAG.DefineText2: {
        const id = r.u16(); const bounds = r.rect(); const matrix = r.matrix();
        d.set(id, { type: 'stext', id, bounds, matrix, tag: t }); break;
      }
      case 6: case 21: case 35: case 90: case 20: case 36: {
        const id = r.u16(); d.set(id, { type: 'bitmap', id, tag: t }); break;
      }
      case TAG.DefineExternalImage: case TAG.DefineExternalImage2: {
        // Scaleform: id u32 (1009: u16 id?) varies by version; read conservatively.
        const id = r.u16(); d.set(id, { type: 'bitmap', id, tag: t, external: true }); break;
      }
      case TAG.DefineButton: case TAG.DefineButton2: case TAG.DefineMorphShape: case TAG.DefineMorphShape2: {
        const id = r.u16(); d.set(id, { type: 'other', id, tag: t, kind: t.code <= 34 ? 'button' : 'morph shape' }); break;
      }
      case TAG.DefineFont2: case TAG.DefineFont3: {
        const id = r.u16(); r.u8(); r.u8(); const nl = r.u8(); const name = utf8(r.bytes(nl)).replace(/\0+$/, '');
        d.set(id, { type: 'font', id, name, tag: t }); break;
      }
      case TAG.ExportAssets: case TAG.SymbolClass: {
        const n = r.u16();
        for (let i = 0; i < n; i++) { const id = r.u16(); const name = r.str(); if (!movie.names.has(id) || t.code === TAG.SymbolClass) movie.names.set(id, name); }
        break;
      }
      case TAG.ImportAssets: case TAG.ImportAssets2: {
        const url = r.str(); if (t.code === TAG.ImportAssets2) { r.u8(); r.u8(); }
        const n = r.u16();
        for (let i = 0; i < n; i++) {
          const id = r.u16(); const name = r.str();
          movie.imports.push({ id, name, url });
          if (!d.has(id)) d.set(id, { type: 'import', id, name, url });
          if (!movie.names.has(id)) movie.names.set(id, name);
        }
        break;
      }
    }
  }

  function parseEditText(body) {
    const r = new Reader(body);
    const e = { id: r.u16(), bounds: r.rect() };
    const f1 = r.u8(), f2 = r.u8();
    e.f1 = f1; e.f2 = f2;
    e.wordWrap = !!(f1 & 0x40); e.multiline = !!(f1 & 0x20); e.html = !!(f2 & 0x02); e.border = !!(f2 & 0x08);
    e.hasColor = !!(f1 & 0x04); e.hasLayout = !!(f2 & 0x20);
    if (f1 & 0x01) e.fontId = r.u16();
    if (f2 & 0x80) e.fontClass = r.str();
    if ((f1 & 0x01) || (f2 & 0x80)) e.fontHeight = r.u16();
    e.color = (f1 & 0x04) ? r.rgba() : [0, 0, 0, 255];
    if (f1 & 0x02) e.maxLength = r.u16();
    if (f2 & 0x20) { e.align = r.u8(); e.leftMargin = r.u16(); e.rightMargin = r.u16(); e.indent = r.u16(); e.leading = r.s16(); }
    e.variable = r.str();
    e.text = (f1 & 0x80) ? r.str() : '';
    e.rest = r.pos < body.length ? body.slice(r.pos) : null;
    return e;
  }

  function encodeEditText(e) {
    const w = new Writer();
    let f1 = e.f1 & ~(0x80 | 0x40 | 0x20 | 0x04), f2 = e.f2 & ~(0x20 | 0x08 | 0x02);
    if (e.text) f1 |= 0x80; if (e.wordWrap) f1 |= 0x40; if (e.multiline) f1 |= 0x20; if (e.hasColor) f1 |= 0x04;
    if (e.hasLayout) f2 |= 0x20; if (e.border) f2 |= 0x08; if (e.html) f2 |= 0x02;
    w.u16(e.id); w.rect(e.bounds); w.u8(f1); w.u8(f2);
    if (f1 & 0x01) w.u16(e.fontId);
    if (f2 & 0x80) w.str(e.fontClass);
    if ((f1 & 0x01) || (f2 & 0x80)) w.u16(e.fontHeight);
    if (f1 & 0x04) w.rgba(e.color);
    if (f1 & 0x02) w.u16(e.maxLength);
    if (f2 & 0x20) { w.u8(e.align); w.u16(e.leftMargin); w.u16(e.rightMargin); w.u16(e.indent); w.s16(e.leading); }
    w.str(e.variable || '');
    if (f1 & 0x80) w.str(e.text);
    return e.rest ? concat([w.toBytes(), e.rest]) : w.toBytes();
  }

  // Rewrites a DefineEditText with some fields changed. Setting colour or
  // alignment turns on the matching flag; font size needs a font already set.
  function setEditText(tag, changes) {
    const e = parseEditText(tag.body);
    Object.assign(e, changes);
    if ('color' in changes) e.hasColor = true;
    if ('align' in changes || 'leading' in changes) {
      if (!e.hasLayout) { e.leftMargin = 0; e.rightMargin = 0; e.indent = 0; e.leading = 0; if (e.align == null) e.align = 0; }
      e.hasLayout = true;
    }
    if ('fontHeight' in changes && !((e.f1 & 0x01) || (e.f2 & 0x80))) throw new Error('This text field has no font set, so its size can\'t be changed here.');
    tag.body = encodeEditText(e);
    return parseEditText(tag.body);
  }

  // ---------- PlaceObject ----------
  // Parses PlaceObject2/3 and records byte offsets so single fields can be
  // rewritten without re-encoding (and risking) the rest of the tag.
  function parsePlace(tag) {
    const b = tag.body; const r = new Reader(b);
    const po = { code: tag.code };
    if (tag.code === TAG.PlaceObject) {
      po.charId = r.u16(); po.depth = r.u16(); po.hasChar = true; po.move = false;
      po.matrixAt = r.pos; po.matrix = r.matrix(); po.matrixEnd = r.pos; po.hasMatrix = true;
      po.cxAt = r.pos; if (r.pos < b.length) po.cx = r.cxform(false); po.cxEnd = r.pos;
      return po;
    }
    const f1 = r.u8(); const f2 = tag.code === TAG.PlaceObject3 ? r.u8() : 0;
    po.f1 = f1; po.f2 = f2;
    po.move = !!(f1 & 0x01); po.hasChar = !!(f1 & 0x02); po.hasMatrix = !!(f1 & 0x04);
    po.depth = r.u16();
    if (f2 & 0x08 || ((f2 & 0x10) && po.hasChar)) po.className = r.str();
    if (po.hasChar) po.charId = r.u16();
    po.matrixAt = r.pos;
    if (po.hasMatrix) { po.matrix = r.matrix(); po.matrixEnd = r.pos; } else po.matrixEnd = r.pos;
    po.cxAt = r.pos; if (f1 & 0x08) po.cx = r.cxform(true); po.cxEnd = r.pos;
    if (f1 & 0x10) po.ratio = r.u16();
    if (f1 & 0x20) po.name = r.str();
    if (f1 & 0x40) po.clipDepth = r.u16();
    if (f2 & 0x01) { po.filtersAt = r.pos; skipFilters(r); }
    if (f2 & 0x02) po.blend = r.u8();
    if (f2 & 0x04) po.cacheAsBitmap = r.u8();
    po.visibleAt = r.pos;
    if (f2 & 0x20) po.visible = r.u8() !== 0;
    return po;
  }

  function skipFilters(r) {
    const n = r.u8();
    for (let i = 0; i < n; i++) {
      const id = r.u8();
      switch (id) {
        case 0: r.pos += 23; break;
        case 1: r.pos += 9; break;
        case 2: r.pos += 15; break;
        case 3: r.pos += 27; break;
        case 4: case 7: { const k = r.u8(); r.pos += k * 5 + 19; break; }
        case 5: { const x = r.u8(), y = r.u8(); r.pos += 8 + 4 * x * y + 5; break; }
        case 6: r.pos += 80; break;
        default: throw new Error('unknown filter ' + id);
      }
    }
  }

  function placeInfo(tag) {
    if (!tag.po) tag.po = parsePlace(tag);
    return tag.po;
  }

  function setPlaceMatrix(tag, m) {
    const po = placeInfo(tag);
    const b = tag.body;
    if (tag.code === TAG.PlaceObject) {
      tag.body = concat([b.subarray(0, po.matrixAt), encodeMatrix(m), b.subarray(po.matrixEnd)]);
    } else {
      const nb = concat([b.subarray(0, po.matrixAt), encodeMatrix(m), b.subarray(po.matrixEnd)]);
      nb[0] |= 0x04; tag.body = nb;
    }
    tag.po = null; return placeInfo(tag);
  }

  // PlaceObject (v1) has no flags; rewrite it as the equivalent PlaceObject2.
  function toPlace2(tag) {
    if (tag.code !== TAG.PlaceObject) return;
    const po = placeInfo(tag); const w = new Writer();
    w.u8(0x02 | 0x04 | (po.cx ? 0x08 : 0)); w.u16(po.depth); w.u16(po.charId);
    const parts = [w.toBytes(), encodeMatrix(po.matrix)];
    if (po.cx) parts.push(encodeCxform(po.cx, true));
    tag.body = concat(parts); tag.code = TAG.PlaceObject2; tag.po = null;
  }

  function setPlaceCxform(tag, cx) {
    toPlace2(tag);
    const po = placeInfo(tag); const b = tag.body;
    const nb = concat([b.subarray(0, po.cxAt), cx ? encodeCxform(cx, true) : new Uint8Array(0), b.subarray(po.cxEnd)]);
    if (cx) nb[0] |= 0x08; else nb[0] &= ~0x08;
    tag.body = nb; tag.po = null; return placeInfo(tag);
  }

  function toPlace3(tag) {
    toPlace2(tag);
    if (tag.code === TAG.PlaceObject3) return;
    const b = tag.body;
    tag.body = concat([b.subarray(0, 1), Uint8Array.of(0), b.subarray(1)]);
    tag.code = TAG.PlaceObject3; tag.po = null;
  }

  function setPlaceVisible(tag, visible) {
    toPlace3(tag);
    const po = placeInfo(tag); const b = tag.body;
    const has = !!(po.f2 & 0x20);
    const nb = concat([b.subarray(0, po.visibleAt), Uint8Array.of(visible ? 1 : 0), b.subarray(po.visibleAt + (has ? 1 : 0))]);
    nb[1] |= 0x20; tag.body = nb; tag.po = null; return placeInfo(tag);
  }

  // ---------- display list ----------
  function frameLabels(tags) {
    const labels = []; let frame = 1;
    for (const t of tags) {
      if (t.code === TAG.ShowFrame) frame++;
      else if (t.code === TAG.FrameLabel) labels.push({ frame, name: new Reader(t.body).str() });
    }
    return labels;
  }

  // Display list of a timeline at `frame` (1-based). Each entry records the
  // tags that placed it and set its matrix, so edits can target them.
  function displayList(tags, frame) {
    const list = new Map();
    let f = 1; let lifeId = 0;
    const lives = [];
    for (const t of tags) {
      if (t.code === TAG.ShowFrame) { f++; if (f > frame) { /* keep scanning only for future matrix tags */ } continue; }
      if (t.code === TAG.PlaceObject || t.code === TAG.PlaceObject2 || t.code === TAG.PlaceObject3) {
        let po; try { po = placeInfo(t); } catch (e) { continue; }
        let cur = list.get(po.depth);
        const future = f > frame;
        if (future) {
          // later keyframes: remember matrix tags belonging to the same life
          const life = lives.find(l => l.depth === po.depth && l.open);
          if (life && (!po.hasChar || po.move) && po.hasMatrix) life.matrixTags.push(t);
          if (life && (!po.hasChar || po.move) && po.cx) life.cxTags.push(t);
          if (po.hasChar && !po.move && life) life.open = false;
          continue;
        }
        if (po.hasChar && !po.move) {
          for (const l of lives) if (l.depth === po.depth) l.open = false;
          const life = { id: ++lifeId, depth: po.depth, open: true, matrixTags: [], cxTags: [] };
          lives.push(life);
          cur = { depth: po.depth, charId: po.charId, matrix: [1, 0, 0, 1, 0, 0], cx: null, name: null, clipDepth: 0,
            visible: true, ratio: 0, placeTag: t, matrixTag: null, life };
          list.set(po.depth, cur);
        } else if (!cur) continue;
        else if (po.hasChar) cur.charId = po.charId;
        if (po.hasMatrix) { cur.matrix = po.matrix; cur.matrixTag = t; cur.life.matrixTags.push(t); }
        if (po.cx) { cur.cx = po.cx; cur.cxTag = t; cur.life.cxTags.push(t); }
        if (po.name != null) cur.name = po.name;
        if (po.clipDepth != null) cur.clipDepth = po.clipDepth;
        if (po.visible != null) { cur.visible = po.visible; cur.visibleTag = t; }
        if (po.ratio != null) cur.ratio = po.ratio;
        if (po.className) cur.className = po.className;
        cur.lastTag = t;
      } else if (t.code === TAG.RemoveObject2 || t.code === TAG.RemoveObject) {
        if (f > frame) { const r = new Reader(t.body); if (t.code === TAG.RemoveObject) r.u16(); const dep = r.u16(); for (const l of lives) if (l.depth === dep) l.open = false; continue; }
        const r = new Reader(t.body); if (t.code === TAG.RemoveObject) r.u16();
        const dep = r.u16(); const cur = list.get(dep); if (cur) cur.life.open = false; list.delete(dep);
      }
    }
    return [...list.values()].sort((a, b) => a.depth - b.depth);
  }

  // ---------- shapes ----------
  function parseShape(tag) {
    const ver = tag.code === 2 ? 1 : tag.code === 22 ? 2 : tag.code === 32 ? 3 : 4;
    const r = new Reader(tag.body);
    r.u16(); const bounds = r.rect();
    if (ver === 4) { r.rect(); r.u8(); }
    const groups = [];
    let fills = readFillStyles(r, ver), lines = readLineStyles(r, ver);
    let fillBits = r.ub(4), lineBits = r.ub(4);
    let g = newGroup(fills, lines); groups.push(g);
    let x = 0, y = 0, f0 = 0, f1 = 0, ln = 0;
    const addEdge = (e) => {
      if (f0) g.fillEdges[f0].push({ x0: e.x1, y0: e.y1, cx: e.cx, cy: e.cy, x1: e.x0, y1: e.y0, curve: e.curve });
      if (f1) g.fillEdges[f1].push(e);
      if (ln) g.lineEdges[ln].push(e);
    };
    for (let guard = 0; guard < 1e6; guard++) {
      const type = r.ub(1);
      if (type === 0) {
        const newStyles = r.ub(1), ls = r.ub(1), fs1 = r.ub(1), fs0 = r.ub(1), mv = r.ub(1);
        if (!newStyles && !ls && !fs1 && !fs0 && !mv) break;
        if (mv) { const n = r.ub(5); x = r.sb(n); y = r.sb(n); }
        if (fs0) f0 = r.ub(fillBits);
        if (fs1) f1 = r.ub(fillBits);
        if (ls) ln = r.ub(lineBits);
        if (newStyles) {
          fills = readFillStyles(r, ver); lines = readLineStyles(r, ver);
          fillBits = r.ub(4); lineBits = r.ub(4);
          g = newGroup(fills, lines); groups.push(g);
          // style indices in later records refer to the new arrays
          if (!fs0) f0 = 0; if (!fs1) f1 = 0; if (!ls) ln = 0;
        }
        if (f0 > fills.length) f0 = 0; if (f1 > fills.length) f1 = 0; if (ln > lines.length) ln = 0;
      } else {
        const straight = r.ub(1); const n = r.ub(4) + 2;
        if (straight) {
          let dx = 0, dy = 0;
          if (r.ub(1)) { dx = r.sb(n); dy = r.sb(n); } else if (r.ub(1)) dy = r.sb(n); else dx = r.sb(n);
          addEdge({ x0: x, y0: y, x1: x + dx, y1: y + dy, curve: false });
          x += dx; y += dy;
        } else {
          const cdx = r.sb(n), cdy = r.sb(n), adx = r.sb(n), ady = r.sb(n);
          addEdge({ x0: x, y0: y, cx: x + cdx, cy: y + cdy, x1: x + cdx + adx, y1: y + cdy + ady, curve: true });
          x += cdx + adx; y += cdy + ady;
        }
      }
    }
    for (const gr of groups) {
      gr.fillPaths = gr.fills.map((s, i) => ({ style: s, contours: chain(gr.fillEdges[i + 1]) }));
      gr.linePaths = gr.lines.map((s, i) => ({ style: s, edges: gr.lineEdges[i + 1] }));
      delete gr.fillEdges; delete gr.lineEdges;
    }
    return { bounds, groups, hasAlpha: ver >= 3 };
  }

  // Overwrites colours in a shape tag. Colours are byte-aligned and fixed
  // size, so the rest of the tag stays byte-for-byte the same.
  function setShapeColors(tag, edits) {
    const ver = tag.code === 2 ? 1 : tag.code === 22 ? 2 : tag.code === 32 ? 3 : 4;
    const nb = tag.body.slice();
    for (const { at, color } of edits) {
      nb[at] = color[0]; nb[at + 1] = color[1]; nb[at + 2] = color[2];
      if (ver >= 3) nb[at + 3] = color[3];
    }
    tag.body = nb;
  }

  function newGroup(fills, lines) {
    const fe = [null], le = [null];
    for (let i = 0; i < fills.length; i++) fe.push([]);
    for (let i = 0; i < lines.length; i++) le.push([]);
    return { fills, lines, fillEdges: fe, lineEdges: le };
  }

  // Joins loose fill edges into closed contours (Flash stores fills as
  // unordered edges with a style on each side).
  function chain(edges) {
    if (!edges || !edges.length) return [];
    const key = (x, y) => x + ',' + y;
    const byStart = new Map();
    edges.forEach((e, i) => { const k = key(e.x0, e.y0); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(i); });
    const used = new Uint8Array(edges.length); const contours = [];
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      const c = []; let cur = i;
      while (cur != null && !used[cur]) {
        used[cur] = 1; const e = edges[cur]; c.push(e);
        const cand = byStart.get(key(e.x1, e.y1)); cur = null;
        if (cand) for (const j of cand) if (!used[j]) { cur = j; break; }
      }
      contours.push(c);
    }
    return contours;
  }

  function readFillStyles(r, ver) {
    let n = r.u8(); if (n === 0xff && ver >= 2) n = r.u16();
    const out = []; for (let i = 0; i < n; i++) out.push(readFill(r, ver)); return out;
  }
  function readFill(r, ver) {
    const type = r.u8(); const s = { type };
    if (type === 0x00) { s.colorAt = r.pos; s.color = ver >= 3 ? r.rgba() : r.rgb(); }
    else if (type === 0x10 || type === 0x12 || type === 0x13) {
      s.matrix = r.matrix();
      s.spread = r.ub(2); s.interp = r.ub(2); const k = r.ub(4); s.stops = [];
      for (let i = 0; i < k; i++) { const ratio = r.u8(); s.stops.push({ ratio, colorAt: r.pos, color: ver >= 3 ? r.rgba() : r.rgb() }); }
      if (type === 0x13) s.focal = r.s16() / 256;
    } else if (type >= 0x40 && type <= 0x43) {
      s.bitmapId = r.u16(); s.matrix = r.matrix(); s.repeat = type === 0x40 || type === 0x42; s.smooth = type < 0x42;
    } else throw new Error('unknown fill type ' + type);
    return s;
  }
  function readLineStyles(r, ver) {
    let n = r.u8(); if (n === 0xff) n = r.u16();
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = { width: r.u16() };
      if (ver === 4) {
        s.startCap = r.ub(2); s.join = r.ub(2); const hasFill = r.ub(1); r.ub(1); r.ub(1); r.ub(1); r.ub(5); r.ub(1); s.endCap = r.ub(2);
        if (s.join === 2) s.miter = r.u16() / 256;
        if (hasFill) { s.fill = readFill(r, ver); s.color = s.fill.color || (s.fill.stops ? s.fill.stops[0].color : [128, 128, 128, 255]); }
        else { s.colorAt = r.pos; s.color = r.rgba(); }
      } else { s.colorAt = r.pos; s.color = ver >= 3 ? r.rgba() : r.rgb(); }
      out.push(s);
    }
    return out;
  }

  // ---------- bitmaps (decoded to RGBA or encoded image bytes) ----------
  async function decodeBitmap(tag) {
    const r = new Reader(tag.body); const id = r.u16();
    if (tag.code === 20 || tag.code === 36) {
      const format = r.u8(), w = r.u16(), h = r.u16();
      const tableSize = format === 3 ? r.u8() + 1 : 0;
      const data = await inflate(tag.body.subarray(r.pos));
      const out = new Uint8ClampedArray(w * h * 4); const alpha = tag.code === 36;
      if (format === 3) {
        const cs = alpha ? 4 : 3; const pitch = (w + 3) & ~3; const base = tableSize * cs;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const idx = data[base + y * pitch + x]; const o = (y * w + x) * 4; const c = idx * cs;
          out[o] = data[c]; out[o + 1] = data[c + 1]; out[o + 2] = data[c + 2]; out[o + 3] = alpha ? data[c + 3] : 255;
          if (alpha && out[o + 3]) { const a = out[o + 3] / 255; out[o] /= a; out[o + 1] /= a; out[o + 2] /= a; }
        }
      } else if (format === 5) {
        for (let i = 0; i < w * h; i++) {
          const a = alpha ? data[i * 4] : 255; const o = i * 4;
          out[o + 3] = a; const k = a ? 255 / a : 0;
          out[o] = alpha ? data[i * 4 + 1] * k : data[i * 4 + 1];
          out[o + 1] = alpha ? data[i * 4 + 2] * k : data[i * 4 + 2];
          out[o + 2] = alpha ? data[i * 4 + 3] * k : data[i * 4 + 3];
        }
      } else if (format === 4) {
        const pitch = ((w * 2) + 3) & ~3;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const v = (data[y * pitch + x * 2] << 8) | data[y * pitch + x * 2 + 1]; const o = (y * w + x) * 4;
          out[o] = ((v >> 10) & 31) * 8.2; out[o + 1] = ((v >> 5) & 31) * 8.2; out[o + 2] = (v & 31) * 8.2; out[o + 3] = 255;
        }
      }
      return { kind: 'rgba', id, w, h, data: out };
    }
    if (tag.code === 21 || tag.code === 35 || tag.code === 90) {
      let alphaOffset = null;
      if (tag.code !== 21) alphaOffset = r.u32();
      if (tag.code === 90) r.u16();
      let img = tag.body.subarray(r.pos, alphaOffset != null ? r.pos + alphaOffset : tag.body.length);
      const alphaData = alphaOffset != null ? tag.body.subarray(r.pos + alphaOffset) : null;
      if (img[0] === 0xff && img[1] === 0xd9 && img[2] === 0xff && img[3] === 0xd8) img = img.subarray(4);
      const isPng = img[0] === 0x89 && img[1] === 0x50; const isGif = img[0] === 0x47 && img[1] === 0x49;
      return { kind: 'encoded', id, bytes: img, mime: isPng ? 'image/png' : isGif ? 'image/gif' : 'image/jpeg',
        alpha: alphaData && alphaData.length && !isPng && !isGif ? await inflate(alphaData) : null };
    }
    return null;
  }

  // ---------- matrix helpers ----------
  const M = {
    I: () => [1, 0, 0, 1, 0, 0],
    mul(p, c) {
      return [p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1], p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
        p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5]];
    },
    inv(m) {
      const det = m[0] * m[3] - m[1] * m[2]; if (!det) return M.I();
      const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
      return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
    },
    apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    decompose(m) {
      const sx = Math.hypot(m[0], m[1]); const det = m[0] * m[3] - m[1] * m[2];
      const sy = (det < 0 ? -1 : 1) * Math.hypot(m[2], m[3]);
      const skewY = Math.atan2(m[1], m[0]); const skewX = Math.atan2(-m[2], m[3] * (det < 0 ? -1 : 1));
      return { x: m[4] / 20, y: m[5] / 20, scaleX: sx, scaleY: sy, rotation: skewY * 180 / Math.PI, skewX: skewX * 180 / Math.PI, skewY: skewY * 180 / Math.PI };
    },
    compose(p) {
      const kx = p.skewX * Math.PI / 180, ky = p.skewY * Math.PI / 180;
      return [p.scaleX * Math.cos(ky), p.scaleX * Math.sin(ky), -p.scaleY * Math.sin(kx), p.scaleY * Math.cos(kx), p.x * 20, p.y * 20];
    },
    boundsOf(m, r) {
      const pts = [M.apply(m, r.xmin, r.ymin), M.apply(m, r.xmax, r.ymin), M.apply(m, r.xmax, r.ymax), M.apply(m, r.xmin, r.ymax)];
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return { xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
    },
  };

  function cxCompose(p, c) {
    if (!p) return c; if (!c) return p;
    const m = [0, 0, 0, 0], a = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) { m[i] = p.m[i] * c.m[i] / 256; a[i] = p.m[i] * c.a[i] / 256 + p.a[i]; }
    return { m, a };
  }
  function cxApply(cx, col) {
    if (!cx) return col;
    const o = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) o[i] = Math.max(0, Math.min(255, col[i] * cx.m[i] / 256 + cx.a[i]));
    return o;
  }

  // ---------- zip (stored) for exporting ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zipStore(files) {
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = utf8enc(f.name); const crc = crc32(f.data);
      const h = new Writer();
      h.u32(0x04034b50); h.u16(20); h.u16(0x0800); h.u16(0); h.u16(0); h.u16(0x21);
      h.u32(crc); h.u32(f.data.length); h.u32(f.data.length); h.u16(name.length); h.u16(0);
      const hb = concat([h.toBytes(), name]); parts.push(hb, f.data);
      const c = new Writer();
      c.u32(0x02014b50); c.u16(20); c.u16(20); c.u16(0x0800); c.u16(0); c.u16(0); c.u16(0x21);
      c.u32(crc); c.u32(f.data.length); c.u32(f.data.length); c.u16(name.length); c.u16(0); c.u16(0); c.u16(0); c.u16(0); c.u32(0); c.u32(offset);
      central.push(concat([c.toBytes(), name]));
      offset += hb.length + f.data.length;
    }
    const cd = concat(central);
    const e = new Writer();
    e.u32(0x06054b50); e.u16(0); e.u16(0); e.u16(files.length); e.u16(files.length); e.u32(cd.length); e.u32(offset); e.u16(0);
    return concat([...parts, cd, e.toBytes()]);
  }

  global.SWF = {
    TAG, SHAPE_TAGS, Reader, Writer, load, save, parseTags, serializeTags, placeInfo, setPlaceMatrix, setPlaceVisible,
    displayList, frameLabels, parseShape, parseEditText, encodeEditText, setEditText, decodeBitmap, M, cxCompose, cxApply,
    encodeMatrix, encodeCxform, setPlaceCxform, setShapeColors, zipStore,
    concat, inflate, deflate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
