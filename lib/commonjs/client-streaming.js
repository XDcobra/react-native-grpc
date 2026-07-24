"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ServerInputStream = void 0;
var _base64Js = require("base64-js");
var _client = require("./client");
class ServerInputStream {
  // eslint-disable-next-line prettier/prettier
  constructor(callId, method) {
    this.callId = callId;
    this.method = method;
  }
  send(data) {
    return _client.Grpc.clientStreamingCall(this.callId, this.method, {
      data: (0, _base64Js.fromByteArray)(data)
    });
  }
  complete() {
    return _client.Grpc.finishClientStreaming(this.callId);
  }
}
exports.ServerInputStream = ServerInputStream;
//# sourceMappingURL=client-streaming.js.map