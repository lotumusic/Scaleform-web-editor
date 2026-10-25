// sample.js: builds a small QuickLoot-style Scaleform menu in memory, so the
// editor opens with something to try before a real file is loaded.
(function (global) {
  'use strict';
  const { Writer, concat, TAG } = global.SWF;
  const tw = (px) => Math.round(px * 20);

  function tag(code, body, long) {
    const w = new Writer();
    if (long || body.length >= 0x3f) { w.u16((code << 6) | 0x3f); w.u32(body.length); }
    else w.u16((code << 6) | body.length);
    return concat([w.toBytes(), body]);
  }

  function rectShape(id, w, h, rgba, line) {
    const W = tw(w), H = tw(h);
    const b = new Writer();
    b.u16(id); b.rect({ xmin: 0, xmax: W, ymin: 0, ymax: H });
    b.u8(1); b.u8(0); b.rgba(rgba);
    if (line) { b.u8(1); b.u16(tw(line.width)); b.rgba(line.color); } else b.u8(0);
    b.ub(4, 1); b.ub(4, line ? 1 : 0);
    // style change: move to 0,0, fill1 = 1, line = 1
    b.ub(1, 0); b.ub(1, 0); b.ub(1, line ? 1 : 0); b.ub(1, 1); b.ub(1, 0); b.ub(1, 1);
    b.ub(5, 1); b.sb(1, 0); b.sb(1, 0);
    b.ub(1, 1); if (line) b.ub(1, 1);
    const edge = (vert, v) => {
      const n = Math.max(2, bitsFor(v));
      b.ub(1, 1); b.ub(1, 1); b.ub(4, n - 2); b.ub(1, 0); b.ub(1, vert ? 1 : 0); b.sb(n, v);
    };
    edge(false, W); edge(true, H); edge(false, -W); edge(true, -H);
    b.ub(6, 0);
    return tag(TAG.DefineShape3, b.toBytes());
  }
  function bitsFor(v) { let n = 1; while (!(v >= -Math.pow(2, n - 1) && v < Math.pow(2, n - 1))) n++; return n; }

  function editText(id, w, h, text, size, rgba, align) {
    const b = new Writer();
    b.u16(id); b.rect({ xmin: tw(-2), xmax: tw(w), ymin: tw(-2), ymax: tw(h) });
    b.u8(0x80 | 0x08 | 0x04); b.u8(0x80 | 0x20 | 0x10);
    b.str('$MAIN_Font'); b.u16(tw(size)); b.rgba(rgba);
    b.u8(align || 0); b.u16(0); b.u16(0); b.u16(0); b.s16(0);
    b.str(''); b.str(text);
    return tag(TAG.DefineEditText, b.toBytes());
  }

  function place(depth, charId, m, name, move) {
    const b = new Writer();
    let f = 0x04; if (charId != null) f |= 0x02; if (name) f |= 0x20; if (move) f |= 0x01;
    b.u8(f); b.u16(depth); if (charId != null) b.u16(charId);
    b.matrix(m || [1, 0, 0, 1, 0, 0]); if (name) b.str(name);
    return tag(TAG.PlaceObject2, b.toBytes());
  }
  const at = (x, y, sx, sy) => [sx || 1, 0, 0, sy || 1, tw(x), tw(y)];
  const show = () => tag(TAG.ShowFrame, new Uint8Array(0));
  const end = () => tag(TAG.End, new Uint8Array(0));
  const label = (s) => { const w = new Writer(); w.str(s); return tag(TAG.FrameLabel, w.toBytes()); };
  const remove = (d) => { const w = new Writer(); w.u16(d); return tag(TAG.RemoveObject2, w.toBytes()); };
  function sprite(id, frames, inner) {
    const w = new Writer(); w.u16(id); w.u16(frames);
    return tag(TAG.DefineSprite, concat([w.toBytes(), ...inner, end()]), true);
  }

  function build() {
    const parts = [];
    const ink = [236, 238, 240, 255], dim = [168, 176, 186, 255], dark = [16, 18, 22, 255];
    parts.push(rectShape(1, 440, 404, [8, 11, 15, 214]));
    parts.push(rectShape(2, 440, 46, [238, 238, 232, 240]));
    parts.push(rectShape(3, 416, 42, [255, 255, 255, 20]));
    parts.push(rectShape(4, 416, 42, [238, 238, 232, 235]));
    parts.push(rectShape(5, 416, 2, [255, 255, 255, 70]));
    parts.push(rectShape(6, 8, 46, [232, 128, 44, 255]));
    parts.push(editText(10, 380, 30, 'MEDICAL CABINET', 22, dark, 0));
    parts.push(editText(11, 400, 26, '[E] TAKE     [R] TAKE ALL     [T] TRANSFER', 15, dim, 0));
    const items = [['Med Pack', '3', '0.5'], ['Emergency Kit', '1', '1.0'], ['Bandage', '6', '0.1'], ['Trauma Pack', '2', '1.5'], ['Heart+', '1', '0.2']];
    const rows = [];
    items.forEach((it, i) => {
      const nameId = 20 + i * 3, countId = 21 + i * 3, massId = 22 + i * 3, rowId = 50 + i;
      const col = i === 0 ? dark : ink, sub = i === 0 ? [70, 74, 80, 255] : dim;
      parts.push(editText(nameId, 260, 26, it[0].toUpperCase(), 18, col, 0));
      parts.push(editText(countId, 50, 26, it[1], 18, col, 2));
      parts.push(editText(massId, 50, 26, it[2], 16, sub, 2));
      parts.push(sprite(rowId, 1, [
        place(1, i === 0 ? 4 : 3, at(0, 0), 'Background_mc'),
        place(2, nameId, at(14, 8), 'Name_tf'),
        place(3, countId, at(250, 8), 'Count_tf'),
        place(4, massId, at(340, 9), 'Mass_tf'),
        show(),
      ]));
      rows.push(rowId);
    });
    const menu = [
      label('Open'),
      place(1, 1, at(0, 0), 'Panel_mc'),
      place(2, 2, at(0, 0), 'Header_mc'),
      place(3, 6, at(0, 0), 'Accent_mc'),
      place(4, 10, at(22, 8), 'Title_tf'),
    ];
    rows.forEach((id, i) => menu.push(place(10 + i, id, at(12, 60 + i * 50), 'Item' + i + '_mc')));
    menu.push(place(20, 5, at(12, 318), 'Divider_mc'));
    menu.push(place(21, 11, at(16, 332), 'Hints_tf'));
    menu.push(show());
    menu.push(label('Compact'));
    menu.push(remove(13), remove(14));
    menu.push(place(1, null, at(0, 0, 1, 0.76), null, true));
    menu.push(place(20, null, at(12, 218), null, true));
    menu.push(place(21, null, at(16, 232), null, true));
    menu.push(show());
    parts.push(sprite(40, 2, menu));
    const sc = new Writer(); sc.u16(1); sc.u16(40); sc.str('QuickLootMenu');
    parts.push(tag(TAG.SymbolClass, sc.toBytes()));
    parts.push(place(1, 40, at(1340, 300), 'QuickLoot_mc'));
    parts.push(show(), end());

    const hdr = new Writer();
    hdr.rect({ xmin: 0, xmax: tw(1920), ymin: 0, ymax: tw(1080) }); hdr.u16(30 << 8); hdr.u16(1);
    const body = concat([hdr.toBytes(), ...parts]);
    const out = new Uint8Array(8 + body.length);
    out.set([0x46, 0x57, 0x53, 15]); new DataView(out.buffer).setUint32(4, out.length, true); out.set(body, 8);
    return out;
  }

  global.SWFSample = { build };
})(typeof window !== 'undefined' ? window : globalThis);
