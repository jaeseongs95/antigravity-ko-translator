'use strict';

function createDisposableRegistry() {
  const stack = [];
  const globalBindings = [];

  function register(fn) {
    if (typeof fn === 'function') {
      stack.push(fn);
    }
    return fn;
  }

  function registerCleanup(fn) {
    return register(fn);
  }

  function registerInterval(id, clearFn = clearInterval) {
    if (id !== null && id !== undefined) {
      stack.push(() => {
        try {
          clearFn(id);
        } catch (_err) {}
      });
    }
    return id;
  }

  function registerTimeout(id, clearFn = clearTimeout) {
    if (id !== null && id !== undefined) {
      stack.push(() => {
        try {
          clearFn(id);
        } catch (_err) {}
      });
    }
    return id;
  }

  function registerEvent(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== 'function' || typeof listener !== 'function') {
      return () => {};
    }
    target.addEventListener(type, listener, options);
    let active = true;
    const off = () => {
      if (!active) return;
      active = false;
      try {
        if (typeof target.removeEventListener === 'function') {
          target.removeEventListener(type, listener, options);
        }
      } catch (_err) {}
    };
    stack.push(off);
    return off;
  }

  function restoreOwnProperty(target, key, hadOwn, origDesc) {
    try {
      if (hadOwn && origDesc) {
        Object.defineProperty(target, key, origDesc);
      } else {
        delete target[key];
      }
    } catch (_err) {
      try {
        if (hadOwn && origDesc && Object.prototype.hasOwnProperty.call(origDesc, 'value')) {
          target[key] = origDesc.value;
        }
      } catch (_inner) {}
    }
  }

  function registerPropertyValue(target, key, value, attrs = {}) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
      return () => {};
    }
    const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
    const origDesc = hadOwn ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      ...attrs,
      value,
    });
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      restoreOwnProperty(target, key, hadOwn, origDesc);
    };
    stack.push(restore);
    return restore;
  }

  function registerDescriptorOverride(target, key, descriptor) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function') || !descriptor) {
      return () => {};
    }
    const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
    const origDesc = hadOwn ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    Object.defineProperty(target, key, {
      configurable: true,
      ...descriptor,
    });
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      restoreOwnProperty(target, key, hadOwn, origDesc);
    };
    stack.push(restore);
    return restore;
  }

  function registerMethodHook(target, methodName, createWrapper) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
      return () => {};
    }
    const prevFn = target[methodName];
    if (typeof prevFn !== 'function' || typeof createWrapper !== 'function') {
      return () => {};
    }
    const hadOwn = Object.prototype.hasOwnProperty.call(target, methodName);
    const origDesc = hadOwn ? Object.getOwnPropertyDescriptor(target, methodName) : undefined;
    let active = true;
    const customFn = createWrapper(prevFn);
    const wrappedFn = function hookedMethod(...args) {
      if (!active) return prevFn.apply(this, args);
      return customFn.apply(this, args);
    };
    try {
      Object.defineProperty(target, methodName, {
        configurable: true,
        writable: true,
        enumerable: origDesc ? Boolean(origDesc.enumerable) : false,
        value: wrappedFn,
      });
    } catch (_err) {
      target[methodName] = wrappedFn;
    }
    const unhook = () => {
      if (!active) return;
      active = false;
      try {
        if (target[methodName] === wrappedFn) {
          restoreOwnProperty(target, methodName, hadOwn, origDesc);
        }
      } catch (_err) {}
    };
    stack.push(unhook);
    return unhook;
  }

  function findDescriptorInChain(target, propName) {
    let cur = target;
    while (cur && (typeof cur === 'object' || typeof cur === 'function')) {
      const desc = Object.getOwnPropertyDescriptor(cur, propName);
      if (desc) return desc;
      cur = Object.getPrototypeOf(cur);
    }
    return undefined;
  }

  function registerAccessorHook(target, propName, hooks = {}) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
      return () => {};
    }
    const baseDesc = findDescriptorInChain(target, propName);
    const hadOwn = Object.prototype.hasOwnProperty.call(target, propName);
    const origOwnDesc = hadOwn ? Object.getOwnPropertyDescriptor(target, propName) : undefined;
    const origGet = baseDesc && typeof baseDesc.get === 'function' ? baseDesc.get : undefined;
    const origSet = baseDesc && typeof baseDesc.set === 'function' ? baseDesc.set : undefined;
    let fallbackVal =
      baseDesc && Object.prototype.hasOwnProperty.call(baseDesc, 'value') ? baseDesc.value : undefined;
    let active = true;

    const nextDesc = {
      configurable: true,
      enumerable: baseDesc ? Boolean(baseDesc.enumerable) : true,
      get() {
        const readOrig = () => (origGet ? origGet.call(this) : fallbackVal);
        if (!active || typeof hooks.get !== 'function') return readOrig();
        return hooks.get.call(this, readOrig);
      },
      set(val) {
        const writeOrig = (nextVal) => {
          if (origSet) {
            origSet.call(this, nextVal);
          } else {
            fallbackVal = nextVal;
          }
        };
        if (!active || typeof hooks.set !== 'function') {
          writeOrig(val);
          return;
        }
        hooks.set.call(this, val, writeOrig);
      },
    };

    Object.defineProperty(target, propName, nextDesc);
    const unhook = () => {
      if (!active) return;
      active = false;
      const curDesc = Object.getOwnPropertyDescriptor(target, propName);
      if (curDesc && curDesc.get === nextDesc.get && curDesc.set === nextDesc.set) {
        restoreOwnProperty(target, propName, hadOwn, origOwnDesc);
      }
    };
    stack.push(unhook);
    return unhook;
  }

  function registerConstructorHook(target, ctorName, createTrap) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
      return () => {};
    }
    const OrigCtor = target[ctorName];
    if (typeof OrigCtor !== 'function' || typeof createTrap !== 'function') {
      return () => {};
    }
    const hadOwn = Object.prototype.hasOwnProperty.call(target, ctorName);
    const origDesc = hadOwn ? Object.getOwnPropertyDescriptor(target, ctorName) : undefined;
    let active = true;
    const trapSpec = createTrap(OrigCtor);
    const constructHandler =
      typeof trapSpec === 'function'
        ? trapSpec
        : trapSpec && typeof trapSpec.construct === 'function'
          ? trapSpec.construct
          : null;
    const applyHandler =
      trapSpec && typeof trapSpec.apply === 'function' ? trapSpec.apply : null;

    const proxyCtor = new Proxy(OrigCtor, {
      construct(Target, args, newTarget) {
        const effectiveNewTarget = newTarget === proxyCtor ? Target : newTarget;
        if (!active || !constructHandler) {
          return Reflect.construct(Target, args, effectiveNewTarget);
        }
        return constructHandler(Target, args, effectiveNewTarget, proxyCtor);
      },
      apply(Target, thisArg, args) {
        if (!active || !applyHandler) {
          return Reflect.apply(Target, thisArg, args);
        }
        return applyHandler(Target, thisArg, args);
      },
    });

    Object.defineProperty(target, ctorName, {
      configurable: true,
      writable: true,
      enumerable: origDesc ? Boolean(origDesc.enumerable) : false,
      value: proxyCtor,
    });

    const unhook = () => {
      if (!active) return;
      active = false;
      if (target[ctorName] === proxyCtor) {
        restoreOwnProperty(target, ctorName, hadOwn, origDesc);
      }
    };
    stack.push(unhook);
    return unhook;
  }

  function registerGlobalKey(scopeObj, propName) {
    if (scopeObj && (typeof scopeObj === 'object' || typeof scopeObj === 'function') && typeof propName === 'string' && propName) {
      globalBindings.push({ scopeObj, propName });
    }
  }

  function disposeAll(fullRestore = false) {
    const full = Boolean(fullRestore);
    while (stack.length > 0) {
      const fn = stack.pop();
      try {
        fn(full);
      } catch (_err) {}
    }
    if (full) {
      while (globalBindings.length > 0) {
        const entry = globalBindings.pop();
        try {
          delete entry.scopeObj[entry.propName];
        } catch (_err) {}
      }
    }
  }

  return {
    register,
    registerCleanup,
    registerInterval,
    registerTimeout,
    registerEvent,
    registerPropertyValue,
    registerDescriptorOverride,
    registerMethodHook,
    registerAccessorHook,
    registerConstructorHook,
    registerGlobalKey,
    disposeAll,
    get size() {
      return stack.length;
    },
  };
}

module.exports = {
  createDisposableRegistry,
};
