import { NativeModules } from 'react-native';
import { GrpcMetadata } from './types';

export type GrpcRequestObject = {
  data: string;
  /** Optional per-call override; native falls back to channel default when omitted. */
  deadlineSeconds?: number;
};

export type NativeTlsOptions = {
  rootCertsPem: string | null;
  certificateChainPem: string | null;
  privateKeyPem: string | null;
  hostNameOverride: string | null;
  spkiSha256Pins: string[] | null;
};

export type NativeChannelConfig = {
  host: string;
  insecure: boolean;
  tls: NativeTlsOptions | null;
  callDeadlineSeconds: number;
  responseSizeLimit: number | null;
  compressionEnable: boolean;
  compressorName: string;
  keepAliveEnable: boolean;
  keepAliveTime: number;
  keepAliveTimeOut: number;
};

export type GrpcNativeModule = {
  getHost: () => Promise<string>;
  getIsInsecure: () => Promise<boolean>;
  setHost(host: string): void;
  setInsecure(insecure: boolean): void;
  setTlsOptions(options: NativeTlsOptions): void;
  setCompression(enable: boolean, compressorName: string): void;
  setResponseSizeLimit(limitInBytes: number): void;
  setCallDeadlineSeconds(seconds: number): void;
  initGrpcChannel(): void;
  createChannel(channelId: string, config: NativeChannelConfig): void;
  closeChannel(channelId: string): void;
  unaryCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders: GrpcMetadata,
    channelId: string
  ): Promise<void>;
  serverStreamingCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders: GrpcMetadata,
    channelId: string
  ): Promise<void>;
  cancelGrpcCall: (id: number) => Promise<boolean>;
  clientStreamingCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders: GrpcMetadata,
    channelId: string
  ): Promise<void>;
  bidiStreamingCall(
    id: number,
    path: string,
    obj: GrpcRequestObject,
    requestHeaders: GrpcMetadata,
    channelId: string
  ): Promise<void>;
  finishClientStreaming(id: number): Promise<void>;
  resetConnection(message: string): void;
  setKeepAlive(
    enable: boolean,
    keepAliveTime: number,
    keepAliveTimeOut: number
  ): void;
  onConnectionStateChange(): void;
  setUiLogEnabled(enable: boolean): void;
  enterIdle(): void;
};

/** Lazy binding to NativeModules.Grpc (works with Jest mocks / late link). */
export function nativeGrpc(): GrpcNativeModule {
  const grpc = (NativeModules as { Grpc: GrpcNativeModule }).Grpc;
  if (!grpc) {
    throw new Error('NativeModules.Grpc is not linked');
  }
  return grpc;
}

export const Grpc: GrpcNativeModule = new Proxy({} as GrpcNativeModule, {
  get(_target, prop) {
    const native = nativeGrpc();
    const value = (native as any)[prop as string];
    return typeof value === 'function' ? value.bind(native) : value;
  },
});
