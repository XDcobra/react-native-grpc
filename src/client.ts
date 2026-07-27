import { AbortController, AbortSignal } from 'abort-controller';
import { fromByteArray, toByteArray } from 'base64-js';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { GrpcError } from './errors';
import {
  GrpcServerStreamingCall,
  ServerOutputStream,
} from './server-streaming';
import { GrpcCallOptions, GrpcMetadata } from './types';
import { GrpcUnaryCall } from './unary';

type GrpcRequestObject = {
  data: string;
  /** Optional per-call override; native falls back to global default when omitted. */
  deadlineSeconds?: number;
};

type GrpcType = {
  getHost: () => Promise<string>;
  getIsInsecure: () => Promise<boolean>;
  setHost(host: string): void;
  setInsecure(insecure: boolean): void;
  setCompression(enable: boolean, compressorName: string): void;
  setResponseSizeLimit(limitInBytes: number): void;
  setCallDeadlineSeconds(seconds: number): void;
  initGrpcChannel(): void;
  unaryCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders?: GrpcMetadata
  ): Promise<void>;
  serverStreamingCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders?: GrpcMetadata
  ): Promise<void>;
  cancelGrpcCall: (id: number) => Promise<boolean>;
  clientStreamingCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders?: GrpcMetadata
  ): Promise<void>;
  finishClientStreaming(id: number): Promise<void>;
  resetConnection(message: string): void;
  setKeepAlive(
    enable: boolean,
    keepAliveTime: number,
    keepAliveTimeOut: number
  ): void;
  onConnectionStateChange(): void;
  setUiLogEnabled(enable: boolean): void;
  enterIdle(): void;
};

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

function nativeGrpc(): GrpcType {
  const grpc = (NativeModules as { Grpc: GrpcType }).Grpc;
  if (!grpc) {
    throw new Error('NativeModules.Grpc is not linked');
  }
  return grpc;
}

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

function handleGrpcEvent(event: GrpcEvent) {
  const deferred = deferredMap[event.id];

  if (deferred) {
    switch (event.type) {
      case 'headers':
        deferred.headers?.resolve(event.payload);
        break;
      case 'response':
        const data = toByteArray(event.payload);

        deferred.data?.notifyData(data);
        deferred.response?.resolve(data);
        break;
      case 'trailers':
        deferred.trailers?.resolve(event.payload);
        deferred.data?.notifyComplete();

        delete deferredMap[event.id];
        break;
      case 'error':
        const error = new GrpcError(event.error, event.code, event.trailers);

        deferred.headers?.reject(error);
        deferred.trailers?.reject(error);
        deferred.response?.reject(error);
        deferred.data?.noitfyError(error);

        delete deferredMap[event.id];
        break;
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

export class GrpcClient {
  constructor() {
    Emitter.addListener('grpc-call', handleGrpcEvent);
  }
  destroy() {
    Emitter.removeAllListeners('grpc-call');
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

  unaryCall(
    method: string,
    data: Uint8Array,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcUnaryCall {
    const obj = buildRequestObject(data, options);

    const id = getId();
    const abort = new AbortController();

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
    };

    nativeGrpc().unaryCall(id, method, obj, requestHeaders || {});

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

    return call;
  }
  serverStreamCall(
    method: string,
    data: Uint8Array,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcServerStreamingCall {
    const obj = buildRequestObject(data, options);

    const id = getId();
    const abort = new AbortController();

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
    };

    nativeGrpc().serverStreamingCall(id, method, obj, requestHeaders || {});

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

    return call;
  }

  private isAndroid(): Boolean {
    return Platform.OS === 'android';
  }
}

/** Lazy binding to NativeModules.Grpc (works with Jest mocks / late link). */
export const Grpc: GrpcType = new Proxy({} as GrpcType, {
  get(_target, prop) {
    const native = nativeGrpc();
    const value = (native as any)[prop as string];
    return typeof value === 'function' ? value.bind(native) : value;
  },
});
