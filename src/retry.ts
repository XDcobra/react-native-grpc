import { parseStatusCodeList } from './status';

/** A6-style retry policy (unary only in this client). */
export type GrpcRetryPolicy = {
  /** Total attempts including the first. Required; clamped to [2, 5]. */
  maxAttempts: number;
  /** Initial backoff, e.g. `"0.1s"` (proto3 Duration JSON). */
  initialBackoff: string;
  maxBackoff: string;
  backoffMultiplier: number;
  /** Status codes that trigger another attempt (names or numbers). */
  retryableStatusCodes: Array<string | number>;
};

/** A6-style hedging policy (unary only in this client). */
export type GrpcHedgingPolicy = {
  /** Total parallel attempts including the first. Required; clamped to [2, 5]. */
  maxAttempts: number;
  /** Delay before next hedge, e.g. `"0.5s"`; omit / `"0s"` = send promptly. */
  hedgingDelay?: string;
  /** Non-fatal codes: continue hedging; other errors cancel siblings and fail. */
  nonFatalStatusCodes?: Array<string | number>;
};

export type NormalizedRetryPolicy = {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: Set<number>;
};

export type NormalizedHedgingPolicy = {
  maxAttempts: number;
  hedgingDelayMs: number;
  nonFatalStatusCodes: Set<number>;
};

export type EffectiveCallPolicy =
  | { kind: 'none' }
  | { kind: 'retry'; policy: NormalizedRetryPolicy }
  | { kind: 'hedging'; policy: NormalizedHedgingPolicy };

const MAX_ATTEMPTS_CAP = 5;

/** Parse proto3 JSON Duration (`"0.1s"`, `"100ms"`, `"1s"`) to milliseconds. */
export function parseDurationMs(value: string): number {
  const raw = String(value).trim();
  const match = /^(-?\d+(?:\.\d+)?)(ms|s)$/i.exec(raw);
  if (!match) {
    throw new Error(
      `Invalid duration "${value}" (expected proto3 JSON like "0.1s" or "100ms")`
    );
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid duration "${value}"`);
  }
  const unit = match[2].toLowerCase();
  return unit === 'ms' ? amount : amount * 1000;
}

function clampAttempts(maxAttempts: number): number {
  if (!Number.isFinite(maxAttempts) || maxAttempts < 2) {
    throw new Error('maxAttempts must be >= 2');
  }
  return Math.min(MAX_ATTEMPTS_CAP, Math.floor(maxAttempts));
}

export function normalizeRetryPolicy(
  policy: GrpcRetryPolicy
): NormalizedRetryPolicy {
  if (!policy.retryableStatusCodes?.length) {
    throw new Error('retryableStatusCodes must be non-empty');
  }
  if (
    !Number.isFinite(policy.backoffMultiplier) ||
    policy.backoffMultiplier <= 0
  ) {
    throw new Error('backoffMultiplier must be > 0');
  }
  return {
    maxAttempts: clampAttempts(policy.maxAttempts),
    initialBackoffMs: parseDurationMs(policy.initialBackoff),
    maxBackoffMs: parseDurationMs(policy.maxBackoff),
    backoffMultiplier: policy.backoffMultiplier,
    retryableStatusCodes: parseStatusCodeList(policy.retryableStatusCodes),
  };
}

export function normalizeHedgingPolicy(
  policy: GrpcHedgingPolicy
): NormalizedHedgingPolicy {
  return {
    maxAttempts: clampAttempts(policy.maxAttempts),
    hedgingDelayMs: policy.hedgingDelay
      ? parseDurationMs(policy.hedgingDelay)
      : 0,
    nonFatalStatusCodes: policy.nonFatalStatusCodes?.length
      ? parseStatusCodeList(policy.nonFatalStatusCodes)
      : new Set(),
  };
}

export function assertExclusivePolicies(
  retry?: GrpcRetryPolicy | false | null,
  hedging?: GrpcHedgingPolicy | false | null
): void {
  const hasRetry = retry != null && retry !== false;
  const hasHedging = hedging != null && hedging !== false;
  if (hasRetry && hasHedging) {
    throw new Error(
      'retry and hedging policies are mutually exclusive (gRPC A6)'
    );
  }
}

export function resolveEffectivePolicy(
  channelRetry: GrpcRetryPolicy | null,
  channelHedging: GrpcHedgingPolicy | null,
  callRetry?: GrpcRetryPolicy | false,
  callHedging?: GrpcHedgingPolicy | false
): EffectiveCallPolicy {
  assertExclusivePolicies(callRetry, callHedging);
  assertExclusivePolicies(channelRetry, channelHedging);

  if (typeof callRetry === 'object' && callRetry) {
    return { kind: 'retry', policy: normalizeRetryPolicy(callRetry) };
  }
  if (typeof callHedging === 'object' && callHedging) {
    return { kind: 'hedging', policy: normalizeHedgingPolicy(callHedging) };
  }

  let retry = channelRetry;
  let hedging = channelHedging;
  if (callRetry === false) {
    retry = null;
  }
  if (callHedging === false) {
    hedging = null;
  }

  if (retry) {
    return { kind: 'retry', policy: normalizeRetryPolicy(retry) };
  }
  if (hedging) {
    return { kind: 'hedging', policy: normalizeHedgingPolicy(hedging) };
  }
  return { kind: 'none' };
}

/** A6-style backoff with ±20% jitter. */
export function computeRetryBackoffMs(
  policy: NormalizedRetryPolicy,
  failedAttemptIndex: number,
  random: () => number = Math.random
): number {
  const exp = Math.max(0, failedAttemptIndex - 1);
  const raw = Math.min(
    policy.initialBackoffMs * Math.pow(policy.backoffMultiplier, exp),
    policy.maxBackoffMs
  );
  const jitter = 0.8 + random() * 0.4;
  return Math.max(0, raw * jitter);
}

export function delay(
  ms: number,
  signal?: {
    aborted: boolean;
    addEventListener: Function;
    removeEventListener: Function;
  }
): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

export function remainingDeadlineSeconds(
  deadlineSeconds: number | undefined,
  startedAtMs: number,
  nowMs: number = Date.now()
): number | undefined {
  if (deadlineSeconds === undefined) {
    return undefined;
  }
  if (deadlineSeconds <= 0) {
    return 0;
  }
  const elapsed = (nowMs - startedAtMs) / 1000;
  return Math.max(0, deadlineSeconds - elapsed);
}
