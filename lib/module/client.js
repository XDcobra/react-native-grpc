import { AbortController } from 'abort-controller';
import { fromByteArray, toByteArray } from 'base64-js';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { GrpcError } from './errors';
import { GrpcServerStreamingCall, ServerOutputStream } from './server-streaming';
import { GrpcUnaryCall } from './unary';
const {
  Grpc
} = NativeModules;
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
        (_deferred$headers = deferred.headers) === null || _deferred$headers === void 0 ? void 0 : _deferred$headers.resolve(event.payload);
        break;
      case 'response':
        const data = toByteArray(event.payload);
        (_deferred$data = deferred.data) === null || _deferred$data === void 0 ? void 0 : _deferred$data.notifyData(data);
        (_deferred$response = deferred.response) === null || _deferred$response === void 0 ? void 0 : _deferred$response.resolve(data);
        break;
      case 'trailers':
        (_deferred$trailers = deferred.trailers) === null || _deferred$trailers === void 0 ? void 0 : _deferred$trailers.resolve(event.payload);
        (_deferred$data2 = deferred.data) === null || _deferred$data2 === void 0 ? void 0 : _deferred$data2.notifyComplete();
        delete deferredMap[event.id];
        break;
      case 'error':
        const error = new GrpcError(event.error, event.code, event.trailers);
        (_deferred$headers2 = deferred.headers) === null || _deferred$headers2 === void 0 ? void 0 : _deferred$headers2.reject(error);
        (_deferred$trailers2 = deferred.trailers) === null || _deferred$trailers2 === void 0 ? void 0 : _deferred$trailers2.reject(error);
        (_deferred$response2 = deferred.response) === null || _deferred$response2 === void 0 ? void 0 : _deferred$response2.reject(error);
        (_deferred$data3 = deferred.data) === null || _deferred$data3 === void 0 ? void 0 : _deferred$data3.noitfyError(error);
        delete deferredMap[event.id];
        break;
    }
  }
}
function getId() {
  return idCtr++;
}
export class GrpcClient {
  constructor() {
    Emitter.addListener('grpc-call', handleGrpcEvent);
  }
  destroy() {
    Emitter.removeAllListeners('grpc-call');
  }
  getHost() {
    return Grpc.getHost();
  }
  setHost(host) {
    Grpc.setHost(host);
  }
  getInsecure() {
    return Grpc.getIsInsecure();
  }
  setInsecure(insecure) {
    Grpc.setInsecure(insecure);
  }
  setCompression(enable, compressorName) {
    Grpc.setCompression(enable, compressorName);
  }
  setResponseSizeLimit(limitInBytes) {
    Grpc.setResponseSizeLimit(limitInBytes);
  }
  initGrpcChannel() {
    Grpc.initGrpcChannel();
  }
  setKeepAlive(enable, keepAliveTime, keepAliveTimeOut) {
    Grpc.setKeepAlive(enable, keepAliveTime, keepAliveTimeOut);
  }
  resetConnection(message) {
    if (!this.isAndroid()) return;
    Grpc.resetConnection(message);
  }
  setUiLogEnabled(enable) {
    if (!this.isAndroid()) return;
    Grpc.setUiLogEnabled(enable);
  }
  onConnectionStateChange() {
    if (!this.isAndroid()) return;
    Grpc.onConnectionStateChange();
  }
  enterIdle() {
    if (!this.isAndroid()) return;
    Grpc.enterIdle();
  }
  unaryCall(method, data, requestHeaders) {
    const requestData = fromByteArray(data);
    const obj = {
      data: requestData
    };
    const id = getId();
    const abort = new AbortController();
    abort.signal.addEventListener('abort', () => {
      Grpc.cancelGrpcCall(id);
    });
    const response = createDeferred(abort.signal);
    const headers = createDeferred(abort.signal);
    const trailers = createDeferred(abort.signal);
    deferredMap[id] = {
      response,
      headers,
      trailers
    };
    Grpc.unaryCall(id, method, obj, requestHeaders || {});
    const call = new GrpcUnaryCall(method, data, requestHeaders || {}, headers.promise, response.promise, trailers.promise, abort);
    call.then(result => result, () => abort.abort());
    return call;
  }
  serverStreamCall(method, data, requestHeaders) {
    const requestData = fromByteArray(data);
    const obj = {
      data: requestData
    };
    const id = getId();
    const abort = new AbortController();
    abort.signal.addEventListener('abort', () => {
      Grpc.cancelGrpcCall(id);
    });
    const headers = createDeferred(abort.signal);
    const trailers = createDeferred(abort.signal);
    const stream = new ServerOutputStream();
    deferredMap[id] = {
      headers,
      trailers,
      data: stream
    };
    Grpc.serverStreamingCall(id, method, obj, requestHeaders || {});
    const call = new GrpcServerStreamingCall(method, data, requestHeaders || {}, headers.promise, stream, trailers.promise, abort);
    call.then(result => result, () => abort.abort());
    return call;
  }
  isAndroid() {
    return Platform.OS === 'android';
  }
}
export { Grpc };
//# sourceMappingURL=client.js.map