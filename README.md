# @xdcobra/react-native-grpc

Fork of [`@krishnafkh/react-native-grpc`](https://github.com/krishnafkh/react-native-grpc)
(itself based on [Mitch528/react-native-grpc](https://github.com/Mitch528/react-native-grpc)).

## Changes vs upstream

- Removed deprecated `jcenter()` (breaks modern AGP / RN 0.86+)
- Android `namespace 'com.reactnativegrpc'`
- `minSdkVersion` 24
- Package renamed to `@xdcobra/react-native-grpc`
- Explicit `base64-js` dependency (used by the JS client)
- Prebuilt `lib/` committed for `file:` / git consumers without running `bob`

## Local use

```json
"@xdcobra/react-native-grpc": "file:../react-native-grpc"
```

## GitHub / npm

```bash
cd D:\react-native-grpc
git remote add origin git@github.com:XDcobra/react-native-grpc.git
git push -u origin main
# later: npm publish --access public
```

Upstream remote (read-only):

```bash
git remote -v   # upstream → krishnafkh/react-native-grpc
```

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

Unary (+ server streaming upstream). Protobuf encode/decode is BYO (e.g. `@bufbuild/protobuf`).

## License

MIT (same as upstream).
