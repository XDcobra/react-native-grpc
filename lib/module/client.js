import { AbortController } from 'abort-controller';
import { fromByteArray, toByteArray } from 'base64-js';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { GrpcError } from './errors';
import { GrpcServerStreamingCall, ServerOutputStream } from './server-streaming';
import { GrpcUnaryCall } from './unary';

/* prettier-ignore */

function nativeGrpc() {
  const grpc = NativeModules.Grpc;
  if (!grpc) {
    throw new Error('NativeModules.Grpc is not linked');
  }
  return grpc;
}
const Emitter = new NativeEventEmitter(NativeModules.Grpc);
function createDeferred(signal) {
  let completed = false;
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = value => {
      completed = true;
      resolve(value);
    };
    deferred.reject = reason => {
      completed = true;
      reject(reason);
    };
  });
  signal.addEventListener('abort', () => {
    if (!completed) {
      deferred.reject('aborted');
    }
  });
  return deferred;
}
let idCtr = 1;
const deferredMap = {};
function handleGrpcEvent(event) {
  var _deferred$headers, _deferred$data, _deferred$response, _deferred$trailers, _deferred$data2, _deferred$headers2, _deferred$trailers2, _deferred$response2, _deferred$data3;
  const deferred = deferredMap[event.id];
  if (deferred) {
    switch (event.type) {
      case 'headers':
        (_deferred$headers = deferred.headers) === null || _deferred$headers === void 0 || _deferred$headers.resolve(event.payload);
        break;
      case 'response':
        const data = toByteArray(event.payload);
        (_deferred$data = deferred.data) === null || _deferred$data === void 0 || _deferred$data.notifyData(data);
        (_deferred$response = deferred.response) === null || _deferred$response === void 0 || _deferred$response.resolve(data);
        break;
      case 'trailers':
        (_deferred$trailers = deferred.trailers) === null || _deferred$trailers === void 0 || _deferred$trailers.resolve(event.payload);
        (_deferred$data2 = deferred.data) === null || _deferred$data2 === void 0 || _deferred$data2.notifyComplete();
        delete deferredMap[event.id];
        break;
      case 'error':
        const error = new GrpcError(event.error, event.code, event.trailers);
        (_deferred$headers2 = deferred.headers) === null || _deferred$headers2 === void 0 || _deferred$headers2.reject(error);
        (_deferred$trailers2 = deferred.trailers) === null || _deferred$trailers2 === void 0 || _deferred$trailers2.reject(error);
        (_deferred$response2 = deferred.response) === null || _deferred$response2 === void 0 || _deferred$response2.reject(error);
        (_deferred$data3 = deferred.data) === null || _deferred$data3 === void 0 || _deferred$data3.noitfyError(error);
        delete deferredMap[event.id];
        break;
    }
  }
}
function getId() {
  return idCtr++;
}
function buildRequestObject(data, options) {
  const obj = {
    data: fromByteArray(data)
  };
  if ((options === null || options === void 0 ? void 0 : options.deadlineSeconds) !== undefined) {
    obj.deadlineSeconds = options.deadlineSeconds;
  }
  return obj;
}
export class GrpcClient {
  constructor() {
    Emitter.addListener('grpc-call', handleGrpcEvent);
  }
  destroy() {
    Emitter.removeAllListeners('grpc-call');
  }
  getHost() {
    return nativeGrpc().getHost();
  }
  setHost(host) {
    nativeGrpc().setHost(host);
  }
  getInsecure() {
    return nativeGrpc().getIsInsecure();
  }
  setInsecure(insecure) {
    nativeGrpc().setInsecure(insecure);
  }
  setCompression(enable, compressorName) {
    nativeGrpc().setCompression(enable, compressorName);
  }
  setResponseSizeLimit(limitInBytes) {
    nativeGrpc().setResponseSizeLimit(limitInBytes);
  }
  /** Global per-call deadline in seconds (Android/iOS). Default 120. Overridable per RPC via options. */
  setCallDeadlineSeconds(seconds) {
    nativeGrpc().setCallDeadlineSeconds(seconds);
  }
  initGrpcChannel() {
    nativeGrpc().initGrpcChannel();
  }
  setKeepAlive(enable, keepAliveTime, keepAliveTimeOut) {
    nativeGrpc().setKeepAlive(enable, keepAliveTime, keepAliveTimeOut);
  }
  resetConnection(message) {
    if (!this.isAndroid()) return;
    nativeGrpc().resetConnection(message);
  }
  setUiLogEnabled(enable) {
    if (!this.isAndroid()) return;
    nativeGrpc().setUiLogEnabled(enable);
  }
  onConnectionStateChange() {
    if (!this.isAndroid()) return;
    nativeGrpc().onConnectionStateChange();
  }
  enterIdle() {
    if (!this.isAndroid()) return;
    nativeGrpc().enterIdle();
  }
  unaryCall(method, data, requestHeaders, options) {
    const obj = buildRequestObject(data, options);
    const id = getId();
    const abort = new AbortController();
    abort.signal.addEventListener('abort', () => {
      nativeGrpc().cancelGrpcCall(id);
    });
    const response = createDeferred(abort.signal);
    const headers = createDeferred(abort.signal);
    const trailers = createDeferred(abort.signal);
    deferredMap[id] = {
      response,
      headers,
      trailers
    };
    nativeGrpc().unaryCall(id, method, obj, requestHeaders || {});
    const call = new GrpcUnaryCall(method, data, requestHeaders || {}, headers.promise, response.promise, trailers.promise, abort);
    call.then(result => result, () => abort.abort());
    return call;
  }
  serverStreamCall(method, data, requestHeaders, options) {
    const obj = buildRequestObject(data, options);
    const id = getId();
    const abort = new AbortController();
    abort.signal.addEventListener('abort', () => {
      nativeGrpc().cancelGrpcCall(id);
    });
    const headers = createDeferred(abort.signal);
    const trailers = createDeferred(abort.signal);
    const stream = new ServerOutputStream();
    deferredMap[id] = {
      headers,
      trailers,
      data: stream
    };
    nativeGrpc().serverStreamingCall(id, method, obj, requestHeaders || {});
    const call = new GrpcServerStreamingCall(method, data, requestHeaders || {}, headers.promise, stream, trailers.promise, abort);
    call.then(result => result, () => abort.abort());
    return call;
  }
  isAndroid() {
    return Platform.OS === 'android';
  }
}

/** Lazy binding to NativeModules.Grpc (works with Jest mocks / late link). */
export const Grpc = new Proxy({}, {
  get(_target, prop) {
    const native = nativeGrpc();
    const value = native[prop];
    return typeof value === 'function' ? value.bind(native) : value;
  }
});
//# sourceMappingURL=client.js.map