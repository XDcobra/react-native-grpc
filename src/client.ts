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
  computeRetryBackoffMs,
  delay,
  EffectiveCallPolicy,
  GrpcHedgingPolicy,
  GrpcRetryPolicy,
  normalizeHedgingPolicy,
  normalizeRetryPolicy,
  remainingDeadlineSeconds,
  resolveEffectivePolicy,
} from './retry';
import { GrpcStatusCode } from './status';
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
  protected channelDeadlineSeconds = 120;
  protected channelRetry: GrpcRetryPolicy | null = null;
  protected channelHedging: GrpcHedgingPolicy | null = null;

  constructor(
    protected readonly channelId: string,
    channelInterceptors: readonly GrpcInterceptor[] = [],
    channelDeadlineSeconds = 120,
    channelRetry: GrpcRetryPolicy | null = null,
    channelHedging: GrpcHedgingPolicy | null = null
  ) {
    this.channelInterceptors = [...channelInterceptors];
    this.channelDeadlineSeconds = channelDeadlineSeconds;
    this.channelRetry = channelRetry;
    this.channelHedging = channelHedging;
  }

  protected resolveInterceptors(options?: GrpcCallOptions): GrpcInterceptor[] {
    return combineInterceptors(this.channelInterceptors, options?.interceptors);
  }

  protected resolvePolicy(options?: GrpcCallOptions): EffectiveCallPolicy {
    return resolveEffectivePolicy(
      this.channelRetry,
      this.channelHedging,
      options?.retry,
      options?.hedging
    );
  }

  protected resolveDeadlineBudgetSeconds(
    options?: GrpcCallOptions
  ): number | undefined {
    if (options?.deadlineSeconds !== undefined) {
      return options.deadlineSeconds;
    }
    return this.channelDeadlineSeconds;
  }

  private async runUnaryAttempt(
    method: string,
    data: Uint8Array,
    requestHeaders: GrpcMetadata,
    options: GrpcCallOptions | undefined,
    interceptors: GrpcInterceptor[],
    parentSignal: AbortSignal,
    attemptIds: Set<number>
  ): Promise<{
    headers: GrpcMetadata;
    response: Uint8Array;
    trailers: GrpcMetadata;
  }> {
    if (parentSignal.aborted) {
      throw new GrpcError('aborted', GrpcStatusCode.CANCELLED);
    }

    const id = getId();
    attemptIds.add(id);
    const attemptAbort = new AbortController();
    const onParentAbort = () => attemptAbort.abort();
    parentSignal.addEventListener('abort', onParentAbort);

    const response = createDeferred<Uint8Array>(attemptAbort.signal);
    const headers = createDeferred<GrpcMetadata>(attemptAbort.signal);
    const trailers = createDeferred<GrpcMetadata>(attemptAbort.signal);

    deferredMap[id] = {
      response,
      headers,
      trailers,
      method,
      interceptors,
    };

    try {
      let start = await runOnStart(interceptors, {
        method,
        headers: { ...requestHeaders },
        options: { ...(options || {}) },
        request: data,
      });
      const callOptions = { ...start.options };
      delete callOptions.interceptors;
      delete callOptions.retry;
      delete callOptions.hedging;
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

      const [hdrs, body, trl] = await Promise.all([
        headers.promise,
        response.promise,
        trailers.promise,
      ]);
      return { headers: hdrs, response: body, trailers: trl };
    } catch (reason) {
      if (attemptAbort.signal.aborted || parentSignal.aborted) {
        throw new GrpcError('aborted', GrpcStatusCode.CANCELLED);
      }
      throw toGrpcError(reason);
    } finally {
      parentSignal.removeEventListener('abort', onParentAbort);
      attemptIds.delete(id);
      if (attemptAbort.signal.aborted) {
        nativeGrpc().cancelGrpcCall(id);
      }
    }
  }

  private async runUnaryWithPolicy(
    method: string,
    data: Uint8Array,
    requestHeaders: GrpcMetadata,
    options: GrpcCallOptions | undefined,
    interceptors: GrpcInterceptor[],
    parentSignal: AbortSignal,
    policy: EffectiveCallPolicy,
    deadlineBudgetSeconds: number | undefined
  ): Promise<{
    headers: GrpcMetadata;
    response: Uint8Array;
    trailers: GrpcMetadata;
  }> {
    const startedAt = Date.now();
    const attemptIds = new Set<number>();

    const withRemainingDeadline = (): GrpcCallOptions => {
      const next: GrpcCallOptions = { ...(options || {}) };
      delete next.interceptors;
      delete next.retry;
      delete next.hedging;
      if (policy.kind === 'none') {
        if (options?.deadlineSeconds === undefined) {
          delete next.deadlineSeconds;
        }
        return next;
      }
      const remaining = remainingDeadlineSeconds(
        deadlineBudgetSeconds,
        startedAt
      );
      if (remaining !== undefined) {
        next.deadlineSeconds = remaining;
      }
      return next;
    };

    const cancelAllAttempts = () => {
      for (const id of [...attemptIds]) {
        nativeGrpc().cancelGrpcCall(id);
      }
    };
    const onAbort = () => cancelAllAttempts();
    parentSignal.addEventListener('abort', onAbort);

    try {
      if (policy.kind === 'none') {
        return await this.runUnaryAttempt(
          method,
          data,
          requestHeaders,
          withRemainingDeadline(),
          interceptors,
          parentSignal,
          attemptIds
        );
      }

      if (policy.kind === 'retry') {
        let lastError: GrpcError | undefined;
        for (let attempt = 1; attempt <= policy.policy.maxAttempts; attempt++) {
          if (parentSignal.aborted) {
            throw new GrpcError('aborted', GrpcStatusCode.CANCELLED);
          }
          const remaining = remainingDeadlineSeconds(
            deadlineBudgetSeconds,
            startedAt
          );
          if (
            deadlineBudgetSeconds !== undefined &&
            deadlineBudgetSeconds > 0 &&
            remaining !== undefined &&
            remaining <= 0
          ) {
            throw new GrpcError(
              'DEADLINE_EXCEEDED',
              GrpcStatusCode.DEADLINE_EXCEEDED
            );
          }
          try {
            return await this.runUnaryAttempt(
              method,
              data,
              requestHeaders,
              withRemainingDeadline(),
              interceptors,
              parentSignal,
              attemptIds
            );
          } catch (reason) {
            const error = toGrpcError(reason);
            lastError = error;
            if (
              error.code === GrpcStatusCode.CANCELLED ||
              parentSignal.aborted
            ) {
              throw error;
            }
            const retryable =
              error.code !== undefined &&
              policy.policy.retryableStatusCodes.has(error.code);
            if (!retryable || attempt >= policy.policy.maxAttempts) {
              throw error;
            }
            const backoffMs = computeRetryBackoffMs(policy.policy, attempt);
            await delay(backoffMs, parentSignal as any);
          }
        }
        throw (
          lastError ?? new GrpcError('UNAVAILABLE', GrpcStatusCode.UNAVAILABLE)
        );
      }

      // hedging
      type AttemptOutcome =
        | {
            ok: true;
            value: {
              headers: GrpcMetadata;
              response: Uint8Array;
              trailers: GrpcMetadata;
            };
          }
        | { ok: false; error: GrpcError };

      return await new Promise((resolve, reject) => {
        let settled = false;
        let started = 0;
        let finished = 0;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const inFlight = new Map<number, Promise<AttemptOutcome>>();

        const finishSuccess = (value: {
          headers: GrpcMetadata;
          response: Uint8Array;
          trailers: GrpcMetadata;
        }) => {
          if (settled) {
            return;
          }
          settled = true;
          timers.forEach(clearTimeout);
          cancelAllAttempts();
          resolve(value);
        };

        const finishError = (error: GrpcError) => {
          if (settled) {
            return;
          }
          settled = true;
          timers.forEach(clearTimeout);
          cancelAllAttempts();
          reject(error);
        };

        const launch = () => {
          if (settled || parentSignal.aborted) {
            return;
          }
          const remaining = remainingDeadlineSeconds(
            deadlineBudgetSeconds,
            startedAt
          );
          if (
            deadlineBudgetSeconds !== undefined &&
            deadlineBudgetSeconds > 0 &&
            remaining !== undefined &&
            remaining <= 0
          ) {
            finishError(
              new GrpcError(
                'DEADLINE_EXCEEDED',
                GrpcStatusCode.DEADLINE_EXCEEDED
              )
            );
            return;
          }

          started += 1;
          const launchIndex = started;
          const p = this.runUnaryAttempt(
            method,
            data,
            requestHeaders,
            withRemainingDeadline(),
            interceptors,
            parentSignal,
            attemptIds
          )
            .then(
              (value): AttemptOutcome => ({ ok: true, value }),
              (reason): AttemptOutcome => ({
                ok: false,
                error: toGrpcError(reason),
              })
            )
            .then((outcome) => {
              inFlight.delete(launchIndex);
              finished += 1;
              if (settled) {
                return outcome;
              }
              if (outcome.ok) {
                finishSuccess(outcome.value);
                return outcome;
              }
              const { error } = outcome;
              if (
                error.code === GrpcStatusCode.CANCELLED ||
                parentSignal.aborted
              ) {
                if (finished >= started && inFlight.size === 0) {
                  finishError(error);
                }
                return outcome;
              }
              const nonFatal =
                error.code !== undefined &&
                policy.policy.nonFatalStatusCodes.has(error.code);
              if (!nonFatal) {
                finishError(error);
                return outcome;
              }
              if (
                finished >= policy.policy.maxAttempts ||
                (started >= policy.policy.maxAttempts && inFlight.size === 0)
              ) {
                finishError(error);
              }
              return outcome;
            });
          inFlight.set(launchIndex, p);
        };

        launch();
        for (let i = 2; i <= policy.policy.maxAttempts; i++) {
          const delayMs = policy.policy.hedgingDelayMs * (i - 1);
          if (delayMs <= 0) {
            launch();
          } else {
            timers.push(setTimeout(launch, delayMs));
          }
        }

        parentSignal.addEventListener('abort', () => {
          finishError(new GrpcError('aborted', GrpcStatusCode.CANCELLED));
        });
      });
    } finally {
      parentSignal.removeEventListener('abort', onAbort);
    }
  }

  unaryCall(
    method: string,
    data: Uint8Array,
    requestHeaders?: GrpcMetadata,
    options?: GrpcCallOptions
  ): GrpcUnaryCall {
    const abort = new AbortController();
    const interceptors = this.resolveInterceptors(options);
    const policy = this.resolvePolicy(options);
    const deadlineBudgetSeconds = this.resolveDeadlineBudgetSeconds(options);

    const response = createDeferred<Uint8Array>(abort.signal);
    const headers = createDeferred<GrpcMetadata>(abort.signal);
    const trailers = createDeferred<GrpcMetadata>(abort.signal);

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
        const result = await this.runUnaryWithPolicy(
          method,
          data,
          requestHeaders || {},
          options,
          interceptors,
          abort.signal,
          policy,
          deadlineBudgetSeconds
        );
        headers.resolve(result.headers);
        response.resolve(result.response);
        trailers.resolve(result.trailers);
      })
      .catch((reason) => {
        if (abort.signal.aborted) {
          const error = new GrpcError('aborted', GrpcStatusCode.CANCELLED);
          headers.reject(error);
          response.reject(error);
          trailers.reject(error);
          return;
        }
        const error = runOnError(interceptors, toGrpcError(reason), method);
        headers.reject(error);
        response.reject(error);
        trailers.reject(error);
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
    super(DEFAULT_CHANNEL_ID, [], 120, null, null);
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
  /**
   * Replace unary retry policy on the default channel.
   * Clears any hedging policy (mutually exclusive). Pass `null` to disable.
   */
  setRetryPolicy(policy: GrpcRetryPolicy | null): void {
    if (policy) {
      normalizeRetryPolicy(policy);
    }
    this.channelRetry = policy;
    this.channelHedging = null;
  }
  /**
   * Replace unary hedging policy on the default channel.
   * Clears any retry policy (mutually exclusive). Pass `null` to disable.
   */
  setHedgingPolicy(policy: GrpcHedgingPolicy | null): void {
    if (policy) {
      normalizeHedgingPolicy(policy);
    }
    this.channelHedging = policy;
    this.channelRetry = null;
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
    this.channelDeadlineSeconds = Math.max(0, seconds);
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
