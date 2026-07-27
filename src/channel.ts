import { GrpcCallApi, normalizeTlsOptions } from './client';
import type { GrpcInterceptor } from './interceptors';
import { nativeGrpc } from './native';
import {
  assertExclusivePolicies,
  normalizeHedgingPolicy,
  normalizeRetryPolicy,
} from './retry';
import { GrpcChannelConfig } from './types';

let channelCtr = 1;

/**
 * Independent gRPC channel bound to a host (and optional TLS / deadline / keepalive).
 * Create via {@link createChannel}; close when finished. Concurrent channels are supported.
 */
export class GrpcChannel extends GrpcCallApi {
  private closed = false;

  constructor(
    channelId: string,
    private readonly host: string,
    interceptors: readonly GrpcInterceptor[] = [],
    channelDeadlineSeconds = 120,
    channelRetry: import('./retry').GrpcRetryPolicy | null = null,
    channelHedging: import('./retry').GrpcHedgingPolicy | null = null
  ) {
    super(
      channelId,
      interceptors,
      channelDeadlineSeconds,
      channelRetry,
      channelHedging
    );
  }

  /** Host this channel was created with. */
  getHost(): Promise<string> {
    return Promise.resolve(this.host);
  }

  /** Native channel id (for diagnostics). */
  getChannelId(): string {
    return this.channelId;
  }

  /**
   * Tear down this channel. Further RPCs will fail.
   * Does not affect the singleton `GrpcClient` default channel.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    nativeGrpc().closeChannel(this.channelId);
  }
}

/**
 * Create a concurrent channel with immutable config.
 * Prefer this over mutating `GrpcClient.setHost` when talking to multiple hosts.
 */
export function createChannel(config: GrpcChannelConfig): GrpcChannel {
  if (!config?.host || typeof config.host !== 'string' || !config.host.trim()) {
    throw new Error('createChannel requires a non-empty host');
  }

  assertExclusivePolicies(config.retry, config.hedging);
  if (config.retry) {
    normalizeRetryPolicy(config.retry);
  }
  if (config.hedging) {
    normalizeHedgingPolicy(config.hedging);
  }
  const retry = config.retry ?? null;
  const hedging = config.hedging ?? null;

  const tls = config.tls ? normalizeTlsOptions(config.tls) : null;
  const channelId = `ch_${channelCtr++}`;
  const compression = config.compression;
  const keepAlive = config.keepAlive;
  const deadline =
    config.callDeadlineSeconds !== undefined
      ? Math.max(0, config.callDeadlineSeconds)
      : 120;

  nativeGrpc().createChannel(channelId, {
    host: config.host.trim(),
    insecure: !!config.insecure,
    tls,
    callDeadlineSeconds: deadline,
    responseSizeLimit:
      config.responseSizeLimit !== undefined ? config.responseSizeLimit : null,
    compressionEnable: !!compression?.enable,
    compressorName: compression?.compressorName ?? '',
    keepAliveEnable: !!keepAlive?.enable,
    keepAliveTime: keepAlive?.keepAliveTime ?? 0,
    keepAliveTimeOut: keepAlive?.keepAliveTimeOut ?? 0,
  });

  return new GrpcChannel(
    channelId,
    config.host.trim(),
    config.interceptors ?? [],
    deadline,
    retry,
    hedging
  );
}
