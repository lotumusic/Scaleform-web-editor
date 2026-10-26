#!/usr/bin/env node
// Turns the container list in HUDRolloverActivationWidget.swf (the "quick
// loot" panel you see when looking at a container) into a grid of square
// tiles, like inventory grid mods.
//
//   node recipes/rollover-grid.js HUDRolloverActivationWidget.swf out.swf [columns]
//
// What it changes:
//  - List code (BSScrollingContainer): entries flow into `columns` columns
//    and scrolling moves a row at a time. See ABC.patchScrollingGrid.
//  - Entry code (QuickContainerListEntry): the stolen/contraband/tagged
//    markers line up from the tile's left edge instead of after the name.
//  - Entry art: the row bar becomes a square tile, the name wraps and
//    centres inside it, and rarity markers sit in the top-right corner.
// The game still supplies the text ("Name (count)"); the list's own
// shrink-to-fit setting keeps long names inside the tile.
'use strict';
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'swf-core.js'));
require(path.join(__dirname, '..', 'abc-core.js'));
const { M } = SWF;

const SPACING = 5;      // the widget configures the list with VerticalSpacing 5
const MARKER_X = 4;     // left edge for the status markers, in pixels

function walk(tags, fn) { for (const t of tags) { fn(t); if (t.children) walk(t.children, fn); } }
function boundsOf(movie, id, depth = 0) {
  const c = movie.dict.get(id); if (!c) return null;
  if (c.type === 'shape' || c.type === 'text') return c.bounds;
  if (c.type !== 'sprite' || depth > 8) return null;
  let b = null;
  for (const e of SWF.displayList(c.tag.children, 1)) {
    const cb = boundsOf(movie, e.charId, depth + 1); if (!cb) continue;
    const t = M.boundsOf(e.matrix, cb);
    b = b ? { xmin: Math.min(b.xmin, t.xmin), ymin: Math.min(b.ymin, t.ymin), xmax: Math.max(b.xmax, t.xmax), ymax: Math.max(b.ymax, t.ymax) } : t;
  }
  return b;
}
// Applies fn to the matrix of every placement at `depth` in a timeline, so
// every keyframe of the element changes together.
function eachMatrix(tags, depth, fn) {
  for (const t of tags) {
    if (t.code !== 26 && t.code !== 70 && t.code !== 4) continue;
    const po = SWF.placeInfo(t);
    if (po.depth === depth && po.hasMatrix) SWF.setPlaceMatrix(t, fn(po.matrix));
  }
}
function symbolByClass(movie, cls) {
  for (const [id, n] of movie.names) if (n === cls) return movie.dict.get(id);
  throw new Error('No symbol for class ' + cls);
}

function patchEntryMarkers(movie) {
  const tag = movie.tags.find((t) => t.code === 82);
  const { head, abc: bytes } = ABC.splitDoAbc(tag);
  const abc = ABC.parse(bytes);
  const cls = ABC.findClass(abc, 'QuickContainerListEntry');
  const mi = ABC.findMethod(abc, cls, 'SetEntryText');
  const code = ABC.disassemble(abc.methods[mi].body.code);
  // x = baseTextField.x + baseTextField.textWidth + gap  ->  x = MARKER_X
  const tw = code.findIndex((x) => x.op === 'getproperty' && ABC.mnName(abc, x.args[0]) === 'textWidth');
  const start = tw - 5, end = code.findIndex((x, i) => i > tw && x.op === 'setlocal');
  const want = 'getlocal0,getproperty,getproperty,getlocal0,getproperty,getproperty,add,getlocal2,add,convert_d,setlocal';
  if (tw < 5 || code.slice(start, end + 1).map((x) => x.op).join() !== want) {
    if (code.some((x, i) => x.op === 'pushbyte' && x.args[0] === MARKER_X && code[i + 2] && code[i + 2].op === 'setlocal')) return; // already patched
    throw new Error('QuickContainerListEntry.SetEntryText is not in the expected form');
  }
  const local = code[end].args[0];
  const repl = [{ op: 'pushbyte', args: [MARKER_X] }, { op: 'convert_d', args: [] }, { op: 'setlocal', args: [local] }];
  const removed = end - start + 1, shift = repl.length - removed;
  for (const x of code) if (x.targets) x.targets = x.targets.map((t) => (t > end ? t + shift : t > start ? start : t));
  code.splice(start, removed, ...repl);
  const out = ABC.rebuild(abc, new Map([[mi, { code: ABC.assemble(code) }]]));
  const body = new Uint8Array(head.length + out.length); body.set(head); body.set(out, head.length); tag.body = body;
}

