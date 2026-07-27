# @xdcobra/react-native-grpc

Fork of [`@krishnafkh/react-native-grpc`](https://github.com/krishnafkh/react-native-grpc)
(itself based on [Mitch528/react-native-grpc](https://github.com/Mitch528/react-native-grpc)).

## Changes vs upstream

- Removed deprecated `jcenter()` (required for modern AGP / RN 0.86+)
- Android `namespace 'com.reactnativegrpc'` (no `package` in AndroidManifest)
- `minSdkVersion` 24
- Builds and runs with React Native New Architecture (Native Module interop)
- Per-call deadline via `setCallDeadlineSeconds` (default 120s) and per-RPC `options.deadlineSeconds`
- Client streaming via `GrpcClient.clientStreamCall`
- Bidirectional streaming via `GrpcClient.bidiStreamCall`
- TLS options via `GrpcClient.setTlsOptions` (custom CA, mTLS, hostname override)
- Explicit `base64-js` dependency

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
  rootCertsPem: caPem, // optional
  certificateChainPem: clientCertPem, // mTLS (with privateKeyPem)
  privateKeyPem: clientKeyPem,
  hostNameOverride: 'api.example.com', // optional
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

Unary, server streaming, client streaming, and bidirectional streaming. Protobuf encode/decode is BYO (e.g. `@bufbuild/protobuf`).

### TLS matrix

| Mode | How |
|------|-----|
| Plaintext | `setInsecure(true)` |
| Public CA (e.g. Let's Encrypt) | `setInsecure(false)`, no `setTlsOptions` |
| Custom / private CA | `rootCertsPem` |
| mTLS | `certificateChainPem` + `privateKeyPem` (both required) |
| Dial IP, cert for DNS name | `hostNameOverride` |

PEM values are strings (load from app assets/bundle yourself). Call `setTlsOptions` before `initGrpcChannel()`.

## TODOs

Gaps vs a full gRPC client (not yet supported or not exposed):

- **Multiple channels / hosts** — single global host; no concurrent channels
- **Interceptors** — no request/response middleware
- **Retry / hedging** — no client-side retry policy
- **Cross-platform connection events** — Android-only (`onConnectionStateChange`, `enterIdle`, …)
- **Codegen / stubs** — raw method paths + bytes; no generated service clients
- **Certificate pinning (SPKI/hash)** — not exposed (use custom CA / platform pinning if needed)


## License

MIT (same as upstream).
