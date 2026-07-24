import { AbortController } from 'abort-controller';
import { CompletedGrpcStreamingCall, GrpcMetadata, GrpcServerOutputStream, ServerOutputEvent, ServerOutputEventCallback } from './types';
export declare class GrpcServerStreamingCall implements PromiseLike<CompletedGrpcStreamingCall> {
    #private;
    readonly method: string;
    readonly requestHeaders: GrpcMetadata;
    readonly request: Uint8Array;
    readonly headers: Promise<GrpcMetadata>;
    readonly responses: GrpcServerOutputStream;
    readonly trailers: Promise<GrpcMetadata>;
    constructor(method: string, data: Uint8Array, requestHeaders: GrpcMetadata, headers: Promise<GrpcMetadata>, responses: ServerOutputStream, trailers: Promise<GrpcMetadata>, abort: AbortController);
    then<TResult1 = CompletedGrpcStreamingCall, TResult2 = unknown>(onfulfilled?: ((value: CompletedGrpcStreamingCall) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2>;
    cancel(): void;
    private completedPromise;
}
export declare class ServerOutputStream implements GrpcServerOutputStream {
    #private;
    on<T extends ServerOutputEvent>(event: T, callback: ServerOutputEventCallback<T>): () => void;
    notifyData(data: Uint8Array): void;
    notifyComplete(): void;
    noitfyError(reason: any): void;
}
//# sourceMappingURL=server-streaming.d.ts.map