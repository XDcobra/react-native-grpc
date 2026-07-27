import { AbortController, AbortSignal } from 'abort-controller';
import { fromByteArray, toByteArray } from 'base64-js';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { GrpcBidiStreamingCall } from './bidi-streaming';
import { GrpcClientStreamingCall, ServerInputStream } from './client-streaming';
import { GrpcError } from './errors';
import {
  combineInterceptors,
  GrpcInterceptor,
  runOnError,
  runOnHeaders,
  runOnMessage,
  runOnSendMessage,
  runOnStart,
  runOnTrailers,
  toGrpcError,
} from './interceptors';
import { GrpcRequestObject, nativeGrpc } from './native';
import {
  GrpcServerStreamingCall,
  ServerOutputStream,
} from './server-streaming';
import {
  DEFAULT_CHANNEL_ID,
  GrpcCallOptions,
  GrpcMetadata,
  GrpcTlsOptions,
} from './types';
import { GrpcUnaryCall } from './unary';

type GrpcEventType = 'response' | 'error' | 'headers' | 'trailers';

/* prettier-ignore */
type GrpcEventPayload =
  {
    type: 'response';
    payload: string;
  } | {
  type: 'error';
  error: string;
  code?: number;
  trailers?: GrpcMetadata;
} | {
  type: 'headers';
  payload: GrpcMetadata;
} | {
  type: 'trailers';
  payload: GrpcMetadata;
} | {
  type: 'status';
  payload: number;
};

type GrpcEvent = {
  id: number;
  type: GrpcEventType;
} & GrpcEventPayload;

const Emitter = new NativeEventEmitter(NativeModules.Grpc);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
};

type DeferredCalls = {
  headers?: Deferred<GrpcMetadata>;
  response?: Deferred<Uint8Array>;
  trailers?: Deferred<GrpcMetadata>;
  data?: ServerOutputStream;
  method: string;
  interceptors: GrpcInterceptor[];
};

type DeferredCallMap = {
  [id: number]: DeferredCalls;
};

function createDeferred<T>(signal: AbortSignal) {
  let completed = false;

  const deferred: Deferred<T> = {} as any;

  deferred.promise = new Promise<T>((resolve, reject) => {
    deferred.resolve = (value) => {
      completed = true;

      resolve(value);
    };
    deferred.reject = (reason) => {
      completed = true;

      reject(reason);
    };
  });

  signal.addEventListener('abort', () => {
    if (!completed) {
      deferred.reject('aborted');
    }
  });

  return deferred;
}

let idCtr = 1;

const deferredMap: DeferredCallMap = {};

function rejectDeferredCall(deferred: DeferredCalls, error: GrpcError) {
  deferred.headers?.reject(error);
  deferred.trailers?.reject(error);
  deferred.response?.reject(error);
  deferred.data?.noitfyError(error);
}

function handleGrpcEvent(event: GrpcEvent) {
  const deferred = deferredMap[event.id];

  if (deferred) {
    const { method, interceptors } = deferred;
    switch (event.type) {
      case 'headers':
        deferred.headers?.resolve(
          runOnHeaders(interceptors, event.payload, method)
        );
        break;
      case 'response': {
        const data = runOnMessage(
          interceptors,
          toByteArray(event.payload),
          method
        );

        deferred.data?.notifyData(data);
        deferred.response?.resolve(data);
        break;
      }
      case 'trailers':
        deferred.trailers?.resolve(
          runOnTrailers(interceptors, event.payload, method)
        );
        deferred.data?.notifyComplete();

        delete deferredMap[event.id];
        break;
      case 'error': {
        const error = runOnError(
          interceptors,
          new GrpcError(event.error, event.code, event.trailers),
          method
        );

        rejectDeferredCall(deferred, error);

        delete deferredMap[event.id];
        break;
      }
    }
  }
}

function getId(): number {
  return idCtr++;
}

function buildRequestObject(
  data: Uint8Array,
  options?: GrpcCallOptions
): GrpcRequestObject {
  const obj: GrpcRequestObject = {
    data: fromByteArray(data),
  };
  if (options?.deadlineSeconds !== undefined) {
    obj.deadlineSeconds = options.deadlineSeconds;
  }
  return obj;
}

