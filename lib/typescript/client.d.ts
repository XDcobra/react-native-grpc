import { GrpcServerStreamingCall } from './server-streaming';
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
    unaryCall(id: number, path: string, obj: GrpcRequestObject, requestHeaders?: GrpcMetadata): Promise<void>;
    serverStreamingCall(id: number, path: string, obj: GrpcRequestObject, requestHeaders?: GrpcMetadata): Promise<void>;
    cancelGrpcCall: (id: number) => Promise<boolean>;
    clientStreamingCall(id: number, path: string, obj: GrpcRequestObject, requestHeaders?: GrpcMetadata): Promise<void>;
    finishClientStreaming(id: number): Promise<void>;
    resetConnection(message: string): void;
    setKeepAlive(enable: boolean, keepAliveTime: number, keepAliveTimeOut: number): void;
    onConnectionStateChange(): void;
    setUiLogEnabled(enable: boolean): void;
    enterIdle(): void;
};
export declare class GrpcClient {
    constructor();
    destroy(): void;
    getHost(): Promise<string>;
    setHost(host: string): void;
    getInsecure(): Promise<boolean>;
    setInsecure(insecure: boolean): void;
    setCompression(enable: boolean, compressorName: string): void;
    setResponseSizeLimit(limitInBytes: number): void;
    /** Global per-call deadline in seconds (Android/iOS). Default 120. Overridable per RPC via options. */
    setCallDeadlineSeconds(seconds: number): void;
    initGrpcChannel(): void;
    setKeepAlive(enable: boolean, keepAliveTime: number, keepAliveTimeOut: number): void;
    resetConnection(message: string): void;
    setUiLogEnabled(enable: boolean): void;
    onConnectionStateChange(): void;
    enterIdle(): void;
    unaryCall(method: string, data: Uint8Array, requestHeaders?: GrpcMetadata, options?: GrpcCallOptions): GrpcUnaryCall;
    serverStreamCall(method: string, data: Uint8Array, requestHeaders?: GrpcMetadata, options?: GrpcCallOptions): GrpcServerStreamingCall;
    private isAndroid;
}
/** Lazy binding to NativeModules.Grpc (works with Jest mocks / late link). */
export declare const Grpc: GrpcType;
export {};
//# sourceMappingURL=client.d.ts.map