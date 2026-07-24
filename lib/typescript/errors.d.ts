import { GrpcMetadata } from './types';
export declare class GrpcError extends Error {
    error: string;
    code?: number | undefined;
    trailers?: GrpcMetadata | undefined;
    constructor(error: string, code?: number | undefined, trailers?: GrpcMetadata | undefined);
}
//# sourceMappingURL=errors.d.ts.map