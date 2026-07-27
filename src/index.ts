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
export { GrpcClient };
