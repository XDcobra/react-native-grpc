"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  GrpcClient: true
};
exports.GrpcClient = void 0;
var _client = require("./client");
var _types = require("./types");
Object.keys(_types).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _types[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _types[key];
    }
  });
});
var _unary = require("./unary");
Object.keys(_unary).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _unary[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _unary[key];
    }
  });
});
var _serverStreaming = require("./server-streaming");
Object.keys(_serverStreaming).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _serverStreaming[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _serverStreaming[key];
    }
  });
});
var _errors = require("./errors");
Object.keys(_errors).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _errors[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _errors[key];
    }
  });
});
const GrpcClient = exports.GrpcClient = new _client.GrpcClient();
//# sourceMappingURL=index.js.map