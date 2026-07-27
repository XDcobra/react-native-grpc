import { GrpcError } from './errors';
import { GrpcCallOptions, GrpcMetadata } from './types';

/** Mutable start payload; interceptors may replace fields before the native call. */
export type GrpcInterceptStart = {
  method: string;
  headers: GrpcMetadata;
  options: GrpcCallOptions;
  /** Present for unary / server-streaming; optional for client/bidi until first send. */
  request?: Uint8Array;
};

/**
 * Request/response middleware hooks.
 * Outbound hooks run index 0→n; inbound hooks run n→0 (onion).
 */
export type GrpcInterceptor = {
  /**
   * Outbound: before native start. Throw to abort (rejected call).
   * Return a value to replace the start payload; `void` keeps the previous value.
   */
  onStart?(
    start: GrpcInterceptStart
  ): void | GrpcInterceptStart | Promise<void | GrpcInterceptStart>;
  /**
   * Each outbound message (unary/server request, every client/bidi send).
   */
  onSendMessage?(
    message: Uint8Array,
    method: string
  ): void | Uint8Array | Promise<void | Uint8Array>;
  /** Inbound response headers. */
  onHeaders?(headers: GrpcMetadata, method: string): void | GrpcMetadata;
  /** Each inbound message. */
  onMessage?(message: Uint8Array, method: string): void | Uint8Array;
  /** Successful close trailers. */
  onTrailers?(trailers: GrpcMetadata, method: string): void | GrpcMetadata;
  /** Error path. May remap to another Error / GrpcError. */
  onError?(error: GrpcError, method: string): void | GrpcError | Error;
};

/** Channel interceptors first, then per-call interceptors. */
export function combineInterceptors(
  channel: readonly GrpcInterceptor[] | undefined,
  perCall: readonly GrpcInterceptor[] | undefined
): GrpcInterceptor[] {
  const out: GrpcInterceptor[] = [];
  if (channel && channel.length > 0) {
    out.push(...channel);
  }
  if (perCall && perCall.length > 0) {
    out.push(...perCall);
  }
  return out;
}

export async function runOnStart(
  interceptors: readonly GrpcInterceptor[],
  start: GrpcInterceptStart
): Promise<GrpcInterceptStart> {
  let current = start;
  for (const interceptor of interceptors) {
    if (!interceptor.onStart) {
      continue;
    }
    const result = await interceptor.onStart(current);
    if (result !== undefined) {
      current = result;
    }
  }
  return current;
}

export async function runOnSendMessage(
  interceptors: readonly GrpcInterceptor[],
  message: Uint8Array,
  method: string
): Promise<Uint8Array> {
  let current = message;
  for (const interceptor of interceptors) {
    if (!interceptor.onSendMessage) {
      continue;
    }
    const result = await interceptor.onSendMessage(current, method);
    if (result !== undefined) {
      current = result;
    }
  }
  return current;
}

export function runOnHeaders(
  interceptors: readonly GrpcInterceptor[],
  headers: GrpcMetadata,
  method: string
): GrpcMetadata {
  let current = headers;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const result = interceptors[i].onHeaders?.(current, method);
    if (result !== undefined) {
      current = result;
    }
  }
  return current;
}

export function runOnMessage(
  interceptors: readonly GrpcInterceptor[],
  message: Uint8Array,
  method: string
): Uint8Array {
  let current = message;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const result = interceptors[i].onMessage?.(current, method);
    if (result !== undefined) {
      current = result;
    }
  }
  return current;
}

export function runOnTrailers(
  interceptors: readonly GrpcInterceptor[],
  trailers: GrpcMetadata,
  method: string
): GrpcMetadata {
  let current = trailers;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const result = interceptors[i].onTrailers?.(current, method);
    if (result !== undefined) {
      current = result;
    }
  }
  return current;
}

export function runOnError(
  interceptors: readonly GrpcInterceptor[],
  error: GrpcError,
  method: string
): GrpcError {
  let current: GrpcError | Error = error;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const asGrpc =
      current instanceof GrpcError
        ? current
        : new GrpcError(current.message || String(current));
    const result = interceptors[i].onError?.(asGrpc, method);
    if (result !== undefined) {
      current = result;
    }
  }
  if (current instanceof GrpcError) {
    return current;
  }
  return new GrpcError(current.message || String(current));
}

export function toGrpcError(reason: unknown): GrpcError {
  if (reason instanceof GrpcError) {
    return reason;
  }
  if (reason instanceof Error) {
    return new GrpcError(reason.message);
  }
  return new GrpcError(String(reason));
}
