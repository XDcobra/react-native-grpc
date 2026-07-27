/** Shared native mock for Jest (required from jest.mock factory). */

export const grpcCallListeners: Array<(event: any) => void> = [];

export const mockGrpc = {
  getHost: jest.fn(async () => 'host:1'),
  getIsInsecure: jest.fn(async () => true),
  setHost: jest.fn(),
  setInsecure: jest.fn(),
  setTlsOptions: jest.fn(),
  setCompression: jest.fn(),
  setResponseSizeLimit: jest.fn(),
  setCallDeadlineSeconds: jest.fn(),
  initGrpcChannel: jest.fn(),
  unaryCall: jest.fn(async () => undefined),
  serverStreamingCall: jest.fn(async () => undefined),
  cancelGrpcCall: jest.fn(async () => true),
  clientStreamingCall: jest.fn(async () => undefined),
  bidiStreamingCall: jest.fn(async () => undefined),
  finishClientStreaming: jest.fn(async () => undefined),
  resetConnection: jest.fn(),
  setKeepAlive: jest.fn(),
  onConnectionStateChange: jest.fn(),
  setUiLogEnabled: jest.fn(),
  enterIdle: jest.fn(),
};

export function emitGrpcCall(event: Record<string, unknown>) {
  [...grpcCallListeners].forEach((cb) => cb(event));
}
