# @xdcobra/react-native-grpc

[![npm version](https://img.shields.io/npm/v/@xdcobra/react-native-grpc.svg)](https://www.npmjs.com/package/@xdcobra/react-native-grpc)
[![Android](https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white)](https://developer.android.com)
[![iOS](https://img.shields.io/badge/platform-iOS-000000?logo=apple&logoColor=white)](https://developer.apple.com/ios)

Fork of [`@krishnafkh/react-native-grpc`](https://github.com/krishnafkh/react-native-grpc)
(itself based on [Mitch528/react-native-grpc](https://github.com/Mitch528/react-native-grpc)).

## Changes vs upstream

- Builds and runs with React Native New Architecture (Native Module interop)
- Android `namespace 'com.reactnativegrpc'` (no `package` in AndroidManifest)
- `minSdkVersion` 24
- Per-call deadline via `setCallDeadlineSeconds` (default 120s) and per-RPC `options.deadlineSeconds`
- Client streaming via `GrpcClient.clientStreamCall`
- Bidirectional streaming via `GrpcClient.bidiStreamCall`
- TLS options via `GrpcClient.setTlsOptions` (custom CA, mTLS, hostname override, SPKI pins)
- Multiple concurrent channels via `createChannel` / `GrpcChannel` (immutable per-channel config)
- Interceptors via `createChannel({ interceptors })` / `GrpcClient.setInterceptors` (auth, logging, remapping)
- Unary retry / hedging via `createChannel({ retry | hedging })` / `GrpcClient.setRetryPolicy` / `setHedgingPolicy` ([gRFC A6](https://github.com/grpc/proposal/blob/master/A6-client-retries.md)-style)
- Typed clients via Protobuf-ES `createClient` (Buf + `protoc-gen-es`)

## Installation

```sh
npm install @xdcobra/react-native-grpc
# Typed clients (optional peer):
npm install @bufbuild/protobuf
# or
npm install git+https://github.com/XDcobra/react-native-grpc.git
```

## Usage

```ts
import { GrpcClient, GrpcMetadata } from '@xdcobra/react-native-grpc';

GrpcClient.setHost('api.example.com:443');
GrpcClient.setInsecure(false); // TLS (system / gRPC default roots)
GrpcClient.setCallDeadlineSeconds(120); // global default
GrpcClient.initGrpcChannel();

// Plaintext (dev only)
// GrpcClient.setInsecure(true);

// Custom CA and/or mTLS and/or dial-by-IP hostname override
// (each setTlsOptions call replaces the previous TLS config)
GrpcClient.setTlsOptions({
  rootCertsPem: caPem, // optional (required on iOS when using spkiSha256Pins)
  certificateChainPem: clientCertPem, // mTLS (with privateKeyPem)
  privateKeyPem: clientKeyPem,
  hostNameOverride: 'api.example.com', // optional
  spkiSha256Pins: ['sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
});
GrpcClient.initGrpcChannel();

const { response } = await GrpcClient.unaryCall(
  '/package.Service/Method',
  requestBytes,
  headers,
  { deadlineSeconds: 60 } // optional per-RPC override
);

// Client streaming: many request chunks, one response
const stream = GrpcClient.clientStreamCall('/package.Service/Upload', headers);
await stream.requests.send(chunk1);
await stream.requests.send(chunk2);
await stream.requests.complete();
const { response: uploadResponse } = await stream;

// Bidirectional streaming: interleaved requests and responses
const bidi = GrpcClient.bidiStreamCall('/package.Service/Chat', headers, {
  deadlineSeconds: 60,
});
bidi.responses.on('data', (chunk) => {
  /* handle server message */
});
await bidi.requests.send(chunk1);
await bidi.requests.send(chunk2);
await bidi.requests.complete(); // half-close outbound
const done = await bidi; // resolves on trailers
```

### Typed clients (Buf + createClient)

Generate messages **and** `GenService` schemas with Buf + `@bufbuild/protoc-gen-es` (no custom plugin). Then call `createClient(service, GrpcClient | channel)`.

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-es
    out: src/gen
    opt: target=ts
```

```sh
npm i @bufbuild/protobuf
npm i -D @bufbuild/buf @bufbuild/protoc-gen-es
npx buf generate
```

```ts
import { create } from '@bufbuild/protobuf';
import { createClient, GrpcClient } from '@xdcobra/react-native-grpc';
import { ExampleRequestSchema, Examples } from './gen/example_pb';

GrpcClient.setHost('api.example.com:443');
GrpcClient.initGrpcChannel();

const client = createClient(Examples, GrpcClient);
// or: createClient(Examples, createChannel({ host: '...' }))

const res = await client.sendExampleMessage(
  create(ExampleRequestSchema, { message: 'Ada' }),
  { authorization: 'Bearer …' },
  { deadlineSeconds: 30 }
);
```

| `methodKind` | Client shape |
|---|---|
| `unary` | `Promise<O>` |
| `server_streaming` | async iterable + `.responses` / `.cancel()` |
| `client_streaming` | `{ send(I), complete(), response: Promise<O> }` |
| `bidi_streaming` | `{ send(I), complete(), responses }` (+ async iterable) |

Path form: `/${service.typeName}/${MethodName}` (protobuf RPC name). Raw `unaryCall` / stream APIs remain for BYO bytes.

Subpath import (optional): `import { createClient } from '@xdcobra/react-native-grpc/create-client'`.

### Multiple channels / hosts

Prefer `createChannel` when talking to more than one host (or when you want immutable per-channel TLS/deadline config). The singleton `GrpcClient` path above remains supported for single-host apps.

`createChannel` exposes the same RPC methods as `GrpcClient` (`unaryCall`, `serverStreamCall`, `clientStreamCall`, `bidiStreamCall`). Channel options (`host`, `insecure`, `tls`, deadline, keepalive, compression, response size) are set **once** in the config — there are no `setHost` / `setTlsOptions` mutators on the returned channel; reconfigure by creating a new channel.

```ts
import { createChannel } from '@xdcobra/react-native-grpc';

const primary = createChannel({
  host: 'api.example.com:443',
  insecure: false,
  callDeadlineSeconds: 120,
  tls: {
    rootCertsPem: caPem, // optional (required on iOS when using spkiSha256Pins)
    certificateChainPem: clientCertPem, // mTLS (with privateKeyPem)
    privateKeyPem: clientKeyPem,
    hostNameOverride: 'api.example.com', // optional
    spkiSha256Pins: ['sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
  },
  // optional:
  // responseSizeLimit: 4 * 1024 * 1024,
  // compression: { enable: true, compressorName: 'gzip' },
  // keepAlive: { enable: true, keepAliveTime: 30, keepAliveTimeOut: 10 },
});

const staging = createChannel({
  host: '10.0.2.2:50051',
  insecure: true, // plaintext; `tls` is ignored
});

await primary.unaryCall('/package.Service/Method', requestBytes);
await staging.unaryCall('/package.Service/Method', requestBytes);

primary.close();
staging.close();
```

`tls` uses the same `GrpcTlsOptions` fields as `GrpcClient.setTlsOptions` (see TLS matrix below). `close()` does not affect the singleton default channel.

### Interceptors

`createChannel` accepts the same interceptor hooks as `GrpcClient.setInterceptors` (replace semantics on the singleton). Outbound hooks run index 0→n; inbound hooks run n→0 (onion). Throw from `onStart` to abort before the native call. Per-RPC extras: `options.interceptors` (appended after channel interceptors).

```ts
import { createChannel, GrpcClient, GrpcInterceptor } from '@xdcobra/react-native-grpc';

const auth: GrpcInterceptor = {
  onStart(start) {
    return {
      ...start,
      headers: {
        ...start.headers,
        authorization: 'Bearer <token>',
      },
    };
  },
};

// Multi-host / preferred
const channel = createChannel({
  host: 'api.example.com:443',
  interceptors: [auth],
});

// Singleton
GrpcClient.setInterceptors([auth]);

await channel.unaryCall('/package.Service/Method', requestBytes, {}, {
  interceptors: [
    {
      onError(error) {
        // remap or log
        return error;
      },
    },
  ],
});
```

Hooks: `onStart`, `onSendMessage`, `onHeaders`, `onMessage`, `onTrailers`, `onError`.

### Retry / hedging (unary only)

[gRFC A6](https://github.com/grpc/proposal/blob/master/A6-client-retries.md)-inspired client policies for **unary** RPCs. Retry and hedging are mutually exclusive. Streams ignore these policies. Without a policy there is no automatic retry.

```ts
import {
  createChannel,
  GrpcClient,
  GrpcStatusCode,
} from '@xdcobra/react-native-grpc';

const retry = {
  maxAttempts: 4, // clamped to max 5
  initialBackoff: '0.1s',
  maxBackoff: '1s',
  backoffMultiplier: 2,
  retryableStatusCodes: ['UNAVAILABLE', GrpcStatusCode.RESOURCE_EXHAUSTED],
};

// Preferred multi-host path
const channel = createChannel({
  host: 'api.example.com:443',
  retry,
});

// Singleton
GrpcClient.setRetryPolicy(retry);
// GrpcClient.setHedgingPolicy({ maxAttempts: 3, hedgingDelay: '0.5s', nonFatalStatusCodes: ['UNAVAILABLE'] });

await channel.unaryCall('/package.Service/Method', requestBytes, {}, {
  retry: false, // disable for this call
});
```

Hedging sends parallel attempts (first success wins; siblings are cancelled). Call deadline applies across the whole retry/hedge chain.

Unary, server streaming, client streaming, and bidirectional streaming. Protobuf encode/decode is BYO (e.g. `@bufbuild/protobuf`) or via `createClient`.

### TLS matrix

| Mode | How |
|------|-----|
| Plaintext | `setInsecure(true)` |
| Public CA (e.g. Let's Encrypt) | `setInsecure(false)`, no `setTlsOptions` |
| Custom / private CA | `rootCertsPem` |
| mTLS | `certificateChainPem` + `privateKeyPem` (both required) |
| Dial IP, cert for DNS name | `hostNameOverride` |
| SPKI pin (SHA-256) | `spkiSha256Pins: ['base64…']` (optional `sha256/` prefix) |

PEM values are strings (load from app assets/bundle yourself). On the singleton path, call `setTlsOptions` before `initGrpcChannel()`. With `createChannel`, pass the same fields under `tls` in the config.

**SPKI pins:** at least one cert in the server chain must match. On **Android**, pins work with the system trust store and/or `rootCertsPem`. On **iOS** (gRPC ObjC has no handshake SPKI hook), set `rootCertsPem` to the pinned leaf/intermediate PEM as well. Pins are checked against that PEM at config time, then used as trust roots.

Generate a pin (OpenSSL):

```sh
openssl x509 -in leaf.pem -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

## TODOs

Gaps vs a full gRPC client (not yet supported or not exposed):

- **Retry / hedging — remaining**: DNS/service-config JSON; retry throttling ([gRFC A6](https://github.com/grpc/proposal/blob/master/A6-client-retries.md)); stream retry / transparent retry after first response message; native `enableRetry` / C-core service config (JS unary policies are implemented)
- **Cross-platform connection events**: Android-only (`onConnectionStateChange`, `enterIdle`, …)
- **Codegen — advanced**: no custom `protoc` plugin; Buf + `createClient` covers the typed path (raw bytes remain available)


## License

MIT (same as upstream).
