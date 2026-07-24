"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ServerOutputStream = exports.GrpcServerStreamingCall = void 0;
var _eventemitter = require("eventemitter3");
function _classPrivateFieldInitSpec(obj, privateMap, value) { _checkPrivateRedeclaration(obj, privateMap); privateMap.set(obj, value); }
function _checkPrivateRedeclaration(obj, privateCollection) { if (privateCollection.has(obj)) { throw new TypeError("Cannot initialize the same private elements twice on an object"); } }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return typeof key === "symbol" ? key : String(key); }
function _toPrimitive(input, hint) { if (typeof input !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (typeof res !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _classPrivateFieldGet(receiver, privateMap) { var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "get"); return _classApplyDescriptorGet(receiver, descriptor); }
function _classApplyDescriptorGet(receiver, descriptor) { if (descriptor.get) { return descriptor.get.call(receiver); } return descriptor.value; }
function _classPrivateFieldSet(receiver, privateMap, value) { var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "set"); _classApplyDescriptorSet(receiver, descriptor, value); return value; }
function _classExtractFieldDescriptor(receiver, privateMap, action) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to " + action + " private field on non-instance"); } return privateMap.get(receiver); }
function _classApplyDescriptorSet(receiver, descriptor, value) { if (descriptor.set) { descriptor.set.call(receiver, value); } else { if (!descriptor.writable) { throw new TypeError("attempted to set read only private field"); } descriptor.value = value; } }
var _abort = /*#__PURE__*/new WeakMap();
/* eslint-disable */

class GrpcServerStreamingCall {
  constructor(method, data, requestHeaders, headers, responses, trailers, abort) {
    _defineProperty(this, "method", void 0);
    _defineProperty(this, "requestHeaders", void 0);
    _defineProperty(this, "request", void 0);
    _defineProperty(this, "headers", void 0);
    _defineProperty(this, "responses", void 0);
    _defineProperty(this, "trailers", void 0);
    _classPrivateFieldInitSpec(this, _abort, {
      writable: true,
      value: void 0
    });
    this.method = method;
    this.request = data;
    this.requestHeaders = requestHeaders;
    this.headers = headers;
    this.responses = responses;
    this.trailers = trailers;
    _classPrivateFieldSet(this, _abort, abort);
  }
  then(onfulfilled, onrejected) {
    return this.completedPromise().then(value => onfulfilled ? Promise.resolve(onfulfilled(value)) : value, reason => onrejected ? Promise.resolve(onrejected(reason)) : Promise.reject(reason));
  }
  cancel() {
    _classPrivateFieldGet(this, _abort).abort();
  }
  async completedPromise() {
    const [headers, trailers] = await Promise.all([this.headers, this.trailers]);
    return {
      method: this.method,
      requestHeaders: this.requestHeaders,
      request: this.request,
      headers,
      trailers,
      status: 0
    };
  }
}
exports.GrpcServerStreamingCall = GrpcServerStreamingCall;
var _emitter = /*#__PURE__*/new WeakMap();
class ServerOutputStream {
  constructor() {
    _classPrivateFieldInitSpec(this, _emitter, {
      writable: true,
      value: new _eventemitter.EventEmitter()
    });
  }
  on(event, callback) {
    _classPrivateFieldGet(this, _emitter).addListener(event, callback);
    return () => {
      _classPrivateFieldGet(this, _emitter).removeListener(event, callback);
    };
  }
  notifyData(data) {
    _classPrivateFieldGet(this, _emitter).emit('data', data);
  }
  notifyComplete() {
    _classPrivateFieldGet(this, _emitter).emit('complete');
  }
  noitfyError(reason) {
    _classPrivateFieldGet(this, _emitter).emit('error', reason);
  }
}
exports.ServerOutputStream = ServerOutputStream;
//# sourceMappingURL=server-streaming.js.map