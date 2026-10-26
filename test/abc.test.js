// Tests for abc-core.js on a small hand-built ABC block, run with `node --test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../abc-core.js');
const { ABC } = globalThis;

const u30 = (v) => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
// ABC with one string ("x"), one multiname, and one method whose body is `code`.
function makeAbc(code) {
  const b = [16, 0, 46, 0];
  b.push(0, 0, 0);                         // int, uint, double pools
  b.push(2, 1, 'x'.charCodeAt(0));        // strings: "", "x"
  b.push(2, 0x16, 0);                     // namespaces: package ""
  b.push(0);                              // ns sets
  b.push(2, 0x07, 1, 1);                  // multinames: QName(ns 1, "x")
  b.push(1, 0, 0, 0, 0);                  // 1 method: no params, any return, no name, no flags
  b.push(0, 0);                           // metadata, classes (none)
  b.push(1, 0, 0);                        // 1 script: init method 0, no traits
  b.push(1, 0, 4, 2, 0, 1, ...u30(code.length), ...code, 0, 0); // body for method 0
  return Uint8Array.from(b);
}
const CODE = [
  0xd0, 0x30,             // getlocal0, pushscope
  0x24, 3,                // pushbyte 3
  0x12, 4, 0, 0,          // iffalse +4 -> returnvoid
  0x60, 1,                // getlex x
  0x29, 0x29,             // pop, pop (keeps the jump target 4 bytes on)
  0x47,                   // returnvoid
];

test('parses and reassembles a body byte for byte', () => {
  const bytes = makeAbc(CODE);
  const abc = ABC.parse(bytes);
  assert.strictEqual(abc.bodies.length, 1);
  assert.strictEqual(ABC.mnName(abc, 1), 'x');
  const list = ABC.disassemble(abc.bodies[0].code);
  assert.deepStrictEqual(list.map((i) => i.op), ['getlocal0', 'pushscope', 'pushbyte', 'iffalse', 'getlex', 'pop', 'pop', 'returnvoid']);
  assert.strictEqual(list[3].targets[0], 7);
  assert.deepStrictEqual([...ABC.assemble(list)], CODE);
  assert.deepStrictEqual(ABC.rebuild(abc, new Map()), bytes);
});

test('branches follow their target when code is inserted', () => {
  const abc = ABC.parse(makeAbc(CODE));
  const list = ABC.disassemble(abc.bodies[0].code);
  list.splice(4, 0, { op: 'pushbyte', args: [1] }, { op: 'pop', args: [] });
  for (const i of list) if (i.targets) i.targets = i.targets.map((t) => (t >= 4 ? t + 2 : t));
  const out = ABC.parse(ABC.rebuild(abc, new Map([[0, { code: ABC.assemble(list) }]])));
  const back = ABC.disassemble(out.bodies[0].code);
  assert.strictEqual(back[back[3].targets[0]].op, 'returnvoid');
  assert.strictEqual(back.length, 10);
});

test('a branch past the end of the code survives a round trip', () => {
  const code = [0xd0, 0x30, 0x10, 8, 0, 0, 0x47]; // jump to 4 bytes past the end (unreachable)
  const list = ABC.disassemble(Uint8Array.from(code));
  assert.deepStrictEqual([...ABC.assemble(list)], code);
});

test('raises max stack and locals when asked', () => {
  const abc = ABC.parse(makeAbc(CODE));
  const out = ABC.parse(ABC.rebuild(abc, new Map([[0, { code: abc.bodies[0].code, maxStack: 9, locals: 5 }]])));
  assert.strictEqual(out.bodies[0].maxStack, 9);
  assert.strictEqual(out.bodies[0].locals, 5);
});

test('files without Bethesda list code report no grid', () => {
  assert.strictEqual(ABC.findScrollingGrid([{ code: 72, body: makeAbc(CODE) }]), null);
});