function reshapeEntry(movie, tile) {
  const entry = symbolByClass(movie, 'Shared.AS3.QuickContainer.QuickContainerListEntry');
  const tags = entry.tag.children;
  const T = tile * 20;
  const first = new Map(); // depth -> first display entry
  for (let f = 1; f <= entry.frameCount; f++) for (const e of SWF.displayList(tags, f)) if (!first.has(e.depth)) first.set(e.depth, e);
  const byName = (n) => [...first.values()].find((e) => e.name === n);

  // Background and rarity glow: stretch to fill the tile.
  const fill = (e) => {
    const b = boundsOf(movie, e.charId);
    eachMatrix(tags, e.depth, (m) => [T / (b.xmax - b.xmin), 0, 0, T / (b.ymax - b.ymin), -b.xmin * T / (b.xmax - b.xmin), -b.ymin * T / (b.ymax - b.ymin)]);
  };
  const border = byName('Border_mc'); fill(border);
  for (const e of first.values()) if (e.depth > border.depth && e.depth < byName('Text_mc').depth && !e.name) fill(e);

  // Name: a wrapping, centred box inside the tile.
  const textMc = byName('Text_mc');
  eachMatrix(tags, textMc.depth, () => [1, 0, 0, 1, 3 * 20, 4 * 20]);
  const holder = movie.dict.get(textMc.charId);
  const tfEntry = SWF.displayList(holder.tag.children, 1).find((e) => movie.dict.get(e.charId).type === 'text');
  eachMatrix(holder.tag.children, tfEntry.depth, () => [1, 0, 0, 1, 0, 0]);
  const tf = movie.dict.get(tfEntry.charId);
  SWF.setEditText(tf.tag, {
    bounds: { xmin: 0, ymin: 0, xmax: T - 6 * 20, ymax: T - 18 * 20 },
    multiline: true, wordWrap: true, align: 2, fontHeight: 13 * 20,
    text: tf.text.replace(/align="left"/g, 'align="center"'),
  });

  // Status markers: along the bottom-left (code sets their x).
  for (const n of ['Contraband_mc', 'Stolen_mc', 'Tagged_mc']) {
    const e = byName(n); if (!e) continue;
    eachMatrix(tags, e.depth, (m) => [m[0], m[1], m[2], m[3], MARKER_X * 20, T - 10 * 20]);
  }
  // Rarity markers (unnamed shapes on later frames): top-right corner.
  for (const e of first.values()) {
    if (e.name || e.depth <= textMc.depth || movie.dict.get(e.charId).type !== 'shape') continue;
    const b = boundsOf(movie, e.charId);
    const s = Math.min(1, (14 * 20) / (b.xmax - b.xmin));
    eachMatrix(tags, e.depth, () => [s, 0, 0, s, T - 2 * 20 - b.xmax * s, 2 * 20 - b.ymin * s]);
  }
}

async function main() {
  const [input, output, cols] = process.argv.slice(2);
  if (!input || !output) { console.error('usage: node recipes/rollover-grid.js <in.swf> <out.swf> [columns]'); process.exit(2); }
  const columns = +cols || 5;
  const movie = await SWF.load(fs.readFileSync(input));
  // Tile width from the list frame: columns * tile + gaps = frame width.
  const list = symbolByClass(movie, 'Shared.AS3.BSScrollingContainer');
  const frame = SWF.displayList(list.tag.children, 1).find((e) => e.name === 'Border_mc');
  const fb = M.boundsOf(frame.matrix, boundsOf(movie, frame.charId));
  const width = (fb.xmax - fb.xmin) / 20;
  const tile = Math.floor((width - (columns - 1) * SPACING) / columns);

  ABC.setScrollingGrid(ABC.findScrollingGrid(movie.tags).tag, columns);
  patchEntryMarkers(movie);
  reshapeEntry(movie, tile);

  const bytes = await SWF.save(movie);
  await SWF.load(bytes); // must parse back
  fs.writeFileSync(output, bytes);
  console.log(`Wrote ${output}: ${columns} columns of ${tile}px tiles (list ${width.toFixed(0)}px wide).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
