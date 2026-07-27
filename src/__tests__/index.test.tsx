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
import { emitGrpcCall, mockChannels, mockGrpc } from './mockNativeGrpc';
import {
  createChannel,
  DEFAULT_CHANNEL_ID,
  GrpcClient,
  GrpcError,
  GrpcInterceptor,
} from '../index';

/** Unary/server-stream native start is deferred until interceptor onStart settles. */
async function flushNativeStart() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockChannels.clear();
  GrpcClient.setInterceptors([]);
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
      spkiSha256Pins: [
        'sha256/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd=',
        'plainPin',
      ],
    });

    expect(mockGrpc.setTlsOptions).toHaveBeenCalledWith({
      rootCertsPem:
        '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
      certificateChainPem:
        '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
      privateKeyPem:
        '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
      hostNameOverride: 'api.example.com',
      spkiSha256Pins: [
        'sha256/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd=',
        'plainPin',
      ],
    });

    GrpcClient.setTlsOptions({ hostNameOverride: 'other.example.com' });
    expect(mockGrpc.setTlsOptions).toHaveBeenLastCalledWith({
      rootCertsPem: null,
      certificateChainPem: null,
      privateKeyPem: null,
      hostNameOverride: 'other.example.com',
      spkiSha256Pins: null,
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

describe('createChannel', () => {
  it('requires a non-empty host', () => {
    expect(() => createChannel({ host: '' })).toThrow(/non-empty host/);
    expect(mockGrpc.createChannel).not.toHaveBeenCalled();
  });

  it('creates concurrent channels and passes channelId on RPCs', async () => {
    const a = createChannel({
      host: 'a.example.com:443',
      insecure: false,
      callDeadlineSeconds: 30,
      tls: { hostNameOverride: 'a.example.com' },
    });
    const b = createChannel({ host: 'b.example.com:443', insecure: true });

    expect(mockGrpc.createChannel).toHaveBeenCalledTimes(2);
    const [idA, cfgA] = mockGrpc.createChannel.mock.calls[0] as any;
    const [idB, cfgB] = mockGrpc.createChannel.mock.calls[1] as any;
    expect(idA).toMatch(/^ch_/);
    expect(idB).toMatch(/^ch_/);
    expect(idA).not.toBe(idB);
    expect(cfgA.host).toBe('a.example.com:443');
    expect(cfgA.insecure).toBe(false);
    expect(cfgA.callDeadlineSeconds).toBe(30);
    expect(cfgA.tls.hostNameOverride).toBe('a.example.com');
    expect(cfgB.host).toBe('b.example.com:443');
    expect(cfgB.insecure).toBe(true);
    expect(cfgB.tls).toBeNull();

    expect(await a.getHost()).toBe('a.example.com:443');
    expect(a.getChannelId()).toBe(idA);

    const callA = a.unaryCall('/svc/A', new Uint8Array([1]));
    const callB = b.unaryCall('/svc/B', new Uint8Array([2]));
    await flushNativeStart();
    expect(mockGrpc.unaryCall).toHaveBeenCalledTimes(2);
    const [, , , , channelIdA] = mockGrpc.unaryCall.mock.calls[0] as any;
    const [, , , , channelIdB] = mockGrpc.unaryCall.mock.calls[1] as any;
    expect(channelIdA).toBe(idA);
    expect(channelIdB).toBe(idB);

    const [callIdA] = mockGrpc.unaryCall.mock.calls[0] as any;
    const [callIdB] = mockGrpc.unaryCall.mock.calls[1] as any;
    emitGrpcCall({ id: callIdA, type: 'headers', payload: {} });
    emitGrpcCall({
      id: callIdA,
      type: 'response',
      payload: fromByteArray(new Uint8Array([9])),
    });
    emitGrpcCall({ id: callIdA, type: 'trailers', payload: {} });
    emitGrpcCall({ id: callIdB, type: 'headers', payload: {} });
    emitGrpcCall({
      id: callIdB,
      type: 'response',
      payload: fromByteArray(new Uint8Array([8])),
    });
    emitGrpcCall({ id: callIdB, type: 'trailers', payload: {} });
    await Promise.all([callA, callB]);

    a.close();
    b.close();
    expect(mockGrpc.closeChannel).toHaveBeenCalledWith(idA);
    expect(mockGrpc.closeChannel).toHaveBeenCalledWith(idB);
    a.close();
    expect(mockGrpc.closeChannel).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete mTLS in createChannel tls config', () => {
    expect(() =>
      createChannel({
        host: 'x:443',
        tls: {
          certificateChainPem:
            '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
        },
      })
    ).toThrow(/mTLS requires both/);
    expect(mockGrpc.createChannel).not.toHaveBeenCalled();
  });
});

describe('GrpcClient.unaryCall', () => {
  it('encodes request as base64 and resolves on response+trailers', async () => {
    const req = new Uint8Array([1, 2, 3]);
    const resBytes = new Uint8Array([9, 8]);

    const call = GrpcClient.unaryCall('/svc/Method', req, {
      authorization: 'Bearer x',
    });

    await flushNativeStart();
    expect(mockGrpc.unaryCall).toHaveBeenCalledTimes(1);
    const [id, path, obj, headers, channelId] = mockGrpc.unaryCall.mock
      .calls[0] as any;
    expect(typeof id).toBe('number');
    expect(path).toBe('/svc/Method');
    expect(obj.data).toBe(fromByteArray(req));
    expect(obj.deadlineSeconds).toBeUndefined();
    expect(headers).toEqual({ authorization: 'Bearer x' });
    expect(channelId).toBe(DEFAULT_CHANNEL_ID);

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
    await flushNativeStart();
    const [id, , obj, , channelId] = mockGrpc.unaryCall.mock.calls[0] as any;
    expect(obj.deadlineSeconds).toBe(45);
    expect(channelId).toBe(DEFAULT_CHANNEL_ID);

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
    await flushNativeStart();
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
    await flushNativeStart();
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
    await flushNativeStart();
    const [id, , obj, , channelId] = mockGrpc.serverStreamingCall.mock
      .calls[0] as any;
    expect(obj.deadlineSeconds).toBe(30);
    expect(channelId).toBe(DEFAULT_CHANNEL_ID);

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
    const [id, path, obj1, headers1, channelId] = mockGrpc.clientStreamingCall
      .mock.calls[0] as any;
    expect(path).toBe('/svc/ClientStream');
    expect(obj1.data).toBe(fromByteArray(new Uint8Array([1, 2])));
    expect(obj1.deadlineSeconds).toBe(60);
    expect(headers1).toEqual({ authorization: 'Bearer y' });
    expect(channelId).toBe(DEFAULT_CHANNEL_ID);

    await call.requests.send(new Uint8Array([3]));
    expect(mockGrpc.clientStreamingCall).toHaveBeenCalledTimes(2);
    const [id2, , obj2, headers2, channelId2] = mockGrpc.clientStreamingCall
      .mock.calls[1] as any;
    expect(id2).toBe(id);
    expect(obj2.data).toBe(fromByteArray(new Uint8Array([3])));
    expect(obj2.deadlineSeconds).toBeUndefined();
    expect(headers2).toEqual({});
    expect(channelId2).toBe(DEFAULT_CHANNEL_ID);

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
    const [id, path, obj1, headers1, channelId] = mockGrpc.bidiStreamingCall
      .mock.calls[0] as any;
    expect(path).toBe('/svc/Bidi');
    expect(obj1.data).toBe(fromByteArray(new Uint8Array([1, 2])));
    expect(obj1.deadlineSeconds).toBe(45);
    expect(headers1).toEqual({ authorization: 'Bearer z' });
    expect(channelId).toBe(DEFAULT_CHANNEL_ID);

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

describe('interceptors', () => {
  it('injects auth headers via onStart on the singleton', async () => {
    GrpcClient.setInterceptors([
      {
        onStart(start) {
          return {
            ...start,
            headers: {
              ...start.headers,
              authorization: 'Bearer secret',
            },
          };
        },
      },
    ]);

    const call = GrpcClient.unaryCall('/svc/Auth', new Uint8Array([1]));
    await flushNativeStart();
    const [, , , headers] = mockGrpc.unaryCall.mock.calls[0] as any;
    expect(headers).toEqual({ authorization: 'Bearer secret' });

    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;
    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });
    await call;
  });

  it('runs outbound 0→n and inbound n→0 (onion)', async () => {
    const order: string[] = [];
    const a: GrpcInterceptor = {
      onStart(start) {
        order.push('a-start');
        return start;
      },
      onHeaders(headers) {
        order.push('a-headers');
        return headers;
      },
    };
    const b: GrpcInterceptor = {
      onStart(start) {
        order.push('b-start');
        return start;
      },
      onHeaders(headers) {
        order.push('b-headers');
        return headers;
      },
    };
    GrpcClient.setInterceptors([a, b]);

    const call = GrpcClient.unaryCall('/svc/Onion', new Uint8Array([0]));
    await flushNativeStart();
    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;
    emitGrpcCall({ id, type: 'headers', payload: { x: '1' } });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });
    await call;

    expect(order).toEqual(['a-start', 'b-start', 'b-headers', 'a-headers']);
  });

  it('rewrites inbound messages via onMessage', async () => {
    GrpcClient.setInterceptors([
      {
        onMessage() {
          return new Uint8Array([42]);
        },
      },
    ]);

    const call = GrpcClient.unaryCall('/svc/Rewrite', new Uint8Array([0]));
    await flushNativeStart();
    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;
    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1, 2])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });
    const completed = await call;
    expect(completed.response).toEqual(new Uint8Array([42]));
  });

  it('remaps errors via onError', async () => {
    GrpcClient.setInterceptors([
      {
        onError() {
          return new GrpcError('MAPPED', 16);
        },
      },
    ]);

    const call = GrpcClient.unaryCall('/svc/Err', new Uint8Array([0]));
    await flushNativeStart();
    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;
    emitGrpcCall({
      id,
      type: 'error',
      error: 'INTERNAL',
      code: 13,
    });

    await expect(call).rejects.toMatchObject({ error: 'MAPPED', code: 16 });
  });

  it('aborts before native when onStart throws', async () => {
    GrpcClient.setInterceptors([
      {
        onStart() {
          throw new Error('no token');
        },
      },
    ]);

    const call = GrpcClient.unaryCall('/svc/Abort', new Uint8Array([0]));
    await expect(call).rejects.toBeInstanceOf(GrpcError);
    await expect(call).rejects.toMatchObject({ error: 'no token' });
    expect(mockGrpc.unaryCall).not.toHaveBeenCalled();
  });

  it('appends per-call interceptors after channel interceptors', async () => {
    const order: string[] = [];
    GrpcClient.setInterceptors([
      {
        onStart(start) {
          order.push('channel');
          return start;
        },
      },
    ]);

    const call = GrpcClient.unaryCall(
      '/svc/PerCall',
      new Uint8Array([0]),
      {},
      {
        interceptors: [
          {
            onStart(start) {
              order.push('call');
              return start;
            },
          },
        ],
      }
    );
    await flushNativeStart();
    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;
    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });
    await call;
    expect(order).toEqual(['channel', 'call']);
  });

  it('binds interceptors on createChannel independently of GrpcClient', async () => {
    GrpcClient.setInterceptors([
      {
        onStart(start) {
          return {
            ...start,
            headers: { ...start.headers, from: 'client' },
          };
        },
      },
    ]);

    const channel = createChannel({
      host: 'intercept.example.com:443',
      insecure: true,
      interceptors: [
        {
          onStart(start) {
            return {
              ...start,
              headers: { ...start.headers, from: 'channel' },
            };
          },
        },
      ],
    });

    const call = channel.unaryCall('/svc/Ch', new Uint8Array([0]));
    await flushNativeStart();
    const [, , , headers] = mockGrpc.unaryCall.mock.calls[0] as any;
    expect(headers).toEqual({ from: 'channel' });

    const [id] = mockGrpc.unaryCall.mock.calls[0] as any;
    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(new Uint8Array([1])),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });
    await call;
    channel.close();
  });
});