export function normalizeTlsOptions(options: GrpcTlsOptions = {}): {
  rootCertsPem: string | null;
  certificateChainPem: string | null;
  privateKeyPem: string | null;
  hostNameOverride: string | null;
  spkiSha256Pins: string[] | null;
} {
  const rootCertsPem = options.rootCertsPem ?? null;
  const certificateChainPem = options.certificateChainPem ?? null;
  const privateKeyPem = options.privateKeyPem ?? null;
  const hostNameOverride = options.hostNameOverride ?? null;
  const spkiSha256Pins =
    options.spkiSha256Pins && options.spkiSha256Pins.length > 0
      ? options.spkiSha256Pins
      : null;

  const hasCert = !!certificateChainPem;
  const hasKey = !!privateKeyPem;
  if (hasCert !== hasKey) {
    throw new Error('mTLS requires both certificateChainPem and privateKeyPem');
  }

  return {
    rootCertsPem,
    certificateChainPem,
    privateKeyPem,
    hostNameOverride,
    spkiSha256Pins,
  };
}

/**
 * Shared RPC surface bound to a native channel id.
 * Used by the singleton {@link GrpcClient} and by {@link GrpcChannel}.
 */
export class GrpcCallApi {
  protected channelInterceptors: GrpcInterceptor[];

  constructor(
    protected readonly channelId: string,
    channelInterceptors: readonly GrpcInterceptor[] = []
  ) {
    this.channelInterceptors = [...channelInterceptors];
  }

  protected resolveInterceptors(options?: GrpcCallOptions): GrpcInterceptor[] {
    return combineInterceptors(this.channelInterceptors, options?.interceptors);
  }

