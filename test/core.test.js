// Round-trip tests for swf-core.js, run with `node --test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../swf-core.js');
require('../sample.js');
const { SWF, SWFSample } = globalThis;

function findChar(movie, type, pred) { return [...movie.dict.values()].find((c) => c.type === type && (!pred || pred(c))); }
function walk(tags, fn) { for (const t of tags) { fn(t); if (t.children) walk(t.children, fn); } }
function placeByName(movie, name) {
  let hit = null;
  walk(movie.tags, (t) => { if ((t.code === 26 || t.code === 70) && SWF.placeInfo(t).name === name) hit = hit || t; });
  return hit;
}

test('sample saves byte-identical when untouched', async () => {
  const bytes = SWFSample.build();
  const out = await SWF.save(await SWF.load(bytes));
  assert.deepStrictEqual(out, bytes);
});

test('compressed round trip', async () => {
  const m = await SWF.load(SWFSample.build());
  const cws = await SWF.save(m, { compress: true });
  assert.strictEqual(String.fromCharCode(...cws.subarray(0, 3)), 'CWS');
  const back = await SWF.load(cws);
  assert.strictEqual(back.dict.size, m.dict.size);
});

test('matrix edit survives save and reload', async () => {
  const m = await SWF.load(SWFSample.build());
  const t = placeByName(m, 'Title_tf');
  SWF.setPlaceMatrix(t, [1.5, 0, 0, 0.5, 1234, -567]);
  const m2 = await SWF.load(await SWF.save(m));
  const po = SWF.placeInfo(placeByName(m2, 'Title_tf'));
  assert.deepStrictEqual(po.matrix.map((v) => +v.toFixed(4)), [1.5, 0, 0, 0.5, 1234, -567]);
  assert.strictEqual(po.name, 'Title_tf');
});

test('colour transform can be added, changed and removed', async () => {
  const m = await SWF.load(SWFSample.build());
  const t = placeByName(m, 'Panel_mc');
  const cx = { m: [128, 200, 256, 77], a: [40, -20, 0, 0] };
  SWF.setPlaceCxform(t, cx);
  let m2 = await SWF.load(await SWF.save(m));
  let po = SWF.placeInfo(placeByName(m2, 'Panel_mc'));
  assert.deepStrictEqual(po.cx, cx);
  assert.strictEqual(po.name, 'Panel_mc');
  assert.deepStrictEqual(po.matrix, [1, 0, 0, 1, 0, 0]);
  SWF.setPlaceCxform(placeByName(m2, 'Panel_mc'), null);
  m2 = await SWF.load(await SWF.save(m2));
  po = SWF.placeInfo(placeByName(m2, 'Panel_mc'));
  assert.strictEqual(po.cx, undefined);
  assert.strictEqual(po.name, 'Panel_mc');
});

test('hiding keeps the rest of the placement', async () => {
  const m = await SWF.load(SWFSample.build());
  SWF.setPlaceVisible(placeByName(m, 'Hints_tf'), false);
  const m2 = await SWF.load(await SWF.save(m));
  const t = placeByName(m2, 'Hints_tf');
  assert.strictEqual(t.code, 70);
  assert.strictEqual(SWF.placeInfo(t).visible, false);
});

test('PlaceObject v1 converts to v2 with its colour transform', () => {
  const w = new SWF.Writer(); w.u16(7); w.u16(3);
  const body = SWF.concat([w.toBytes(), SWF.encodeMatrix([1, 0, 0, 1, 200, 400]), SWF.encodeCxform({ m: [256, 128, 256, 256], a: [0, 0, 10, 0] }, false)]);
  const tag = { code: 4, body };
  SWF.setPlaceCxform(tag, { m: [256, 256, 256, 128], a: [0, 0, 0, 0] });
  assert.strictEqual(tag.code, 26);
  const po = SWF.placeInfo(tag);
  assert.deepStrictEqual([po.charId, po.depth, po.matrix[4], po.matrix[5]], [7, 3, 200, 400]);
  assert.deepStrictEqual(po.cx.m, [256, 256, 256, 128]);
});

test('text field content, colour, size and alignment', async () => {
  const m = await SWF.load(SWFSample.build());
  const ch = findChar(m, 'text', (c) => c.text === 'MEDICAL CABINET');
  SWF.setEditText(ch.tag, { text: 'Storage Locker', color: [255, 0, 0, 200], fontHeight: 500, align: 2, bounds: { xmin: -40, xmax: 9000, ymin: -40, ymax: 700 } });
  const m2 = await SWF.load(await SWF.save(m));
  const e = m2.dict.get(ch.id);
  assert.strictEqual(e.text, 'Storage Locker');
  assert.deepStrictEqual(e.color, [255, 0, 0, 200]);
  assert.strictEqual(e.fontHeight, 500);
  assert.strictEqual(e.align, 2);
  assert.strictEqual(e.fontClass, '$MAIN_Font');
  assert.deepStrictEqual(e.bounds, { xmin: -40, xmax: 9000, ymin: -40, ymax: 700 });
});

test('unchanged text field re-encodes byte-identical', async () => {
  const m = await SWF.load(SWFSample.build());
  for (const c of m.dict.values()) if (c.type === 'text') assert.deepStrictEqual(SWF.encodeEditText(SWF.parseEditText(c.tag.body)), c.tag.body);
});

test('text set to empty drops the text flag', async () => {
  const m = await SWF.load(SWFSample.build());
  const ch = findChar(m, 'text');
  const e = SWF.setEditText(ch.tag, { text: '' });
  assert.strictEqual(e.f1 & 0x80, 0);
  assert.strictEqual(e.text, '');
});

test('shape fill recolour', async () => {
  const m = await SWF.load(SWFSample.build());
  const ch = m.dict.get(6);
  const s = SWF.parseShape(ch.tag);
  const fill = s.groups[0].fills[0];
  const len = ch.tag.body.length;
  SWF.setShapeColors(ch.tag, [{ at: fill.colorAt, color: [10, 20, 30, 40] }]);
  assert.strictEqual(ch.tag.body.length, len);
  const m2 = await SWF.load(await SWF.save(m));
  assert.deepStrictEqual(SWF.parseShape(m2.dict.get(6).tag).groups[0].fills[0].color, [10, 20, 30, 40]);
});

test('display list records colour transform tags', async () => {
  const m = await SWF.load(SWFSample.build());
  const t = placeByName(m, 'Panel_mc');
  SWF.setPlaceCxform(t, { m: [256, 256, 256, 128], a: [0, 0, 0, 0] });
  const menu = m.dict.get(40).tag.children;
  const e = SWF.displayList(menu, 1).find((x) => x.name === 'Panel_mc');
  assert.strictEqual(e.cxTag, t);
  assert.ok(e.life.cxTags.includes(t));
});
