// abc-core.js: reads, disassembles and reassembles the ActionScript 3 bytecode
// (ABC) inside a DoABC tag, so single methods can be rewritten while every
// other byte of the tag stays the same. No DOM use.
(function (global) {
  'use strict';

  class R {
    constructor(b, p = 0) { this.b = b; this.p = p; }
    u8() { return this.b[this.p++]; }
    u16() { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
    s24() { let v = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16); this.p += 3; return v & 0x800000 ? v - 0x1000000 : v; }
    u30() { let r = 0, s = 0; for (let i = 0; i < 5; i++) { const b = this.b[this.p++]; r += (b & 0x7f) * Math.pow(2, s); if (!(b & 0x80)) break; s += 7; } return r >>> 0; }
    s32() { let r = 0, s = 0, b; for (let i = 0; i < 5; i++) { b = this.b[this.p++]; r |= (b & 0x7f) << s; s += 7; if (!(b & 0x80)) break; } if (s < 32 && (b & 0x40)) r |= -1 << s; return r; }
  }
  function u30bytes(v) { const out = []; do { let b = v & 0x7f; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v); return out; }
  function s24bytes(v) { if (v < 0) v += 0x1000000; return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; }
  const utf8 = (b) => new TextDecoder('utf-8').decode(b);

  // Operand kinds: u = u30, b = signed byte, j = branch, sw = lookupswitch.
  const OPS = {
    0x01: ['bkpt'], 0x02: ['nop'], 0x03: ['throw'], 0x04: ['getsuper', 'u'], 0x05: ['setsuper', 'u'], 0x06: ['dxns', 'u'], 0x07: ['dxnslate'], 0x08: ['kill', 'u'], 0x09: ['label'],
    0x0c: ['ifnlt', 'j'], 0x0d: ['ifnle', 'j'], 0x0e: ['ifngt', 'j'], 0x0f: ['ifnge', 'j'], 0x10: ['jump', 'j'], 0x11: ['iftrue', 'j'], 0x12: ['iffalse', 'j'], 0x13: ['ifeq', 'j'], 0x14: ['ifne', 'j'],
    0x15: ['iflt', 'j'], 0x16: ['ifle', 'j'], 0x17: ['ifgt', 'j'], 0x18: ['ifge', 'j'], 0x19: ['ifstricteq', 'j'], 0x1a: ['ifstrictne', 'j'], 0x1b: ['lookupswitch', 'sw'], 0x1c: ['pushwith'], 0x1d: ['popscope'],
    0x1e: ['nextname'], 0x1f: ['hasnext'], 0x20: ['pushnull'], 0x21: ['pushundefined'], 0x23: ['nextvalue'], 0x24: ['pushbyte', 'b'], 0x25: ['pushshort', 'u'], 0x26: ['pushtrue'], 0x27: ['pushfalse'],
    0x28: ['pushnan'], 0x29: ['pop'], 0x2a: ['dup'], 0x2b: ['swap'], 0x2c: ['pushstring', 'u'], 0x2d: ['pushint', 'u'], 0x2e: ['pushuint', 'u'], 0x2f: ['pushdouble', 'u'], 0x30: ['pushscope'],
    0x31: ['pushnamespace', 'u'], 0x32: ['hasnext2', 'u', 'u'], 0x35: ['li8'], 0x36: ['li16'], 0x37: ['li32'], 0x38: ['lf32'], 0x39: ['lf64'], 0x3a: ['si8'], 0x3b: ['si16'], 0x3c: ['si32'], 0x3d: ['sf32'], 0x3e: ['sf64'],
    0x40: ['newfunction', 'u'], 0x41: ['call', 'u'], 0x42: ['construct', 'u'], 0x43: ['callmethod', 'u', 'u'], 0x44: ['callstatic', 'u', 'u'], 0x45: ['callsuper', 'u', 'u'], 0x46: ['callproperty', 'u', 'u'],
    0x47: ['returnvoid'], 0x48: ['returnvalue'], 0x49: ['constructsuper', 'u'], 0x4a: ['constructprop', 'u', 'u'], 0x4c: ['callproplex', 'u', 'u'], 0x4e: ['callsupervoid', 'u', 'u'], 0x4f: ['callpropvoid', 'u', 'u'],
    0x50: ['sxi1'], 0x51: ['sxi8'], 0x52: ['sxi16'], 0x53: ['applytype', 'u'], 0x55: ['newobject', 'u'], 0x56: ['newarray', 'u'], 0x57: ['newactivation'], 0x58: ['newclass', 'u'], 0x59: ['getdescendants', 'u'],
    0x5a: ['newcatch', 'u'], 0x5d: ['findpropstrict', 'u'], 0x5e: ['findproperty', 'u'], 0x5f: ['finddef', 'u'], 0x60: ['getlex', 'u'], 0x61: ['setproperty', 'u'], 0x62: ['getlocal', 'u'], 0x63: ['setlocal', 'u'],
    0x64: ['getglobalscope'], 0x65: ['getscopeobject', 'b'], 0x66: ['getproperty', 'u'], 0x68: ['initproperty', 'u'], 0x6a: ['deleteproperty', 'u'], 0x6c: ['getslot', 'u'], 0x6d: ['setslot', 'u'],
    0x6e: ['getglobalslot', 'u'], 0x6f: ['setglobalslot', 'u'], 0x70: ['convert_s'], 0x71: ['esc_xelem'], 0x72: ['esc_xattr'], 0x73: ['convert_i'], 0x74: ['convert_u'], 0x75: ['convert_d'], 0x76: ['convert_b'],
    0x77: ['convert_o'], 0x78: ['checkfilter'], 0x80: ['coerce', 'u'], 0x81: ['coerce_b'], 0x82: ['coerce_a'], 0x83: ['coerce_i'], 0x84: ['coerce_d'], 0x85: ['coerce_s'], 0x86: ['astype', 'u'], 0x87: ['astypelate'],
    0x88: ['coerce_u'], 0x89: ['coerce_o'], 0x90: ['negate'], 0x91: ['increment'], 0x92: ['inclocal', 'u'], 0x93: ['decrement'], 0x94: ['declocal', 'u'], 0x95: ['typeof'], 0x96: ['not'], 0x97: ['bitnot'],
    0xa0: ['add'], 0xa1: ['subtract'], 0xa2: ['multiply'], 0xa3: ['divide'], 0xa4: ['modulo'], 0xa5: ['lshift'], 0xa6: ['rshift'], 0xa7: ['urshift'], 0xa8: ['bitand'], 0xa9: ['bitor'], 0xaa: ['bitxor'],
    0xab: ['equals'], 0xac: ['strictequals'], 0xad: ['lessthan'], 0xae: ['lessequals'], 0xaf: ['greaterthan'], 0xb0: ['greaterequals'], 0xb1: ['instanceof'], 0xb2: ['istype', 'u'], 0xb3: ['istypelate'], 0xb4: ['in'],
    0xc0: ['increment_i'], 0xc1: ['decrement_i'], 0xc2: ['inclocal_i', 'u'], 0xc3: ['declocal_i', 'u'], 0xc4: ['negate_i'], 0xc5: ['add_i'], 0xc6: ['subtract_i'], 0xc7: ['multiply_i'],
    0xd0: ['getlocal0'], 0xd1: ['getlocal1'], 0xd2: ['getlocal2'], 0xd3: ['getlocal3'], 0xd4: ['setlocal0'], 0xd5: ['setlocal1'], 0xd6: ['setlocal2'], 0xd7: ['setlocal3'],
    0xef: ['debug', 'b', 'u', 'b', 'u'], 0xf0: ['debugline', 'u'], 0xf1: ['debugfile', 'u'],
  };
  const OPCODE = {}; for (const k in OPS) OPCODE[OPS[k][0]] = +k;
  // Opcodes whose first operand is a multiname index.
  const MN_OPS = new Set(['getsuper', 'setsuper', 'callsuper', 'callproperty', 'constructprop', 'callproplex', 'callsupervoid', 'callpropvoid', 'getdescendants', 'findpropstrict',
    'findproperty', 'finddef', 'getlex', 'setproperty', 'getproperty', 'initproperty', 'deleteproperty', 'coerce', 'astype', 'istype']);

  // Parses the constant pools, classes and method bodies. Body byte ranges
  // are kept so a rewritten body can be spliced back in.
  function parse(b) {
    const r = new R(b); const abc = { bytes: b, minor: r.u16(), major: r.u16() };
    let n = r.u30(); for (let i = 1; i < n; i++) r.s32();
    n = r.u30(); for (let i = 1; i < n; i++) r.u30();
    n = r.u30(); r.p += Math.max(0, n - 1) * 8;
    n = r.u30(); abc.strings = ['*']; for (let i = 1; i < n; i++) { const l = r.u30(); abc.strings.push(utf8(b.subarray(r.p, r.p + l))); r.p += l; }
    n = r.u30(); abc.ns = [{ kind: 0, name: 0 }]; for (let i = 1; i < n; i++) abc.ns.push({ kind: r.u8(), name: r.u30() });
    n = r.u30(); for (let i = 1; i < n; i++) { const c = r.u30(); for (let j = 0; j < c; j++) r.u30(); }
    n = r.u30(); abc.mn = [{ kind: 0 }];
    for (let i = 1; i < n; i++) {
      const k = r.u8(); const m = { kind: k };
      if (k === 0x07 || k === 0x0d) { m.ns = r.u30(); m.name = r.u30(); }
      else if (k === 0x0f || k === 0x10) m.name = r.u30();
      else if (k === 0x09 || k === 0x0e) { m.name = r.u30(); m.nsset = r.u30(); }
      else if (k === 0x1b || k === 0x1c) m.nsset = r.u30();
      else if (k === 0x1d) { m.base = r.u30(); const c = r.u30(); m.params = []; for (let j = 0; j < c; j++) m.params.push(r.u30()); }
      else if (k !== 0x11 && k !== 0x12) throw new Error('Unknown multiname kind ' + k);
      abc.mn.push(m);
    }
    n = r.u30(); abc.methods = [];
    for (let i = 0; i < n; i++) {
      const m = { pc: r.u30() }; r.u30(); for (let j = 0; j < m.pc; j++) r.u30();
      r.u30(); const flags = r.u8();
      if (flags & 0x08) { const oc = r.u30(); for (let j = 0; j < oc; j++) { r.u30(); r.u8(); } }
      if (flags & 0x80) for (let j = 0; j < m.pc; j++) r.u30();
      abc.methods.push(m);
    }
    n = r.u30(); for (let i = 0; i < n; i++) { r.u30(); const c = r.u30(); for (let j = 0; j < c; j++) { r.u30(); r.u30(); } }
    const traits = () => {
      const c = r.u30(); const out = [];
      for (let j = 0; j < c; j++) {
        const t = { name: r.u30() }; const kb = r.u8(); t.kind = kb & 0x0f; const attr = kb >> 4;
        if (t.kind === 0 || t.kind === 6) { r.u30(); r.u30(); if (r.u30()) r.u8(); }
        else if (t.kind === 4 || t.kind === 5) { r.u30(); r.u30(); }
        else { r.u30(); t.method = r.u30(); }
        if (attr & 4) { const mc = r.u30(); for (let k = 0; k < mc; k++) r.u30(); }
        out.push(t);
      }
      return out;
    };
    n = r.u30(); abc.instances = [];
    for (let i = 0; i < n; i++) {
      const ins = { name: r.u30(), sup: r.u30() }; const flags = r.u8();
      if (flags & 0x08) r.u30();
      const ic = r.u30(); for (let j = 0; j < ic; j++) r.u30();
      ins.iinit = r.u30(); ins.traits = traits(); abc.instances.push(ins);
    }
    abc.classes = []; for (let i = 0; i < n; i++) abc.classes.push({ cinit: r.u30(), traits: traits() });
    n = r.u30(); for (let i = 0; i < n; i++) { r.u30(); traits(); }
    n = r.u30(); abc.bodiesStart = r.p; abc.bodies = [];
    for (let i = 0; i < n; i++) {
      const bd = { start: r.p, method: r.u30(), maxStack: r.u30(), locals: r.u30(), initScope: r.u30(), maxScope: r.u30() };
      const cl = r.u30(); bd.code = b.subarray(r.p, r.p + cl); r.p += cl;
      const exStart = r.p; const ec = r.u30();
      for (let j = 0; j < ec; j++) { r.u30(); r.u30(); r.u30(); r.u30(); r.u30(); }
      bd.exceptionCount = ec; bd.exceptions = b.subarray(exStart, r.p);
      const trStart = r.p; traits(); bd.traits = b.subarray(trStart, r.p);
      bd.end = r.p; abc.bodies.push(bd); abc.methods[bd.method].body = bd;
    }
    abc.end = r.p;
    return abc;
  }

  function mnName(abc, i) {
    const m = abc.mn[i]; if (!m) return '';
    if (m.name != null) return abc.strings[m.name];
    if (m.kind === 0x1d) return mnName(abc, m.base);
    return '';
  }
  function nsName(abc, i) { const m = abc.mn[i]; return m && m.ns != null ? abc.strings[abc.ns[m.ns].name] : ''; }
  function qualifiedName(abc, i) { const ns = nsName(abc, i); return (ns ? ns + '.' : '') + mnName(abc, i); }

  // Instructions are { op, args, targets } where targets are indexes into the
  // instruction list, so code can be edited without tracking byte offsets.
  function disassemble(code) {
    const r = new R(code); const list = [], at = new Map(), fix = [];
    while (r.p < code.length) {
      const start = r.p; const op = r.u8(); const d = OPS[op];
      if (!d) throw new Error('Unknown opcode 0x' + op.toString(16) + ' at ' + start);
      const ins = { op: d[0], args: [], at: start };
      for (const k of d.slice(1)) {
        if (k === 'u') ins.args.push(r.u30());
        else if (k === 'b') { const v = r.u8(); ins.args.push(v > 127 ? v - 256 : v); }
        else if (k === 'j') { const o = r.s24(); fix.push([ins, [r.p + o]]); }
        else if (k === 'sw') { const def = start + r.s24(); const c = r.u30(); const cs = [def]; for (let i = 0; i <= c; i++) cs.push(start + r.s24()); fix.push([ins, cs]); }
      }
      at.set(start, list.length); list.push(ins);
    }
    // Compilers leave unreachable branches that point at or past the end; keep
    // those as an offset from the end so they reassemble unchanged.
    at.set(code.length, list.length);
    for (const [ins, offs] of fix) {
      ins.past = offs.map((o) => (o > code.length ? o - code.length : 0));
      ins.targets = offs.map((o) => { if (o > code.length) return list.length; if (!at.has(o)) throw new Error('Branch to ' + o + ' is not on an instruction'); return at.get(o); });
    }
    return list;
  }

  function assemble(list) {
    const size = (ins) => {
      const d = OPS[OPCODE[ins.op]]; let n = 1, ai = 0;
      for (const k of d.slice(1)) {
        if (k === 'u') n += u30bytes(ins.args[ai++]).length;
        else if (k === 'b') { n += 1; ai++; }
        else if (k === 'j') n += 3;
        else if (k === 'sw') n += 3 + u30bytes(ins.targets.length - 2).length + 3 * (ins.targets.length - 1);
      }
      return n;
    };
    const offs = []; let p = 0;
    for (const ins of list) { offs.push(p); p += size(ins); }
    offs.push(p);
    const out = [];
    list.forEach((ins, i) => {
      const op = OPCODE[ins.op]; if (op == null) throw new Error('Unknown instruction ' + ins.op);
      out.push(op); let ai = 0;
      for (const k of OPS[op].slice(1)) {
        if (k === 'u') out.push(...u30bytes(ins.args[ai++]));
        else if (k === 'b') out.push(ins.args[ai++] & 255);
        else if (k === 'j') out.push(...s24bytes(offs[ins.targets[0]] + (ins.past ? ins.past[0] : 0) - (offs[i] + 4)));
        else if (k === 'sw') {
          out.push(...s24bytes(offs[ins.targets[0]] - offs[i]));
          out.push(...u30bytes(ins.targets.length - 2));
          for (const t of ins.targets.slice(1)) out.push(...s24bytes(offs[t] - offs[i]));
        }
      }
    });
    return Uint8Array.from(out);
  }

  // Finds a class by its unqualified or qualified name, and a method on it by
  // name and kind ('method', 'get' or 'set').
  function findClass(abc, name) {
    const i = abc.instances.findIndex((ins) => qualifiedName(abc, ins.name) === name || mnName(abc, ins.name) === name);
    return i < 0 ? null : { index: i, instance: abc.instances[i], cls: abc.classes[i] };
  }
  const KIND = { method: 1, get: 2, set: 3 };
  function findMethod(abc, cls, name, kind = 'method') {
    const t = cls.instance.traits.find((x) => x.kind === KIND[kind] && mnName(abc, x.name) === name);
    return t ? t.method : null;
  }
  // Multiname index for a property name as this code already refers to it,
  // so patched code resolves the name exactly like the original does.
  function findName(abc, name, methods) {
    for (const mi of methods) {
      const bd = abc.methods[mi] && abc.methods[mi].body; if (!bd) continue;
      for (const ins of disassemble(bd.code)) if (MN_OPS.has(ins.op) && mnName(abc, ins.args[0]) === name) return ins.args[0];
    }
    return null;
  }

  // Returns new ABC bytes with some method bodies replaced. edits maps a method
  // index to { code, maxStack?, locals? }. Bodies with exception handlers are
  // refused because their offsets would need remapping.
  function rebuild(abc, edits) {
    const parts = [abc.bytes.subarray(0, abc.bodiesStart)];
    for (const bd of abc.bodies) {
      const e = edits.get(bd.method);
      if (!e) { parts.push(abc.bytes.subarray(bd.start, bd.end)); continue; }
      if (bd.exceptionCount) throw new Error('Method ' + bd.method + ' has exception handlers');
      const head = [...u30bytes(bd.method), ...u30bytes(Math.max(bd.maxStack, e.maxStack || 0)), ...u30bytes(Math.max(bd.locals, e.locals || 0)),
        ...u30bytes(bd.initScope), ...u30bytes(bd.maxScope), ...u30bytes(e.code.length)];
      parts.push(Uint8Array.from(head), e.code, bd.exceptions, bd.traits);
    }
    parts.push(abc.bytes.subarray(abc.end));
    let len = 0; for (const p of parts) len += p.length;
    const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // DoABC (tag 82) is flags u32 + name string + ABC; DoABC1 (72) is just ABC.
  function splitDoAbc(tag) {
    if (tag.code === 72) return { head: new Uint8Array(0), abc: tag.body };
    let p = 4; while (tag.body[p] !== 0) p++; p++;
    return { head: tag.body.subarray(0, p), abc: tag.body.subarray(p) };
  }

  // ---------- grid layout for Bethesda scrolling lists ----------
  // BSScrollingContainer stacks entries in one column. This rewrites three of
  // its methods so entries flow left to right in `columns` columns:
  //  - PositionEntry places entry n at column n % columns, row n / columns,
  //    stepping by the entry's Border_mc size plus the list's spacing.
  //  - Update measures fit by whole rows instead of single entries.
  //  - updateScrollPosition snaps scrolling to the start of a row (rounding
  //    up when scrolling down, so the selection stays visible).
  // One column gives back the original behaviour.
  function gridInfo(abc) {
    const c = findClass(abc, 'BSScrollingContainer'); if (!c) return null;
    const m = { position: findMethod(abc, c, 'PositionEntry'), update: findMethod(abc, c, 'Update'), scroll: findMethod(abc, c, 'updateScrollPosition') };
    if (m.position == null || m.update == null || m.scroll == null) return null;
    const code = disassemble(abc.methods[m.position].body.code);
    const i = code.findIndex((x) => x.op === 'modulo');
    m.columns = i > 0 && code[i - 1].op === 'pushbyte' ? code[i - 1].args[0] : 1;
    m.cls = c;
    return m;
  }
  function patchScrollingGrid(abcBytes, columns) {
    columns = Math.max(1, Math.min(20, Math.round(columns)));
    const abc = parse(abcBytes); const g = gridInfo(abc);
    if (!g) throw new Error('No Bethesda scrolling list code (BSScrollingContainer) in this file');
    const own = [g.position, g.update, g.scroll].concat(g.cls.instance.traits.filter((t) => t.method != null).map((t) => t.method));
    const all = abc.bodies.map((b) => b.method);
    const name = (n) => { const i = findName(abc, n, own) ?? findName(abc, n, all); if (i == null) throw new Error('Name ' + n + ' not found'); return i; };
    const N = {}; for (const n of ['getBounds', 'x', 'y', 'containerTop', 'containerLeft', 'itemsShown', 'clipHeight', 'verticalSpacing', 'Border_mc', 'width', '_scrollPosition', 'Update']) N[n] = name(n);
    const I = (op, ...args) => ({ op, args });
    const C = I('pushbyte', columns);

    const position = [
      I('getlocal0'), I('pushscope'),
      I('getlocal1'), I('getlocal0'), I('callproperty', N.getBounds, 1), I('setlocal3'),
      I('getlocal1'), I('getproperty', N.y), I('getlocal3'), I('getproperty', N.y), I('subtract'), I('convert_d'), I('setlocal', 4),
      I('getlocal1'), I('getproperty', N.x), I('getlocal3'), I('getproperty', N.x), I('subtract'), I('convert_d'), I('setlocal', 5),
      I('getlocal1'),
      I('getlocal0'), I('getproperty', N.containerTop),
      I('getlocal0'), I('getproperty', N.itemsShown), C, I('divide'), I('convert_i'),
      I('getlocal1'), I('getproperty', N.clipHeight), I('getlocal0'), I('getproperty', N.verticalSpacing), I('add'), I('multiply'), I('add'),
      I('getlocal', 4), I('add'), I('setproperty', N.y),
      I('getlocal1'),
      I('getlocal0'), I('getproperty', N.containerLeft),
      I('getlocal0'), I('getproperty', N.itemsShown), C, I('modulo'),
      I('getlocal1'), I('getproperty', N.Border_mc), I('getproperty', N.width), I('getlocal0'), I('getproperty', N.verticalSpacing), I('add'), I('multiply'), I('add'),
      I('getlocal', 5), I('add'), I('setproperty', N.x),
      I('returnvoid'),
    ];

    // targets are instruction indexes, filled in below
    const scroll = [
      I('getlocal0'), I('pushscope'),
      I('getlocal1'), I('getlocal0'), I('getproperty', N._scrollPosition), I('greaterthan'), Object.assign(I('iffalse'), { label: 'down' }),
      I('getlocal1'), C, I('getlocal1'), C, I('modulo'), I('subtract'), C, I('modulo'), I('add'), I('convert_i'), I('setlocal1'), Object.assign(I('jump'), { label: 'set' }),
      Object.assign(I('getlocal1'), { name: 'down' }), I('getlocal1'), C, I('modulo'), I('subtract'), I('convert_i'), I('setlocal1'),
      Object.assign(I('getlocal0'), { name: 'set' }), I('getlocal1'), I('initproperty', N._scrollPosition),
      I('getlocal0'), I('callpropvoid', N.Update, 0), I('returnvoid'),
    ];
    for (const ins of scroll) if (ins.label) ins.targets = [scroll.findIndex((x) => x.name === ins.label)];

    // In Update, the running height after each entry becomes the bottom of
    // that entry's row.
    const upd = disassemble(abc.methods[g.update].body.code);
    const call = upd.findIndex((x) => x.op === 'callpropvoid' && mnName(abc, x.args[0]) === 'PositionEntry');
    if (call < 0) throw new Error('Update does not call PositionEntry');
    const at = call + 1, ops = upd.slice(at, at + 6).map((x) => x.op);
    const original = ops.join() === 'getlocal1,getlocal,getproperty,add,convert_d,setlocal1';
    const patched = upd[at].op === 'getlocal0' && upd[at + 1].op === 'getproperty' && mnName(abc, upd[at + 1].args[0]) === 'itemsShown';
    if (!original && !patched) throw new Error('Update is not in a form this patch knows');
    const entryLocal = original ? upd[at + 1].args[0] : upd[at + 4].args[0];
    const rowBottom = [
      I('getlocal0'), I('getproperty', N.itemsShown), C, I('divide'), I('convert_i'),
      I('getlocal', entryLocal), I('getproperty', N.clipHeight), I('getlocal0'), I('getproperty', N.verticalSpacing), I('add'), I('multiply'),
      I('getlocal', entryLocal), I('getproperty', N.clipHeight), I('add'), I('convert_d'), I('setlocal1'),
    ];
    const removed = original ? 6 : rowBottom.length;
    // Re-point branches past the replaced run, then splice.
    const shift = rowBottom.length - removed;
    for (const x of upd) if (x.targets) x.targets = x.targets.map((t) => (t >= at + removed ? t + shift : t > at ? at : t));
    upd.splice(at, removed, ...rowBottom);

    const edits = new Map([
      [g.position, { code: assemble(position), maxStack: 6, locals: 6 }],
      [g.update, { code: assemble(upd), maxStack: 9 }],
      [g.scroll, { code: assemble(scroll), maxStack: 5, locals: 2 }],
    ]);
    return rebuild(abc, edits);
  }
  // Finds the DoABC tag holding BSScrollingContainer and its current column count.
  function findScrollingGrid(tags) {
    for (const t of tags) {
      if (t.code !== 82 && t.code !== 72) continue;
      try { const g = gridInfo(parse(splitDoAbc(t).abc)); if (g) return { tag: t, columns: g.columns }; } catch (e) { /* unreadable code */ }
    }
    return null;
  }
  function setScrollingGrid(tag, columns) {
    const { head, abc } = splitDoAbc(tag);
    const out = patchScrollingGrid(abc, columns);
    const body = new Uint8Array(head.length + out.length); body.set(head, 0); body.set(out, head.length);
    tag.body = body;
  }

  global.ABC = { findScrollingGrid, setScrollingGrid, patchScrollingGrid, parse, disassemble, assemble, rebuild, findClass, findMethod, findName, mnName, nsName, qualifiedName, splitDoAbc, OPS };
})(typeof window !== 'undefined' ? window : globalThis);
