# @xdcobra/react-native-grpc

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

## Installation

```sh
npm install @xdcobra/react-native-grpc
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

Unary, server streaming, client streaming, and bidirectional streaming. Protobuf encode/decode is BYO (e.g. `@bufbuild/protobuf`).

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

- **Interceptors**: no request/response middleware
- **Retry / hedging**: no client-side retry policy
- **Cross-platform connection events**: Android-only (`onConnectionStateChange`, `enterIdle`, …)
- **Codegen / stubs**: raw method paths + bytes; no generated service clients


## License

MIT (same as upstream).
