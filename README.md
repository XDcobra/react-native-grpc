# @xdcobra/react-native-grpc

Fork of [`@krishnafkh/react-native-grpc`](https://github.com/krishnafkh/react-native-grpc)
(itself based on [Mitch528/react-native-grpc](https://github.com/Mitch528/react-native-grpc)).

## Changes vs upstream

- Removed deprecated `jcenter()` (required for modern AGP / RN 0.86+)
- Android `namespace 'com.reactnativegrpc'` (no `package` in AndroidManifest)
- `minSdkVersion` 24
- Builds and runs with React Native New Architecture (Native Module interop)
- Per-call deadline via `setCallDeadlineSeconds` (native default 120s)
- Explicit `base64-js` dependency
- Prebuilt `lib/` included so install does not require `react-native-builder-bob`

## Installation

```sh
npm install @xdcobra/react-native-grpc
# or
npm install git+https://github.com/XDcobra/react-native-grpc.git
```

## Usage

```ts
import { GrpcClient, GrpcMetadata } from '@xdcobra/react-native-grpc';

GrpcClient.setHost('192.168.1.10:50051');
GrpcClient.setInsecure(true); // plaintext gRPC
GrpcClient.initGrpcChannel();

const { response } = await GrpcClient.unaryCall(
  '/package.Service/Method',
  requestBytes,
  headers
);
```

Unary and server streaming. Protobuf encode/decode is BYO (e.g. `@bufbuild/protobuf`).

## TODOs

Gaps vs a full gRPC client (not yet supported or not exposed):

- **Client streaming** — native hooks exist; no public JS API on `GrpcClient`
- **Bidirectional streaming** — not implemented
- **Per-call deadlines / timeouts** — `setCallDeadlineSeconds` (default 120s); not yet exposed per individual RPC
- **TLS options** — plaintext vs default TLS only; no custom CA, client certs, or mTLS
- **Multiple channels / hosts** — single global host; no concurrent channels
- **Interceptors** — no request/response middleware
- **Retry / hedging** — no client-side retry policy
- **Cross-platform connection events** — Android-only (`onConnectionStateChange`, `enterIdle`, …)
- **Codegen / stubs** — raw method paths + bytes; no generated service clients

## License

MIT (same as upstream).
