/**
 * Jest tests for createClient (Protobuf-ES GenService → GrpcCallApi).
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

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { fromByteArray } from 'base64-js';
import {
  ExampleMessageSchema,
  ExampleRequestSchema,
  Examples,
} from '../__fixtures__/example_pb';
import { createClient, GrpcClient } from '../index';
import { emitGrpcCall, mockChannels, mockGrpc } from './mockNativeGrpc';

async function flushNativeStart() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockChannels.clear();
  GrpcClient.setInterceptors([]);
  GrpcClient.setRetryPolicy(null);
  GrpcClient.setHedgingPolicy(null);
});

describe('createClient', () => {
  it('maps unary path and encodes/decodes protobuf messages', async () => {
    const client = createClient(Examples, GrpcClient);
    const request = create(ExampleRequestSchema, { message: 'ping' });

    const resultPromise = client.sendExampleMessage(request, {
      authorization: 'Bearer t',
    });

    await flushNativeStart();

    expect(mockGrpc.unaryCall).toHaveBeenCalledTimes(1);
    const [id, method, obj, headers, channelId] = (
      mockGrpc.unaryCall as jest.Mock
    ).mock.calls[0];

    expect(method).toBe('/example.grpc.service.Examples/SendExampleMessage');
    expect(channelId).toBe('default');
    expect(headers).toEqual({ authorization: 'Bearer t' });

    const decodedRequest = fromBinary(
      ExampleRequestSchema,
      Buffer.from(obj.data, 'base64')
    );
    expect(decodedRequest.message).toBe('ping');

    const responseBytes = toBinary(
      ExampleMessageSchema,
      create(ExampleMessageSchema, { message: 'pong' })
    );

    emitGrpcCall({
      id,
      type: 'headers',
      payload: {},
    });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(responseBytes),
    });
    emitGrpcCall({
      id,
      type: 'trailers',
      payload: {},
    });

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ message: 'pong' })
    );
  });

  it('maps server streaming path and yields decoded messages', async () => {
    const client = createClient(Examples, GrpcClient);
    const request = create(ExampleRequestSchema, { message: 'stream' });

    const call = client.getExampleMessages(request);
    const messagesPromise = (async () => {
      const messages: string[] = [];
      for await (const msg of call) {
        messages.push(msg.message);
      }
      return messages;
    })();

    await flushNativeStart();

    expect(mockGrpc.serverStreamingCall).toHaveBeenCalledTimes(1);
    const [id, method, obj] = (mockGrpc.serverStreamingCall as jest.Mock).mock
      .calls[0];

    expect(method).toBe('/example.grpc.service.Examples/GetExampleMessages');
    expect(
      fromBinary(ExampleRequestSchema, Buffer.from(obj.data, 'base64')).message
    ).toBe('stream');

    const chunk = toBinary(
      ExampleMessageSchema,
      create(ExampleMessageSchema, { message: 'chunk-1' })
    );

    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(chunk),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });

    await expect(messagesPromise).resolves.toEqual(['chunk-1']);
  });

  it('maps client streaming send/complete with decoded response', async () => {
    const client = createClient(Examples, GrpcClient);
    const call = client.uploadMessages();

    await call.send(create(ExampleRequestSchema, { message: 'a' }));
    await flushNativeStart();

    expect(mockGrpc.clientStreamingCall).toHaveBeenCalledTimes(1);
    const [id, method] = (mockGrpc.clientStreamingCall as jest.Mock).mock
      .calls[0];
    expect(method).toBe('/example.grpc.service.Examples/UploadMessages');

    await call.complete();
    expect(mockGrpc.finishClientStreaming).toHaveBeenCalledWith(id);

    const responseBytes = toBinary(
      ExampleMessageSchema,
      create(ExampleMessageSchema, { message: 'uploaded' })
    );
    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(responseBytes),
    });
    emitGrpcCall({ id, type: 'trailers', payload: {} });

    await expect(call.response).resolves.toEqual(
      expect.objectContaining({ message: 'uploaded' })
    );
  });

  it('maps bidi streaming path', async () => {
    const client = createClient(Examples, GrpcClient);
    const call = client.chat();

    const firstPromise = new Promise<string>((resolve) => {
      call.responses.on('data', (msg) => resolve(msg.message));
    });

    await call.send(create(ExampleRequestSchema, { message: 'hi' }));
    await flushNativeStart();

    expect(mockGrpc.bidiStreamingCall).toHaveBeenCalledTimes(1);
    const [id, method] = (mockGrpc.bidiStreamingCall as jest.Mock).mock
      .calls[0];
    expect(method).toBe('/example.grpc.service.Examples/Chat');

    const chunk = toBinary(
      ExampleMessageSchema,
      create(ExampleMessageSchema, { message: 'echo' })
    );
    emitGrpcCall({ id, type: 'headers', payload: {} });
    emitGrpcCall({
      id,
      type: 'response',
      payload: fromByteArray(chunk),
    });

    await expect(firstPromise).resolves.toBe('echo');

    await call.complete();
    emitGrpcCall({ id, type: 'trailers', payload: {} });
  });
});
