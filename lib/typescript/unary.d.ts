import { AbortController } from 'abort-controller';
import { CompletedGrpcUnaryCall, GrpcMetadata } from './types';
export declare class GrpcUnaryCall implements PromiseLike<CompletedGrpcUnaryCall> {
    #private;
    readonly method: string;
    readonly requestHeaders: GrpcMetadata;
    readonly request: Uint8Array;
    readonly headers: Promise<GrpcMetadata>;
    readonly response: Promise<Uint8Array>;
    readonly trailers: Promise<GrpcMetadata>;
    constructor(method: string, data: Uint8Array, requestHeaders: GrpcMetadata, headers: Promise<GrpcMetadata>, response: Promise<Uint8Array>, trailers: Promise<GrpcMetadata>, abort: AbortController);
    then<TResult1 = CompletedGrpcUnaryCall, TResult2 = unknown>(onfulfilled?: ((value: CompletedGrpcUnaryCall) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2>;
    cancel(): void;
    private completedPromise;
}
//# sourceMappingURL=unary.d.ts.map