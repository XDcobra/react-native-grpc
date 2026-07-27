import type {
  DescMessage,
  DescMethod,
  DescService,
  MessageShape,
} from '@bufbuild/protobuf';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import type {
  GenService,
  GenServiceMethods,
} from '@bufbuild/protobuf/codegenv2';
import type { GrpcCallApi } from './client';
import type {
  GrpcCallOptions,
  GrpcMetadata,
  GrpcServerOutputStream,
  RemoveListener,
  ServerOutputEvent,
  ServerOutputEventCallback,
} from './types';

/** Channel or singleton client that exposes the raw byte RPC surface. */
export type GrpcTransport = Pick<
  GrpcCallApi,
  'unaryCall' | 'serverStreamCall' | 'clientStreamCall' | 'bidiStreamCall'
>;

function makePath(service: DescService, method: DescMethod): string {
  return `/${service.typeName}/${method.name}`;
}

function decodeOutputStream<O extends DescMessage>(
  schema: O,
  stream: GrpcServerOutputStream
): TypedServerOutputStream<MessageShape<O>> {
  return {
    on(event, callback) {
      if (event === 'data') {
        return stream.on('data', (data) => {
          (callback as (message: MessageShape<O>) => void)(
            fromBinary(schema, data)
          );
        });
      }
      return stream.on(
        event,
        callback as ServerOutputEventCallback<typeof event>
      );
    },
  };
}

function toAsyncIterable<O>(
  stream: TypedServerOutputStream<O>,
  trailers: Promise<GrpcMetadata>
): AsyncIterable<O> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<O> {
      const queue: O[] = [];
      let pending:
        | {
            resolve: (r: IteratorResult<O>) => void;
            reject: (e: unknown) => void;
          }
        | undefined;
      let done = false;
      let error: unknown;

      const flush = () => {
        if (!pending) {
          return;
        }
        if (error !== undefined) {
          const { reject } = pending;
          pending = undefined;
          reject(error);
          return;
        }
        if (queue.length > 0) {
          const { resolve } = pending;
          pending = undefined;
          resolve({ value: queue.shift() as O, done: false });
          return;
        }
        if (done) {
          const { resolve } = pending;
          pending = undefined;
          resolve({ value: undefined, done: true });
        }
      };

      stream.on('data', (message) => {
        queue.push(message);
        flush();
      });
      stream.on('error', (reason) => {
        error = reason;
        flush();
      });
      stream.on('complete', () => {
        done = true;
        flush();
      });
      // Ensure we observe trailers rejection as stream failure.
      trailers.catch((reason) => {
        error = reason;
        flush();
      });

      return {
        next(): Promise<IteratorResult<O>> {
          if (error !== undefined) {
            return Promise.reject(error);
          }
          if (queue.length > 0) {
            return Promise.resolve({
              value: queue.shift() as O,
              done: false,
            });
          }
          if (done) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<IteratorResult<O>>((resolve, reject) => {
            pending = { resolve, reject };
          });
        },
      };
    },
  };
}

export type TypedServerOutputStream<O> = {
  on<T extends ServerOutputEvent>(
    event: T,
    callback: T extends 'data'
      ? (message: O) => void
      : ServerOutputEventCallback<T>
  ): RemoveListener;
};

export type UnaryMethod<I extends DescMessage, O extends DescMessage> = (
  request: MessageShape<I>,
  headers?: GrpcMetadata,
  options?: GrpcCallOptions
) => Promise<MessageShape<O>>;

export type ServerStreamingMethod<
  I extends DescMessage,
  O extends DescMessage
> = (
  request: MessageShape<I>,
  headers?: GrpcMetadata,
  options?: GrpcCallOptions
) => ServerStreamingCall<MessageShape<O>>;

export type ServerStreamingCall<O> = AsyncIterable<O> & {
  readonly headers: Promise<GrpcMetadata>;
  readonly responses: TypedServerOutputStream<O>;
  readonly trailers: Promise<GrpcMetadata>;
  cancel(): void;
};

export type ClientStreamingMethod<
  I extends DescMessage,
  O extends DescMessage
> = (
  headers?: GrpcMetadata,
  options?: GrpcCallOptions
) => ClientStreamingCall<MessageShape<I>, MessageShape<O>>;

export type ClientStreamingCall<I, O> = {
  send(message: I): Promise<void>;
  complete(): Promise<void>;
  readonly response: Promise<O>;
  readonly headers: Promise<GrpcMetadata>;
  readonly trailers: Promise<GrpcMetadata>;
  cancel(): void;
};

export type BidiStreamingMethod<
  I extends DescMessage,
  O extends DescMessage
> = (
  headers?: GrpcMetadata,
  options?: GrpcCallOptions
) => BidiStreamingCall<MessageShape<I>, MessageShape<O>>;

export type BidiStreamingCall<I, O> = {
  send(message: I): Promise<void>;
  complete(): Promise<void>;
  readonly responses: TypedServerOutputStream<O>;
  readonly headers: Promise<GrpcMetadata>;
  readonly trailers: Promise<GrpcMetadata>;
  cancel(): void;
} & AsyncIterable<O>;

