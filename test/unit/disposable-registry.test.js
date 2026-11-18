'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDisposableRegistry } = require('../../src/core/disposable-registry');

test('DisposableRegistry: registerPropertyValue & registerDescriptorOverride distinguish hadOwn === false vs true', () => {
  const proto = { inheritedProp: 'from-proto', protoAccessor: 'proto-acc' };
  const obj = Object.create(proto);
  Object.defineProperty(obj, 'existingOwn', {
    value: 'orig-own',
    writable: false,
    enumerable: true,
    configurable: true,
  });

  const reg = createDisposableRegistry();
  reg.registerPropertyValue(obj, 'inheritedProp', 'shadowed-own');
  reg.registerPropertyValue(obj, 'existingOwn', 'temp-own');
  reg.registerDescriptorOverride(obj, 'protoAccessor', {
    get() {
      return 'override-acc';
    },
    enumerable: false,
  });

  assert.equal(Object.prototype.hasOwnProperty.call(obj, 'inheritedProp'), true);
  assert.equal(obj.inheritedProp, 'shadowed-own');
  assert.equal(obj.existingOwn, 'temp-own');
  assert.equal(obj.protoAccessor, 'override-acc');

  reg.disposeAll(true);

  assert.equal(Object.prototype.hasOwnProperty.call(obj, 'inheritedProp'), false);
  assert.equal(obj.inheritedProp, 'from-proto');
  assert.equal(Object.prototype.hasOwnProperty.call(obj, 'protoAccessor'), false);
  assert.equal(obj.protoAccessor, 'proto-acc');

  const restoredDesc = Object.getOwnPropertyDescriptor(obj, 'existingOwn');
  assert.equal(restoredDesc.value, 'orig-own');
  assert.equal(restoredDesc.writable, false);
  assert.equal(restoredDesc.enumerable, true);
});

test('DisposableRegistry: registerConstructorHook Proxy deactivates cleanly even when wrapped by an outer peer', () => {
  const calls = [];
  class NativeWorker {
    constructor(url, opts) {
      this.url = url;
      this.opts = opts;
    }
  }
  const win = { Worker: NativeWorker };
  const reg = createDisposableRegistry();

  reg.registerConstructorHook(win, 'Worker', (OrigCtor) => ({
    construct(Target, args, newTarget) {
      calls.push(['ko-hook', args[0]]);
      return Reflect.construct(Target, [`rewritten:${args[0]}`, args[1]], newTarget);
    },
  }));

  const first = new win.Worker('/a.js');
  assert.equal(first.url, 'rewritten:/a.js');
  assert.equal(first instanceof NativeWorker, true);

  // External peer subsequently wraps `win.Worker`
  const InnerProxy = win.Worker;
  win.Worker = function PeerOuterWorker(url, opts) {
    calls.push(['peer-outer', url]);
    return new InnerProxy(url, opts);
  };

  const second = new win.Worker('/b.js');
  assert.equal(second.url, 'rewritten:/b.js');

  // Dispose our registry: PeerOuterWorker MUST NOT be clobbered, AND our inner proxy MUST pass through!
  reg.disposeAll(false);
  assert.notEqual(win.Worker, NativeWorker, 'Outer peer wrapper must be preserved');

  calls.length = 0;
  const third = new win.Worker('/c.js');
  assert.equal(third.url, '/c.js', 'Deactivated inner proxy must pass through untouched');
  assert.deepEqual(calls, [['peer-outer', '/c.js']]);
});

test('DisposableRegistry: registerMethodHook, registerAccessorHook, registerEvent, and fullRestore global keys', () => {
  const reg = createDisposableRegistry();
  let val = 'init';
  const proto = {};
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: true,
    get() {
      return val;
    },
    set(v) {
      val = v;
    },
  });
  const el = Object.create(proto);
  el.ping = (x) => `orig:${x}`;

  reg.registerAccessorHook(proto, 'src', {
    get(readOrig) {
      return `get(${readOrig()})`;
    },
    set(nextVal, writeOrig) {
      writeOrig(`set(${nextVal})`);
    },
  });
  reg.registerMethodHook(el, 'ping', (prev) => (x) => `wrapped:${prev(x)}`);

  const scope = { __agyMarker: 'v2.0.0' };
  reg.registerGlobalKey(scope, '__agyMarker');

  el.src = 'hello';
  assert.equal(val, 'set(hello)');
  assert.equal(el.src, 'get(set(hello))');
  assert.equal(el.ping('1'), 'wrapped:orig:1');

  // Hot-reload dispose (fullRestore = false) preserves registered global key if not yet purged,
  // wait: let's verify fullRestore = false vs fullRestore = true on a second registry
  reg.disposeAll(false);
  assert.equal(scope.__agyMarker, 'v2.0.0');
  assert.equal(el.ping('2'), 'orig:2');
  el.src = 'plain';
  assert.equal(el.src, 'plain');

  const reg2 = createDisposableRegistry();
  reg2.registerGlobalKey(scope, '__agyMarker');
  reg2.disposeAll(true);
  assert.equal(Object.prototype.hasOwnProperty.call(scope, '__agyMarker'), false);
});
