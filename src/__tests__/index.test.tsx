/**
 * Jest tests for GrpcClient with NativeModules.Grpc mocked.
 * Mock must be registered before importing the client (module-level Emitter).
 */

jest.mock('react-native', () => {
  const { mockGrpc, grpcCallListeners } = require('./mockNativeGrpc');
  return {
    Platform: {
      OS: 'ios',
      select: (objs: Record<string, unknown>) => objs.ios,
    },
    NativeModules: {
      Grpc: mockGrpc,
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: (event: string, cb: (e: any) => void) => {
        if (event === 'grpc-call') {
          grpcCallListeners.push(cb);
        }
        return { remove: jest.fn() };
      },
      removeAllListeners: jest.fn((event?: string) => {
        if (event === 'grpc-call' || event === undefined) {
          grpcCallListeners.length = 0;
        }
      }),
    })),
  };
});

import { fromByteArray } from 'base64-js';
import { emitGrpcCall, mockGrpc } from './mockNativeGrpc';
import { GrpcClient, GrpcError } from '../index';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GrpcClient channel config', () => {
  it('forwards setHost / setInsecure / setCallDeadlineSeconds / initGrpcChannel', () => {
    GrpcClient.setHost('10.0.2.2:50051');
    GrpcClient.setInsecure(true);
    GrpcClient.setCallDeadlineSeconds(120);
    GrpcClient.initGrpcChannel();

    expect(mockGrpc.setHost).toHaveBeenCalledWith('10.0.2.2:50051');
    expect(mockGrpc.setInsecure).toHaveBeenCalledWith(true);
    expect(mockGrpc.setCallDeadlineSeconds).toHaveBeenCalledWith(120);
    expect(mockGrpc.initGrpcChannel).toHaveBeenCalled();
  });

  it('forwards setTlsOptions with replace semantics', () => {
    GrpcClient.setTlsOptions({
      rootCertsPem:
        '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
      certificateChainPem:
        '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
      privateKeyPem:
        '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
      hostNameOverride: 'api.example.com',
    });

    expect(mockGrpc.setTlsOptions).toHaveBeenCalledWith({
      rootCertsPem:
        '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
      certificateChainPem:
        '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
      privateKeyPem:
        '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
      hostNameOverride: 'api.example.com',
    });

    GrpcClient.setTlsOptions({ hostNameOverride: 'other.example.com' });
    expect(mockGrpc.setTlsOptions).toHaveBeenLastCalledWith({
      rootCertsPem: null,
      certificateChainPem: null,
      privateKeyPem: null,
      hostNameOverride: 'other.example.com',
    });
  });

  it('rejects incomplete mTLS pairs in setTlsOptions', () => {
    expect(() =>
      GrpcClient.setTlsOptions({
        certificateChainPem:
          '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
      })
    ).toThrow(/mTLS requires both/);
    expect(mockGrpc.setTlsOptions).not.toHaveBeenCalled();
  });
});

