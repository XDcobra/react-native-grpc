export type GrpcMetadata = Record<string, string>;

/** Options for unary / streaming RPCs. */
export type GrpcCallOptions = {
  /**
   * Per-call deadline in seconds. Overrides the global
   * `setCallDeadlineSeconds` default for this RPC only.
   * `0` = no deadline (Android); iOS still applies a positive timeout when set.
   */
  deadlineSeconds?: number;
};

/**
 * Channel TLS configuration. Each `setTlsOptions` call **replaces** the prior
 * config (omitted / null / undefined fields are cleared). Call before
 * `initGrpcChannel()`. Ignored while `setInsecure(true)`.
 * Prefer binding TLS at `createChannel({ tls })` for multi-host apps.
 */
export type GrpcTlsOptions = {
  /** PEM trust roots (one or more certs). Clears → platform/gRPC defaults. */
  rootCertsPem?: string | null;
  /** PEM client certificate chain for mTLS (requires `privateKeyPem`). */
  certificateChainPem?: string | null;
  /** PEM client private key for mTLS (requires `certificateChainPem`). */
  privateKeyPem?: string | null;
  /** Hostname for TLS verification / SNI (e.g. dial by IP). */
  hostNameOverride?: string | null;
  /**
   * SHA-256 SPKI pins (standard base64). Optional `sha256/` prefix allowed
   * (OkHttp style). At least one certificate in the server chain must match.
   * Android: enforced at handshake (system or custom trust + pin).
   * iOS: requires `rootCertsPem` containing a matching cert (gRPC ObjC has no
   * SPKI verify hook); those PEMs become the trust roots.
   */
  spkiSha256Pins?: string[] | null;
};

/** Immutable config for {@link createChannel}. Reconfigure by creating a new channel. */
export type GrpcChannelConfig = {
  /** Target host, e.g. `api.example.com:443` or `10.0.2.2:50051`. */
  host: string;
  /** Plaintext (dev). Default `false`. */
  insecure?: boolean;
  /** TLS options (ignored when `insecure` is true). */
  tls?: GrpcTlsOptions;
  /** Default per-call deadline in seconds. Default 120. */
  callDeadlineSeconds?: number;
  /** Max inbound message size in bytes (Android / iOS). */
  responseSizeLimit?: number;
  /** Message compression. */
  compression?: {
    enable: boolean;
    compressorName: string;
  };
  /** HTTP/2 keepalive (Android primarily). */
  keepAlive?: {
    enable: boolean;
    keepAliveTime: number;
    keepAliveTimeOut: number;
  };
};

/** Id of the singleton / legacy channel used by `GrpcClient` setters. */
export const DEFAULT_CHANNEL_ID = 'default';

export type RemoveListener = () => void;

export interface GrpcServerInputStream {
  send(data: Uint8Array): Promise<void>;
  complete(): Promise<void>;
}

export type DataCallback = (data: Uint8Array) => void;
export type ErrorCallback = (reason: any) => void;
export type CompleteCallback = () => void;

export type ServerOutputEvent = 'data' | 'error' | 'complete';
export type ServerOutputEventCallback<T> = T extends 'data'
  ? DataCallback
  : T extends 'complete'
  ? CompleteCallback
  : T extends 'error'
  ? ErrorCallback
  : never;

export interface GrpcServerOutputStream {
  on<T extends ServerOutputEvent>(
    event: T,
    callback: ServerOutputEventCallback<T>
  ): RemoveListener;
}

export type GrpcUnaryResponse = {
  data: Uint8Array;
  headers: GrpcMetadata;
};

export type CompletedGrpcUnaryCall = {
  readonly method: string;
  readonly requestHeaders: GrpcMetadata;
  readonly request: Uint8Array;
  readonly headers?: GrpcMetadata;
  readonly response?: Uint8Array;
  readonly status?: number;
  readonly trailers?: GrpcMetadata;
};

export type CompletedGrpcStreamingCall = {
  readonly method: string;
  readonly requestHeaders: GrpcMetadata;
  readonly request: Uint8Array;
  readonly headers?: GrpcMetadata;
  readonly responses?: GrpcServerOutputStream;
  readonly status?: number;
  readonly trailers?: GrpcMetadata;
};

/** Completed client-streaming RPC (many request messages, one response). */
export type CompletedGrpcClientStreamingCall = {
  readonly method: string;
  readonly requestHeaders: GrpcMetadata;
  readonly headers?: GrpcMetadata;
  readonly response?: Uint8Array;
  readonly status?: number;
  readonly trailers?: GrpcMetadata;
};

/** Completed bidirectional streaming RPC (many requests, many responses). */
export type CompletedGrpcBidiStreamingCall = {
  readonly method: string;
  readonly requestHeaders: GrpcMetadata;
  readonly headers?: GrpcMetadata;
  readonly responses?: GrpcServerOutputStream;
  readonly status?: number;
  readonly trailers?: GrpcMetadata;
};
