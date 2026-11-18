'use strict';

const REQUIRED_REMOTE_HOST_PORT_METHODS = Object.freeze([
  'findHostElements',
  'resolveHostBinding',
  'isExternallyPromotedIframe',
  'setPromotionOwnership',
  'isWorkerAlreadyAdapted',
  'markWorkerPatched',
  'syncCompanions',
  'installChildEnvironmentShims',
  'installBootGlobals',
  'onWorkbenchReady',
]);

function assertValidRemoteHostPort(port) {
  if (!port || typeof port !== 'object') {
    throw new TypeError('RemoteHostPort must be a non-null object');
  }
  for (const methodName of REQUIRED_REMOTE_HOST_PORT_METHODS) {
    if (typeof port[methodName] !== 'function') {
      throw new TypeError(`RemoteHostPort is missing required method "${methodName}()"`);
    }
  }
  return port;
}

module.exports = {
  REQUIRED_REMOTE_HOST_PORT_METHODS,
  assertValidRemoteHostPort,
};