describe('GrpcClient.unaryCall', () => {
  it('encodes request as base64 and resolves on response+trailers', async () => {
    const req = new Uint8Array([1, 2, 3]);
    const resBytes = new Uint8Array([9, 8]);

    const call = GrpcClient.unaryCall('/svc/Method', req, {
      authorization: 'Bearer x',
    });

    expect(mockGrpc.unaryCall).toHaveBeenCalledTimes(1);
    const [id, path, obj, headers] = mockGrpc.unaryCall.mock.calls[0] as any;
    expect(typeof id).toBe('number');
    expect(path).toBe('/svc/Method');
    expect(obj.data).toBe(fromByteArray(req));
    expect(obj.deadlineSeconds).toBeUndefined();
    expect(headers).toEqual({ authorization: 'Bearer x' });

    emitGrpcCall({
      id,
      type: 'headers',
      payload: { 'content-type': 'application/grpc' },
    });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(resBytes),
    });
    emitGrpcCall({ id, type: 'trailers', payload: { 'grpc-status': '0' } });

    const completed = await call;
    expect(completed.response).toEqual(resBytes);
    expect(completed.headers).toEqual({
      'content-type': 'application/grpc',
    });
    expect(completed.trailers).toEqual({ 'grpc-status': '0' });
    expect(completed.status).toBe(0);
  });

  it('passes deadlineSeconds in the request object when set', async () => {
    const call = GrpcClient.unaryCall(
      '/svc/Slow',
      new Uint8Array([0]),
      undefined,
      { deadlineSeconds: 45 }
    );
    const [id, , obj] = mockGrpc.unaryCall.mock.calls[0] as any;
    expect(obj.deadlineSeconds).toBe(45);

    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });
    await call;
  });

  it('rejects with GrpcError on native error event', async () => {
    const call = GrpcClient.unaryCall('/svc/Fail', new Uint8Array([0]));
    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;

    emitGrpcCall({
      id,
      type: 'error',
      error: 'DEADLINE_EXCEEDED',
      code: 4,
      trailers: { 'grpc-status': '4' },
    });

    await expect(call).rejects.toBeInstanceOf(GrpcError);
    await expect(call).rejects.toMatchObject({
      error: 'DEADLINE_EXCEEDED',
      code: 4,
    });
  });

  it('calls cancelGrpcCall when the unary call is cancelled', async () => {
    const call = GrpcClient.unaryCall('/svc/Cancel', new Uint8Array([0]));
    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;

    call.cancel();
    await Promise.resolve();
    expect(mockGrpc.cancelGrpcCall).toHaveBeenCalledWith(id);
  });
});

describe('GrpcClient.serverStreamCall', () => {
  it('delivers multiple response chunks then completes', async () => {
    const chunks: Uint8Array[] = [];
    const call = GrpcClient.serverStreamCall(
      '/svc/Stream',
      new Uint8Array([7]),
      {},
      { deadlineSeconds: 30 }
    );
    const [id, , obj] = mockGrpc.serverStreamingCall.mock.calls[0] as any;
    expect(obj.deadlineSeconds).toBe(30);

    call.responses.on('data', (d) => chunks.push(d));

    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1])),
    });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([2])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });

    await call;
    expect(chunks).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
  });
});

describe('GrpcClient.clientStreamCall', () => {
  it('sends chunks with headers/deadline on first send, then finishes', async () => {
    const call = GrpcClient.clientStreamCall(
      '/svc/ClientStream',
      { authorization: 'Bearer y' },
      { deadlineSeconds: 60 }
    );

    await call.requests.send(new Uint8Array([1, 2]));
    expect(mockGrpc.clientStreamingCall).toHaveBeenCalledTimes(1);
    const [id, path, obj1, headers1] = mockGrpc.clientStreamingCall.mock
      .calls[0] as any;
    expect(path).toBe('/svc/ClientStream');
    expect(obj1.data).toBe(fromByteArray(new Uint8Array([1, 2])));
    expect(obj1.deadlineSeconds).toBe(60);
    expect(headers1).toEqual({ authorization: 'Bearer y' });

    await call.requests.send(new Uint8Array([3]));
    expect(mockGrpc.clientStreamingCall).toHaveBeenCalledTimes(2);
    const [id2, , obj2, headers2] = mockGrpc.clientStreamingCall.mock
      .calls[1] as any;
    expect(id2).toBe(id);
    expect(obj2.data).toBe(fromByteArray(new Uint8Array([3])));
    expect(obj2.deadlineSeconds).toBeUndefined();
    expect(headers2).toEqual({});

    await call.requests.complete();
    expect(mockGrpc.finishClientStreaming).toHaveBeenCalledWith(id);

    const resBytes = new Uint8Array([9]);
    emitGrpcCall({ id, type: 'headers', payload: { ok: '1' } });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(resBytes),
    });
    emitGrpcCall({ id, type: 'trailers', payload: { 'grpc-status': '0' } });

    const completed = await call;
    expect(completed.response).toEqual(resBytes);
    expect(completed.headers).toEqual({ ok: '1' });
    expect(completed.status).toBe(0);
  });

  it('rejects with GrpcError on native error event', async () => {
    const call = GrpcClient.clientStreamCall('/svc/FailStream');
    await call.requests.send(new Uint8Array([0]));
    const [id] = mockGrpc.clientStreamingCall.mock.calls[0] as any;

    emitGrpcCall({
      id,
      type: 'error',
      error: 'INTERNAL',
      code: 13,
    });

    await expect(call).rejects.toBeInstanceOf(GrpcError);
    await expect(call).rejects.toMatchObject({ error: 'INTERNAL', code: 13 });
  });

  it('calls cancelGrpcCall when cancelled', async () => {
    const call = GrpcClient.clientStreamCall('/svc/CancelStream');
    await call.requests.send(new Uint8Array([0]));
    const [id] = mockGrpc.clientStreamingCall.mock.calls[0] as any;

    call.cancel();
    await Promise.resolve();
    expect(mockGrpc.cancelGrpcCall).toHaveBeenCalledWith(id);
  });
});

