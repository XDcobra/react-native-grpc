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
