"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ServerOutputStream = exports.GrpcServerStreamingCall = void 0;
var _eventemitter = require("eventemitter3");
/* eslint-disable eslint-comments/no-unlimited-disable */

/* eslint-disable */

class GrpcServerStreamingCall {
  #abort;
  constructor(method, data, requestHeaders, headers, responses, trailers, abort) {
    this.method = method;
    this.request = data;
    this.requestHeaders = requestHeaders;
    this.headers = headers;
    this.responses = responses;
    this.trailers = trailers;
    this.#abort = abort;
  }
  then(onfulfilled, onrejected) {
    return this.completedPromise().then(value => onfulfilled ? Promise.resolve(onfulfilled(value)) : value, reason => onrejected ? Promise.resolve(onrejected(reason)) : Promise.reject(reason));
  }
  cancel() {
    this.#abort.abort();
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
class ServerOutputStream {
  #emitter = new _eventemitter.EventEmitter();
  on(event, callback) {
    this.#emitter.addListener(event, callback);
    return () => {
      this.#emitter.removeListener(event, callback);
    };
  }
  notifyData(data) {
    this.#emitter.emit('data', data);
  }
  notifyComplete() {
    this.#emitter.emit('complete');
  }
  noitfyError(reason) {
    this.#emitter.emit('error', reason);
  }
}
exports.ServerOutputStream = ServerOutputStream;
//# sourceMappingURL=server-streaming.js.map