describe('GrpcClient.bidiStreamCall', () => {
  it('sends/receives chunks, completes, and awaits trailers', async () => {
    const call = GrpcClient.bidiStreamCall(
      '/svc/Bidi',
      { authorization: 'Bearer z' },
      { deadlineSeconds: 45 }
    );

    const chunks: Uint8Array[] = [];
    call.responses.on('data', (chunk) => {
      chunks.push(chunk);
    });

    await call.requests.send(new Uint8Array([1, 2]));
    expect(mockGrpc.bidiStreamingCall).toHaveBeenCalledTimes(1);
    const [id, path, obj1, headers1] = mockGrpc.bidiStreamingCall.mock
      .calls[0] as any;
    expect(path).toBe('/svc/Bidi');
    expect(obj1.data).toBe(fromByteArray(new Uint8Array([1, 2])));
    expect(obj1.deadlineSeconds).toBe(45);
    expect(headers1).toEqual({ authorization: 'Bearer z' });

    await call.requests.send(new Uint8Array([3]));
    expect(mockGrpc.bidiStreamingCall).toHaveBeenCalledTimes(2);
    const [id2, , obj2, headers2] = mockGrpc.bidiStreamingCall.mock
      .calls[1] as any;
    expect(id2).toBe(id);
    expect(obj2.data).toBe(fromByteArray(new Uint8Array([3])));
    expect(obj2.deadlineSeconds).toBeUndefined();
    expect(headers2).toEqual({});

    emitGrpcCall({ id, type: 'headers', payload: { ok: '1' } });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([10])),
    });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([11, 12])),
    });

    expect(chunks).toEqual([new Uint8Array([10]), new Uint8Array([11, 12])]);

    await call.requests.complete();
    expect(mockGrpc.finishClientStreaming).toHaveBeenCalledWith(id);

    emitGrpcCall({ id, type: 'trailers', payload: { 'grpc-status': '0' } });

    const completed = await call;
    expect(completed.headers).toEqual({ ok: '1' });
    expect(completed.trailers).toEqual({ 'grpc-status': '0' });
    expect(completed.responses).toBe(call.responses);
    expect(completed.status).toBe(0);
  });

  it('rejects with GrpcError on native error event', async () => {
    const call = GrpcClient.bidiStreamCall('/svc/FailBidi');
    await call.requests.send(new Uint8Array([0]));
    const [id] = mockGrpc.bidiStreamingCall.mock.calls[0] as any;

    const errors: unknown[] = [];
    call.responses.on('error', (err) => {
      errors.push(err);
    });

    emitGrpcCall({
      id,
      type: 'error',
      error: 'INTERNAL',
      code: 13,
    });

    await expect(call).rejects.toBeInstanceOf(GrpcError);
    await expect(call).rejects.toMatchObject({ error: 'INTERNAL', code: 13 });
    expect(errors[0]).toBeInstanceOf(GrpcError);
  });

  it('calls cancelGrpcCall when cancelled', async () => {
    const call = GrpcClient.bidiStreamCall('/svc/CancelBidi');
    await call.requests.send(new Uint8Array([0]));
    const [id] = mockGrpc.bidiStreamingCall.mock.calls[0] as any;

    call.cancel();
    await Promise.resolve();
    expect(mockGrpc.cancelGrpcCall).toHaveBeenCalledWith(id);
  });
});