type ClientMethod<M> = M extends {
  methodKind: 'unary';
  input: infer I;
  output: infer O;
}
  ? I extends DescMessage
    ? O extends DescMessage
      ? UnaryMethod<I, O>
      : never
    : never
  : M extends {
      methodKind: 'server_streaming';
      input: infer I;
      output: infer O;
    }
  ? I extends DescMessage
    ? O extends DescMessage
      ? ServerStreamingMethod<I, O>
      : never
    : never
  : M extends {
      methodKind: 'client_streaming';
      input: infer I;
      output: infer O;
    }
  ? I extends DescMessage
    ? O extends DescMessage
      ? ClientStreamingMethod<I, O>
      : never
    : never
  : M extends {
      methodKind: 'bidi_streaming';
      input: infer I;
      output: infer O;
    }
  ? I extends DescMessage
    ? O extends DescMessage
      ? BidiStreamingMethod<I, O>
      : never
    : never
  : never;

/** Typed RPC client for a Protobuf-ES `GenService` schema. */
export type Client<Desc extends DescService> = {
  [K in keyof Desc['method']]: ClientMethod<Desc['method'][K]>;
};

function createUnaryMethod<I extends DescMessage, O extends DescMessage>(
  transport: GrpcTransport,
  service: DescService,
  method: DescMethod
): UnaryMethod<I, O> {
  const path = makePath(service, method);
  const input = method.input as I;
  const output = method.output as O;
  return async (request, headers, options) => {
    const call = transport.unaryCall(
      path,
      toBinary(input, request),
      headers,
      options
    );
    const bytes = await call.response;
    return fromBinary(output, bytes);
  };
}

function createServerStreamingMethod<
  I extends DescMessage,
  O extends DescMessage
>(
  transport: GrpcTransport,
  service: DescService,
  method: DescMethod
): ServerStreamingMethod<I, O> {
  const path = makePath(service, method);
  const input = method.input as I;
  const output = method.output as O;
  return (request, headers, options) => {
    const call = transport.serverStreamCall(
      path,
      toBinary(input, request),
      headers,
      options
    );
    const responses = decodeOutputStream(output, call.responses);
    const iterable = toAsyncIterable(responses, call.trailers);
    return {
      headers: call.headers,
      responses,
      trailers: call.trailers,
      cancel: () => call.cancel(),
      [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
    };
  };
}

function createClientStreamingMethod<
  I extends DescMessage,
  O extends DescMessage
>(
  transport: GrpcTransport,
  service: DescService,
  method: DescMethod
): ClientStreamingMethod<I, O> {
  const path = makePath(service, method);
  const input = method.input as I;
  const output = method.output as O;
  return (headers, options) => {
    const call = transport.clientStreamCall(path, headers, options);
    return {
      send: (message) => call.requests.send(toBinary(input, message)),
      complete: () => call.requests.complete(),
      response: call.response.then((bytes) => fromBinary(output, bytes)),
      headers: call.headers,
      trailers: call.trailers,
      cancel: () => call.cancel(),
    };
  };
}

function createBidiStreamingMethod<
  I extends DescMessage,
  O extends DescMessage
>(
  transport: GrpcTransport,
  service: DescService,
  method: DescMethod
): BidiStreamingMethod<I, O> {
  const path = makePath(service, method);
  const input = method.input as I;
  const output = method.output as O;
  return (headers, options) => {
    const call = transport.bidiStreamCall(path, headers, options);
    const responses = decodeOutputStream(output, call.responses);
    const iterable = toAsyncIterable(responses, call.trailers);
    return {
      send: (message) => call.requests.send(toBinary(input, message)),
      complete: () => call.requests.complete(),
      responses,
      headers: call.headers,
      trailers: call.trailers,
      cancel: () => call.cancel(),
      [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
    };
  };
}

/**
 * Create a typed client for a Protobuf-ES service schema (`protoc-gen-es`).
 *
 * Requires peer dependency `@bufbuild/protobuf`. Maps RPCs onto
 * {@link GrpcTransport} (`GrpcClient` or a `GrpcChannel`).
 */
export function createClient<T extends GenServiceMethods>(
  service: GenService<T>,
  transport: GrpcTransport
): Client<GenService<T>> {
  const client = {} as Client<GenService<T>>;
  for (const method of service.methods) {
    const key = method.localName as keyof Client<GenService<T>>;
    switch (method.methodKind) {
      case 'unary':
        client[key] = createUnaryMethod(transport, service, method) as Client<
          GenService<T>
        >[typeof key];
        break;
      case 'server_streaming':
        client[key] = createServerStreamingMethod(
          transport,
          service,
          method
        ) as Client<GenService<T>>[typeof key];
        break;
      case 'client_streaming':
        client[key] = createClientStreamingMethod(
          transport,
          service,
          method
        ) as Client<GenService<T>>[typeof key];
        break;
      case 'bidi_streaming':
        client[key] = createBidiStreamingMethod(
          transport,
          service,
          method
        ) as Client<GenService<T>>[typeof key];
        break;
      default:
        break;
    }
  }
  return client;
}
