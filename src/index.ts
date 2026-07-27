import { GrpcClient as GrpcClientImpl } from './client';

const GrpcClient = new GrpcClientImpl();

export * from './types';
export * from './unary';
export * from './server-streaming';
export * from './client-streaming';
export * from './bidi-streaming';
export * from './errors';
export { createChannel, GrpcChannel } from './channel';
export type { GrpcInterceptStart, GrpcInterceptor } from './interceptors';
export type { GrpcHedgingPolicy, GrpcRetryPolicy } from './retry';
export { GrpcStatusCode } from './status';
export {
  createClient,
  type BidiStreamingCall,
  type BidiStreamingMethod,
  type Client,
  type ClientStreamingCall,
  type ClientStreamingMethod,
  type GrpcTransport,
  type ServerStreamingCall,
  type ServerStreamingMethod,
  type TypedServerOutputStream,
  type UnaryMethod,
} from './create-client';
export { GrpcClient };
