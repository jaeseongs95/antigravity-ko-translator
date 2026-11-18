'use strict';

function installDomGuards({
  cw,
  cd,
  assetRewriter,
  nonce = '',
  hostTheme = null,
  disposables,
}) {
  if (!cw || !cd || !assetRewriter) return { msgListeners: new Set() };

  const { rewriteAssetUrl, toAuthorizedScriptUrl } = assetRewriter;
  const cleanups = [];

  if (!cw.__remoteDomGuardsInstalled) {
    cw.__remoteDomGuardsInstalled = true;
    cleanups.push(() => {
      try {
        delete cw.__remoteDomGuardsInstalled;
      } catch (_err) {}
    });

    const scriptProto = cw.HTMLScriptElement && cw.HTMLScriptElement.prototype;
    const scriptSrcDesc = scriptProto ? Object.getOwnPropertyDescriptor(scriptProto, 'src') : null;

    if (scriptProto && scriptSrcDesc && typeof scriptSrcDesc.set === 'function' && !scriptProto.__scriptSrcGuarded) {
      try {
        Object.defineProperty(scriptProto, 'src', {
          configurable: true,
          enumerable: true,
          get: scriptSrcDesc.get,
          set(val) {
            if (nonce) {
              try {
                this.nonce = nonce;
              } catch (_err) {}
            }
            if (typeof val === 'string' || (val && typeof val === 'object' && typeof val.href === 'string')) {
              return scriptSrcDesc.set.call(this, toAuthorizedScriptUrl(val));
            }
            return scriptSrcDesc.set.call(this, val);
          },
        });
        scriptProto.__scriptSrcGuarded = true;
        cleanups.push(() => {
          try {
            Object.defineProperty(scriptProto, 'src', scriptSrcDesc);
            delete scriptProto.__scriptSrcGuarded;
          } catch (_err) {}
        });
      } catch (_err) {}
    }

    const linkProto = cw.HTMLLinkElement && cw.HTMLLinkElement.prototype;
    const linkHrefDesc = linkProto ? Object.getOwnPropertyDescriptor(linkProto, 'href') : null;
    if (linkProto && linkHrefDesc && typeof linkHrefDesc.set === 'function' && !linkProto.__linkHrefGuarded) {
      try {
        Object.defineProperty(linkProto, 'href', {
          configurable: true,
          enumerable: true,
          get: linkHrefDesc.get,
          set(val) {
            if (nonce) {
              try {
                this.nonce = nonce;
              } catch (_err) {}
            }
            if (typeof val === 'string' || (val && typeof val === 'object' && typeof val.href === 'string')) {
              return linkHrefDesc.set.call(this, rewriteAssetUrl(val));
            }
            return linkHrefDesc.set.call(this, val);
          },
        });
        linkProto.__linkHrefGuarded = true;
        cleanups.push(() => {
          try {
            Object.defineProperty(linkProto, 'href', linkHrefDesc);
            delete linkProto.__linkHrefGuarded;
          } catch (_err) {}
        });
      } catch (_err) {}
    }

    for (const mediaProto of [
      cw.HTMLImageElement && cw.HTMLImageElement.prototype,
      cw.HTMLSourceElement && cw.HTMLSourceElement.prototype,
    ]) {
      const mediaSrcDesc = mediaProto ? Object.getOwnPropertyDescriptor(mediaProto, 'src') : null;
      if (mediaProto && mediaSrcDesc && typeof mediaSrcDesc.set === 'function' && !mediaProto.__mediaSrcGuarded) {
        try {
          Object.defineProperty(mediaProto, 'src', {
            configurable: true,
            enumerable: true,
            get: mediaSrcDesc.get,
            set(val) {
              if (typeof val === 'string' || (val && typeof val === 'object' && typeof val.href === 'string')) {
                return mediaSrcDesc.set.call(this, rewriteAssetUrl(val));
              }
              return mediaSrcDesc.set.call(this, val);
            },
          });
          mediaProto.__mediaSrcGuarded = true;
          cleanups.push(() => {
            try {
              Object.defineProperty(mediaProto, 'src', mediaSrcDesc);
              delete mediaProto.__mediaSrcGuarded;
            } catch (_err) {}
          });
        } catch (_err) {}
      }
    }

    const elProto = cw.Element && cw.Element.prototype;
    if (elProto && typeof elProto.setAttribute === 'function' && !elProto.__setAttrGuarded) {
      try {
        const origSetAttr = elProto.setAttribute;
        elProto.setAttribute = function guardedSetAttribute(name, val) {
          const attrLower = String(name || '').toLowerCase();
          const tagUpper = String((this && this.tagName) || '').toUpperCase();
          if (tagUpper === 'SCRIPT' && attrLower === 'src') {
            if (nonce) {
              try {
                this.nonce = nonce;
                origSetAttr.call(this, 'nonce', nonce);
              } catch (_err) {}
            }
            if (val && typeof val === 'object' && typeof val.href !== 'string') {
              return origSetAttr.call(this, name, val);
            }
            const safeVal = toAuthorizedScriptUrl(val);
            if (scriptSrcDesc && typeof scriptSrcDesc.set === 'function') {
              scriptSrcDesc.set.call(this, safeVal);
              return undefined;
            }
            return origSetAttr.call(this, name, safeVal);
          }
          if (tagUpper === 'LINK' && attrLower === 'href') {
            if (nonce) {
              try {
                this.nonce = nonce;
                origSetAttr.call(this, 'nonce', nonce);
              } catch (_err) {}
            }
            const nextHref =
              val && typeof val === 'object' && typeof val.href !== 'string' ? val : rewriteAssetUrl(val);
            return origSetAttr.call(this, name, nextHref);
          }
          if (
            (tagUpper === 'IMG' || tagUpper === 'SOURCE' || tagUpper === 'AUDIO' || tagUpper === 'VIDEO') &&
            attrLower === 'src'
          ) {
            const nextSrc =
              val && typeof val === 'object' && typeof val.href !== 'string' ? val : rewriteAssetUrl(val);
            return origSetAttr.call(this, name, nextSrc);
          }
          return origSetAttr.call(this, name, val);
        };
        elProto.__setAttrGuarded = true;
        cleanups.push(() => {
          try {
            elProto.setAttribute = origSetAttr;
            delete elProto.__setAttrGuarded;
          } catch (_err) {}
        });
      } catch (_err) {}
    }

    if (typeof cd.createElement === 'function' && !cd.__createElementGuarded) {
      try {
        const origCreateElFn = cd.createElement;
        const boundOrigCreateEl = origCreateElFn.bind(cd);
        cd.createElement = function guardedCreateElement(tagName, options) {
          const el = options !== undefined ? boundOrigCreateEl(tagName, options) : boundOrigCreateEl(tagName);
          const upper = typeof tagName === 'string' ? tagName.toUpperCase() : '';
          if (nonce && el && (upper === 'SCRIPT' || upper === 'STYLE' || upper === 'LINK')) {
            try {
              el.nonce = nonce;
              if (typeof el.setAttribute === 'function') el.setAttribute('nonce', nonce);
            } catch (_err) {}
          }
          const isNativeElem = Boolean(cw.Element && el instanceof cw.Element);
          if (el && !isNativeElem && typeof el.setAttribute === 'function' && !el.__syntheticSetAttrGuarded) {
            const origElSetAttr = el.setAttribute.bind(el);
            el.setAttribute = function guardedSyntheticSetAttr(attrName, attrVal) {
              const attrLower = String(attrName || '').toLowerCase();
              if (upper === 'SCRIPT' && attrLower === 'src') {
                if (nonce) {
                  try {
                    el.nonce = nonce;
                    origElSetAttr('nonce', nonce);
                  } catch (_err) {}
                }
                const safeVal = toAuthorizedScriptUrl(attrVal);
                el.src = safeVal;
                return origElSetAttr(attrName, safeVal);
              }
              if (upper === 'LINK' && attrLower === 'href') {
                if (nonce) {
                  try {
                    el.nonce = nonce;
                    origElSetAttr('nonce', nonce);
                  } catch (_err) {}
                }
                const nextHref =
                  attrVal && typeof attrVal === 'object' && typeof attrVal.href !== 'string'
                    ? attrVal
                    : rewriteAssetUrl(attrVal);
                el.href = nextHref;
                return origElSetAttr(attrName, nextHref);
              }
              if (
                (upper === 'IMG' || upper === 'SOURCE' || upper === 'AUDIO' || upper === 'VIDEO') &&
                attrLower === 'src'
              ) {
                const nextSrc =
                  attrVal && typeof attrVal === 'object' && typeof attrVal.href !== 'string'
                    ? attrVal
                    : rewriteAssetUrl(attrVal);
                el.src = nextSrc;
                return origElSetAttr(attrName, nextSrc);
              }
              return origElSetAttr(attrName, attrVal);
            };
            el.__syntheticSetAttrGuarded = true;
          }
          return el;
        };
        cd.__createElementGuarded = true;
        cleanups.push(() => {
          try {
            cd.createElement = origCreateElFn;
            delete cd.__createElementGuarded;
          } catch (_err) {}
        });
      } catch (_err) {}
    }

    if (cw.customElements && typeof cw.customElements.define === 'function' && !cw.customElements.__defineGuarded) {
      try {
        const origDefFn = cw.customElements.define;
        const origDefBound = origDefFn.bind(cw.customElements);
        cw.customElements.define = (name, ctor, opts) => {
          if (!cw.customElements.get(name)) {
            origDefBound(name, ctor, opts);
          }
        };
        cw.customElements.__defineGuarded = true;
        cleanups.push(() => {
          try {
            cw.customElements.define = origDefFn;
            delete cw.customElements.__defineGuarded;
          } catch (_err) {}
        });
      } catch (_err) {}
    }

    if (hostTheme !== null && hostTheme !== undefined && cd.documentElement && cd.documentElement.style) {
      try {
        cd.documentElement.style.colorScheme = hostTheme === 'light' ? 'light' : 'dark';
      } catch (_err) {}
    }
  }

  // Early INITIAL_CONFIG MessagePort capture buffer & listener-registration replay
  const msgListeners = cw.__remoteMsgListeners || new Set();
  cw.__remoteMsgListeners = msgListeners;
  try {
    if (typeof cw.addEventListener === 'function' && !cw.__remoteMsgBufferInstalled) {
      cw.__remoteMsgBufferInstalled = true;
      const origAddEvFn = cw.addEventListener;
      const origRemoveEvFn = cw.removeEventListener;
      const origAddEv = origAddEvFn.bind(cw);
      const origRemoveEv = typeof origRemoveEvFn === 'function' ? origRemoveEvFn.bind(cw) : null;

      const captureInitialConfig = (ev) => {
        if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG') {
          cw.__bufferedInitialConfigEvent = ev;
          if (msgListeners.size > 0) {
            cw.__initialConfigReceived = true;
          }
        }
      };
      origAddEv('message', captureInitialConfig);

      cw.addEventListener = function bufferedAddEventListener(type, listener, options) {
        if (type === 'message' && typeof listener === 'function') {
          msgListeners.add(listener);
          const res = origAddEv(type, listener, options);
          if (cw.__bufferedInitialConfigEvent && !cw.__initialConfigReceived) {
            const bufferedEv = cw.__bufferedInitialConfigEvent;
            cw.__initialConfigReceived = true;
            Promise.resolve().then(() => {
              try {
                listener.call(cw, bufferedEv);
              } catch (_err) {}
            });
          }
          return res;
        }
        return origAddEv(type, listener, options);
      };
      if (origRemoveEv) {
        cw.removeEventListener = function bufferedRemoveEventListener(type, listener, options) {
          if (type === 'message' && typeof listener === 'function') {
            msgListeners.delete(listener);
          }
          return origRemoveEv(type, listener, options);
        };
      }

      cleanups.push(() => {
        try {
          if (origRemoveEv) origRemoveEv('message', captureInitialConfig);
          cw.addEventListener = origAddEvFn;
          if (origRemoveEvFn) cw.removeEventListener = origRemoveEvFn;
          delete cw.__remoteMsgBufferInstalled;
        } catch (_err) {}
      });
    }
  } catch (_err) {}

  if (cleanups.length > 0 && disposables && typeof disposables.register === 'function') {
    disposables.register((fullRestore) => {
      if (!fullRestore) return;
      while (cleanups.length > 0) {
        const fn = cleanups.pop();
        try {
          fn();
        } catch (_err) {}
      }
    });
  }

  return {
    msgListeners,
    replayBufferedInitialConfig() {
      if (!cw.__initialConfigReceived && cw.__bufferedInitialConfigEvent && msgListeners.size > 0) {
        const bufferedEv = cw.__bufferedInitialConfigEvent;
        cw.__initialConfigReceived = true;
        for (const fn of Array.from(msgListeners)) {
          try {
            fn.call(cw, bufferedEv);
          } catch (_err) {}
        }
      }
    },
  };
}

module.exports = {
  installDomGuards,
};
