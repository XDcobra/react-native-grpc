import { AbortController } from 'abort-controller';
import {
  CompletedGrpcClientStreamingCall,
  GrpcMetadata,
  GrpcServerInputStream,
} from './types';

type SendNative = (data: Uint8Array, isFirst: boolean) => Promise<void>;
type FinishNative = () => Promise<void>;

/**
 * Client → server request stream for client-streaming RPCs.
 * Native call is created on the first `send`.
 */
export class ServerInputStream implements GrpcServerInputStream {
  #started = false;
  #sendNative: SendNative;
  #finishNative: FinishNative;

  constructor(sendNative: SendNative, finishNative: FinishNative) {
    this.#sendNative = sendNative;
    this.#finishNative = finishNative;
  }

  send(data: Uint8Array): Promise<void> {
    const isFirst = !this.#started;
    this.#started = true;
    return this.#sendNative(data, isFirst);
  }

  complete(): Promise<void> {
    return this.#finishNative();
  }
}

export class GrpcClientStreamingCall
  implements PromiseLike<CompletedGrpcClientStreamingCall>
{
  readonly method: string;
  readonly requestHeaders: GrpcMetadata;
  readonly requests: GrpcServerInputStream;
  readonly headers: Promise<GrpcMetadata>;
  readonly response: Promise<Uint8Array>;
  readonly trailers: Promise<GrpcMetadata>;

  #abort: AbortController;

  constructor(
    method: string,
    requestHeaders: GrpcMetadata,
    requests: GrpcServerInputStream,
    headers: Promise<GrpcMetadata>,
    response: Promise<Uint8Array>,
    trailers: Promise<GrpcMetadata>,
    abort: AbortController
  ) {
    this.method = method;
    this.requestHeaders = requestHeaders;
    this.requests = requests;
    this.headers = headers;
    this.response = response;
    this.trailers = trailers;
    this.#abort = abort;
  }

  then<TResult1 = CompletedGrpcClientStreamingCall, TResult2 = unknown>(
    onfulfilled?:
      | ((
          value: CompletedGrpcClientStreamingCall
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

  private async completedPromise(): Promise<CompletedGrpcClientStreamingCall> {
    const [headers, response, trailers] = await Promise.all([
      this.headers,
      this.response,
      this.trailers,
    ]);

    return {
      method: this.method,
      requestHeaders: this.requestHeaders,
      headers,
      trailers,
      response,
      status: 0,
    };
  }
}
