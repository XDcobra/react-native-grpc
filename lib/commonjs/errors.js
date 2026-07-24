"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GrpcError = void 0;
class GrpcError extends Error {
  constructor(error, code, trailers) {
    super(error);
    this.error = error;
    this.code = code;
    this.trailers = trailers;
  }
}
exports.GrpcError = GrpcError;
//# sourceMappingURL=errors.js.map