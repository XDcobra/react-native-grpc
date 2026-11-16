# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-11-16

### Fixed

- Type declarations are emitted to `lib/typescript/` again, where `types` and `exports[*].types` point. In 2.0.0 the new `test/` folder was part of the declaration build, so they ended up in `lib/typescript/src/` and TypeScript consumers found no types. `tsconfig.build.json` now excludes `test`.
- The library uses React Native's global `AbortController` / `AbortSignal` instead of the `abort-controller` package. Metro resolved that package's `browser` entry, which has no named `AbortController` export, so apps needed a resolver override in `metro.config.js`. The `abort-controller` dependency is removed.
- `src/client.ts` typechecks against the event emitter types of current React Native (0.88), which matters for apps whose `tsconfig` resolves the `react-native` export condition (the React Native template does).

### Added

- CI: the dummy app in `build-app.yml` typechecks `test/app/App.tsx` against the packed library (React Native template config, `types` export condition, and node10 resolution), covering the root entry and the `create-client` subpath.
- Jest runs in a Node environment that exposes Node's `AbortController` / `AbortSignal` (`jest/node-environment.js`), as React Native does at runtime.

## [2.0.0] - 2026-11-16

### Changed

- **Breaking:** minimum supported versions are now React Native 0.76 (`peerDependencies` `react-native >=0.76.0`, `react >=18.3.1`) and iOS 15.1 (was 10.0 in the podspec). iOS 15.1 is the minimum of React Native 0.76+ and fits current Xcode.
- Example app upgraded from React Native 0.70.6 to 0.88.1 (native projects regenerated from the current template). It autolinks the library from the repository root and is a development playground only; CI builds a fresh app instead (see `test/README.md`).
- iOS: `gRPC` is limited to `>= 1.84.1, < 1.85.0`. `gRPC-Core 1.85.0` pulls `abseil 1.20260526.0`, whose CocoaPods spec compiles the Windows-only `time_zone_name_win.cc` (`'windows.h' file not found`). To be lifted once fixed upstream.

### Fixed

- iOS: `SpkiPinning.m` no longer uses `SecItemExport` / `kSecFormatOpenSSL`, which exist on macOS only and broke the iOS build. The SPKI pin is now computed from `SecKeyCopyExternalRepresentation` plus the fixed SubjectPublicKeyInfo header (RSA 2048/3072/4096, EC P-256/P-384). Other key types never match a pin. Verified against OpenSSL with `test/native/ios/spki-pin/run.sh`.
- iOS (New Architecture): `getHost` and `getIsInsecure` now declare the reject block that TurboModule promise methods require; without it the module failed to load on React Native 0.88.

### Added

- CI: `build-app.yml` builds the packed library inside a fresh React Native app on Android (ubuntu) and iOS (macOS); native SPKI pin test moved to `test/native/ios/spki-pin/` (`scripts/` removed).

## [1.1.9] - 2026-07-28

### Changed

- Releases now go through staged npm Trusted Publishing (OIDC): CI stages the version tokenlessly with provenance, and a maintainer promotes it to live on npmjs.com with 2FA/passkey. No library or API changes since 1.1.0 (versions 1.1.1–1.1.8 were internal release-pipeline iterations).

## [1.1.0] - 2026-07-28

### Added

- Multiple concurrent channels via `createChannel` / `GrpcChannel` (immutable per-channel host, TLS, deadline, keepalive, compression)
- Interceptors via `createChannel({ interceptors })` / `GrpcClient.setInterceptors` and per-RPC `options.interceptors` (onion chain: onStart, onSendMessage, onHeaders, onMessage, onTrailers, onError)
- Unary retry / hedging via `createChannel({ retry | hedging })`, `GrpcClient.setRetryPolicy` / `setHedgingPolicy`, and per-RPC overrides ([gRFC A6](https://github.com/grpc/proposal/blob/master/A6-client-retries.md)-style; mutually exclusive; `GrpcStatusCode` exported)
- Typed clients via `createClient(service, channel)` for Protobuf-ES `GenService` schemas (peer `@bufbuild/protobuf`; Buf + `protoc-gen-es`; example migrated off `@protobuf-ts`)

## [1.0.0] - 2026-07-27

First public release of `@xdcobra/react-native-grpc` (fork of
`@krishnafkh/react-native-grpc` / Mitch528).

### Added

- Per-call deadline via `setCallDeadlineSeconds` (default 120s) and per-RPC `options.deadlineSeconds`
- Client streaming via `GrpcClient.clientStreamCall`
- Bidirectional streaming via `GrpcClient.bidiStreamCall`
- TLS options via `GrpcClient.setTlsOptions` (custom CA, mTLS, hostname override, SPKI pins)
- Jest coverage for unary, streaming, TLS config, and native mocks
- GitHub Actions CI (lint / test / typescript)

### Changed

- React Native New Architecture compatible (Native Module interop)
- Android `namespace 'com.reactnativegrpc'`; `minSdkVersion` 24
- `lib/` is build output only (`prepare` / `bob build`); not committed
- npm package files whitelist (no IDE junk / example / tests)

### Upstream history

Older entries below are from the upstream project lineage (pre-fork numbering).

## [1.0.5] - 2023-04-12

### Added

LINT FIX

## [1.0.4] - 2023-04-12

### Added

Add option to configure keepalive

## [1.0.3] - 2023-04-12

### Added

Reverted swift dependency for ios pods

## [1.0.0-6] - 2023-01-13

### Added

Add option to configure keepalive

### Improvements

Reuse connection pool on iOS
Use optimal event loop group on iOS dependent on platform support

### Bugfixes

Fix channel on Android not reflecting updated options on change

## [1.0.0-5] - 2023-01-12

### Added

Add option to specify compression limit on iOS

## [1.0.0-4] - 2023-01-11

### Bugfixes

Fix incorrect status code given on iOS on failure

## [1.0.0-3] - 2023-01-11

### Added

Added option to enable gRPC compression

---

Thanks to @krishnafkh for contributing the Android implementation (#5)

## [1.0.0-2] - 2023-01-10

### Bug fixes

Fix passed header value being invalid by unwrapping the `String` on iOS

## [1.0.0-1] - 2022-12-10

### Bugfixes

Fix status code not being included in gRPC error on iOS

## [1.0.0-0] - 2022-12-10

### Breaking

Now using gRPC-Swift on iOS

## [0.1.10] - 2022-09-01

### Improvements

Implemented maximum response size limit for gRPC client on Android

## [0.1.9] - 2022-08-31

### Added

Added option to set the maximum response size limit on the gRPC client.

## [0.1.8] - 2022-08-16

### Bugfixes

Fix error code not being provided on iOS

## [0.1.7] - 2022-08-07

### Bugfixes

Reuse Android ManagedChannel for gRPC calls

## [0.1.6] - 2022-06-09

### Bugfixes

Fix trailers not being sent

## [0.1.5] - 2022-06-01

### Improvements

Add trailers to GrpcError

### Bugfixes

Fix binary data contained within metadata

## [0.1.4] - 2021-06-24

### Breaking

Changed server output stream functions `onData(callback)`, `onFinish(callback)`, `onError(callback)` to `on(type, callback)`

### Improvements

Errors should be more descriptive than 'aborted'.

## [0.1.3] - 2021-06-23

Fix base64 encoding issue on iOS

## [0.1.2] - 2021-06-23

Fix incorrect location of types

## [0.1.1] - 2021-06-23

Initial release

## [0.1.0]

Initial commit
