export class GrpcUnaryCall {
  #abort;
  constructor(method, data, requestHeaders, headers, response, trailers, abort) {
    this.method = method;
    this.request = data;
    this.requestHeaders = requestHeaders;
    this.headers = headers;
    this.response = response;
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
    const [headers, response, trailers] = await Promise.all([this.headers, this.response, this.trailers]);
    return {
      method: this.method,
      requestHeaders: this.requestHeaders,
      request: this.request,
      headers,
      trailers,
      response: response,
      status: 0
    };
  }
}
//# sourceMappingURL=unary.js.map