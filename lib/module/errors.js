export class GrpcError extends Error {
  constructor(error, code, trailers) {
    super(error);
    this.error = error;
    this.code = code;
    this.trailers = trailers;
  }
}
//# sourceMappingURL=errors.js.map