  unaryCall(
    method: string,
    data: Uint8Array,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcUnaryCall {
    const id = getId();
    const abort = new AbortController();
    const interceptors = this.resolveInterceptors(options);

    abort.signal.addEventListener('abort', () => {
      nativeGrpc().cancelGrpcCall(id);
    });

    const response = createDeferred<Uint8Array>(abort.signal);
    const headers = createDeferred<GrpcMetadata>(abort.signal);
    const trailers = createDeferred<GrpcMetadata>(abort.signal);

    deferredMap[id] = {
      response,
      headers,
      trailers,
      method,
      interceptors,
    };

    const call = new GrpcUnaryCall(
      method,
      data,
      requestHeaders || {},
      headers.promise,
      response.promise,
      trailers.promise,
      abort
    );

    call.then(
      (result) => result,
      () => abort.abort()
    );

    Promise.resolve()
      .then(async () => {
        let start = await runOnStart(interceptors, {
          method,
          headers: { ...(requestHeaders || {}) },
          options: { ...(options || {}) },
          request: data,
        });
        const callOptions = { ...start.options };
        delete callOptions.interceptors;
        start = {
          ...start,
          options: callOptions,
        };
        const requestBytes = await runOnSendMessage(
          interceptors,
          start.request ?? data,
          start.method
        );
        const obj = buildRequestObject(requestBytes, start.options);
        await nativeGrpc().unaryCall(
          id,
          start.method,
          obj,
          start.headers,
          this.channelId
        );
      })
      .catch((reason) => {
        const deferred = deferredMap[id];
        if (!deferred) {
          return;
        }
        const error = runOnError(interceptors, toGrpcError(reason), method);
        rejectDeferredCall(deferred, error);
        delete deferredMap[id];
      });

    return call;
  }

  serverStreamCall(
    method: string,
    data: Uint8Array,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcServerStreamingCall {
    const id = getId();
    const abort = new AbortController();
    const interceptors = this.resolveInterceptors(options);

    abort.signal.addEventListener('abort', () => {
      nativeGrpc().cancelGrpcCall(id);
    });

    const headers = createDeferred<GrpcMetadata>(abort.signal);
    const trailers = createDeferred<GrpcMetadata>(abort.signal);

    const stream = new ServerOutputStream();

    deferredMap[id] = {
      headers,
      trailers,
      data: stream,
      method,
      interceptors,
    };

    const call = new GrpcServerStreamingCall(
      method,
      data,
      requestHeaders || {},
      headers.promise,
      stream,
      trailers.promise,
      abort
    );

    call.then(
      (result) => result,
      () => abort.abort()
    );

    Promise.resolve()
      .then(async () => {
        let start = await runOnStart(interceptors, {
          method,
          headers: { ...(requestHeaders || {}) },
          options: { ...(options || {}) },
          request: data,
        });
        const callOptions = { ...start.options };
        delete callOptions.interceptors;
        start = {
          ...start,
          options: callOptions,
        };
        const requestBytes = await runOnSendMessage(
          interceptors,
          start.request ?? data,
          start.method
        );
        const obj = buildRequestObject(requestBytes, start.options);
        await nativeGrpc().serverStreamingCall(
          id,
          start.method,
          obj,
          start.headers,
          this.channelId
        );
      })
      .catch((reason) => {
        const deferred = deferredMap[id];
        if (!deferred) {
          return;
        }
        const error = runOnError(interceptors, toGrpcError(reason), method);
        rejectDeferredCall(deferred, error);
        delete deferredMap[id];
      });

    return call;
  }

  /**
   * Client-streaming RPC: many request messages, one response.
   * Native call starts on the first `requests.send(...)`.
   */
  clientStreamCall(
    method: string,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcClientStreamingCall {
    const id = getId();
    const abort = new AbortController();
    const interceptors = this.resolveInterceptors(options);
    let headersMeta = { ...(requestHeaders || {}) };
    let callOptions: GrpcCallOptions = { ...(options || {}) };
    const channelId = this.channelId;
    let started = false;

    abort.signal.addEventListener('abort', () => {
      nativeGrpc().cancelGrpcCall(id);
    });

    const response = createDeferred<Uint8Array>(abort.signal);
    const headers = createDeferred<GrpcMetadata>(abort.signal);
    const trailers = createDeferred<GrpcMetadata>(abort.signal);

    deferredMap[id] = {
      response,
      headers,
      trailers,
      method,
      interceptors,
    };

    const requests = new ServerInputStream(
      async (data, isFirst) => {
        try {
          let message = await runOnSendMessage(interceptors, data, method);
          if (isFirst || !started) {
            const start = await runOnStart(interceptors, {
              method,
              headers: headersMeta,
              options: callOptions,
              request: message,
            });
            headersMeta = start.headers;
            callOptions = { ...start.options };
            delete callOptions.interceptors;
            message = start.request ?? message;
            started = true;
          }
          const obj = buildRequestObject(
            message,
            isFirst ? callOptions : undefined
          );
          return nativeGrpc().clientStreamingCall(
            id,
            method,
            obj,
            isFirst ? headersMeta : {},
            channelId
          );
        } catch (reason) {
          const deferred = deferredMap[id];
          if (deferred) {
            const error = runOnError(interceptors, toGrpcError(reason), method);
            rejectDeferredCall(deferred, error);
            delete deferredMap[id];
          }
          throw toGrpcError(reason);
        }
      },
      () => nativeGrpc().finishClientStreaming(id)
    );

    const call = new GrpcClientStreamingCall(
      method,
      headersMeta,
      requests,
      headers.promise,
      response.promise,
      trailers.promise,
      abort
    );

    call.then(
      (result) => result,
      () => abort.abort()
    );

    return call;
  }

  /**
   * Bidirectional streaming RPC: interleaved request and response messages.
   * Native call starts on the first `requests.send(...)`.
   * Registers only the `data` stream (plus headers/trailers) — no unary `response`.
   */
  bidiStreamCall(
    method: string,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcBidiStreamingCall {
    const id = getId();
    const abort = new AbortController();
    const interceptors = this.resolveInterceptors(options);
    let headersMeta = { ...(requestHeaders || {}) };
    let callOptions: GrpcCallOptions = { ...(options || {}) };
    const channelId = this.channelId;
    let started = false;

    abort.signal.addEventListener('abort', () => {
      nativeGrpc().cancelGrpcCall(id);
    });

    const headers = createDeferred<GrpcMetadata>(abort.signal);
    const trailers = createDeferred<GrpcMetadata>(abort.signal);
    const stream = new ServerOutputStream();

    deferredMap[id] = {
      headers,
      trailers,
      data: stream,
      method,
      interceptors,
    };

    const requests = new ServerInputStream(
      async (data, isFirst) => {
        try {
          let message = await runOnSendMessage(interceptors, data, method);
          if (isFirst || !started) {
            const start = await runOnStart(interceptors, {
              method,
              headers: headersMeta,
              options: callOptions,
              request: message,
            });
            headersMeta = start.headers;
            callOptions = { ...start.options };
            delete callOptions.interceptors;
            message = start.request ?? message;
            started = true;
          }
          const obj = buildRequestObject(
            message,
            isFirst ? callOptions : undefined
          );
          return nativeGrpc().bidiStreamingCall(
            id,
            method,
            obj,
            isFirst ? headersMeta : {},
            channelId
          );
        } catch (reason) {
          const deferred = deferredMap[id];
          if (deferred) {
            const error = runOnError(interceptors, toGrpcError(reason), method);
            rejectDeferredCall(deferred, error);
            delete deferredMap[id];
          }
          throw toGrpcError(reason);
        }
      },
      () => nativeGrpc().finishClientStreaming(id)
    );

    const call = new GrpcBidiStreamingCall(
      method,
      headersMeta,
      requests,
      headers.promise,
      stream,
      trailers.promise,
      abort
    );

    call.then(
      (result) => result,
      () => abort.abort()
    );

    return call;
  }
}

export class GrpcClient extends GrpcCallApi {
  constructor() {
    super(DEFAULT_CHANNEL_ID, []);
    Emitter.addListener('grpc-call', handleGrpcEvent);
  }
  destroy() {
    Emitter.removeAllListeners('grpc-call');
  }
  /**
   * Replace default-channel interceptors (same replace semantics as `setTlsOptions`).
   * Prefer `createChannel({ interceptors })` for multi-host apps.
   */
  setInterceptors(interceptors: GrpcInterceptor[] = []): void {
    this.channelInterceptors = [...interceptors];
  }
  getHost(): Promise<string> {
    return nativeGrpc().getHost();
  }
  setHost(host: string): void {
    nativeGrpc().setHost(host);
  }
  getInsecure(): Promise<boolean> {
    return nativeGrpc().getIsInsecure();
  }
  setInsecure(insecure: boolean): void {
    nativeGrpc().setInsecure(insecure);
  }
  /**
   * Replace channel TLS options (custom CA, mTLS, hostname override).
   * Each call replaces the previous config; omitted fields are cleared.
   * Apply before `initGrpcChannel()`. Ignored while insecure/plaintext.
   * For multi-host apps prefer {@link createChannel} with `tls` in config.
   */
  setTlsOptions(options: GrpcTlsOptions = {}): void {
    nativeGrpc().setTlsOptions(normalizeTlsOptions(options));
  }
  setCompression(enable: boolean, compressorName: string): void {
    nativeGrpc().setCompression(enable, compressorName);
  }
  setResponseSizeLimit(limitInBytes: number): void {
    nativeGrpc().setResponseSizeLimit(limitInBytes);
  }
  /** Global per-call deadline in seconds (Android/iOS). Default 120. Overridable per RPC via options. */
  setCallDeadlineSeconds(seconds: number): void {
    nativeGrpc().setCallDeadlineSeconds(seconds);
  }

  initGrpcChannel() {
    nativeGrpc().initGrpcChannel();
  }

  setKeepAlive(
    enable: boolean,
    keepAliveTime: number,
    keepAliveTimeOut: number
  ): void {
    nativeGrpc().setKeepAlive(enable, keepAliveTime, keepAliveTimeOut);
  }

  resetConnection(message: string): void {
    if (!this.isAndroid()) return;
    nativeGrpc().resetConnection(message);
  }
  setUiLogEnabled(enable: boolean): void {
    if (!this.isAndroid()) return;
    nativeGrpc().setUiLogEnabled(enable);
  }

  onConnectionStateChange(): void {
    if (!this.isAndroid()) return;
    nativeGrpc().onConnectionStateChange();
  }

  enterIdle(): void {
    if (!this.isAndroid()) return;
    nativeGrpc().enterIdle();
  }

  private isAndroid(): Boolean {
    return Platform.OS === 'android';
  }
}

export { Grpc } from './native';
