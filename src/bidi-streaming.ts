import { AbortController } from 'abort-controller';
import {
  CompletedGrpcBidiStreamingCall,
  GrpcMetadata,
  GrpcServerInputStream,
  GrpcServerOutputStream,
} from './types';

export class GrpcBidiStreamingCall
  implements PromiseLike<CompletedGrpcBidiStreamingCall>
{
  readonly method: string;
  readonly requestHeaders: GrpcMetadata;
  readonly requests: GrpcServerInputStream;
  readonly headers: Promise<GrpcMetadata>;
  readonly responses: GrpcServerOutputStream;
  readonly trailers: Promise<GrpcMetadata>;

  #abort: AbortController;

  constructor(
    method: string,
    requestHeaders: GrpcMetadata,
    requests: GrpcServerInputStream,
    headers: Promise<GrpcMetadata>,
    responses: GrpcServerOutputStream,
    trailers: Promise<GrpcMetadata>,
    abort: AbortController
  ) {
    this.method = method;
    this.requestHeaders = requestHeaders;
    this.requests = requests;
    this.headers = headers;
    this.responses = responses;
    this.trailers = trailers;
    this.#abort = abort;
  }

  then<TResult1 = CompletedGrpcBidiStreamingCall, TResult2 = unknown>(
    onfulfilled?:
      | ((
          value: CompletedGrpcBidiStreamingCall
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.completedPromise().then(
      (value) =>
        onfulfilled
          ? Promise.resolve(onfulfilled(value))
          : (value as unknown as TResult1),
      (reason) =>
        onrejected
          ? Promise.resolve(onrejected(reason))
          : Promise.reject(reason)
    );
  }

  cancel() {
    this.#abort.abort();
  }

  private async completedPromise(): Promise<CompletedGrpcBidiStreamingCall> {
    const [headers, trailers] = await Promise.all([
      this.headers,
      this.trailers,
    ]);

    return {
      method: this.method,
      requestHeaders: this.requestHeaders,
      headers,
      responses: this.responses,
      trailers,
      status: 0,
    };
  }
}
