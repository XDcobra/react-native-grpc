# Tests

| What | Where | Runs on | Catches |
|---|---|---|---|
| JS unit tests (Jest) | `src/__tests__/` | ubuntu (`tests.yml`) | logic errors in the TypeScript layer |
| SPKI pin computation (iOS) | `test/native/ios/spki-pin/` | macOS (`build-app.yml`) | wrong pins; compares `ios/SpkiPinning.m` against OpenSSL for RSA 2048/3072/4096 and EC P-256/P-384 |
| Android build | `test/app/` + `build-app.yml` | ubuntu | Gradle/Java errors when the **packed** library is built inside a fresh React Native app |
| iOS build | `test/app/` + `build-app.yml` | macOS | Objective-C/CocoaPods errors in the same setting |

Lint, typecheck, Jest and `bob build` cannot see native code, so only the two app builds notice
a broken iOS or Android integration.

## Dummy app

`test/app/create-dummy-app.sh <out-dir> [rn-version]` packs the library (`npm pack`, so the `files`
field of `package.json` is tested), creates a fresh React Native app with the community CLI,
installs the tarball, copies `test/app/App.tsx` into it, typechecks it and bundles the JS for both platforms.

The typecheck runs `tsc --noEmit` three times, so a wrong `types` path or a type error in `src/` fails CI:

- with the app's own `tsconfig.json` (the `react-native` export condition, i.e. the shipped `src/*.ts`),
- without custom conditions (the `types` export condition, i.e. `lib/typescript/*.d.ts`, root and `create-client` subpath),
- with `moduleResolution: node10` (the top-level `types` field; `exports` is ignored there).

Then build natively:

```sh
# iOS (macOS only)
cd <out-dir>/GrpcDummy/ios && bundle install && bundle exec pod install
xcodebuild -workspace GrpcDummy.xcworkspace -scheme GrpcDummy -sdk iphonesimulator \
  -configuration Debug CODE_SIGNING_ALLOWED=NO build

# Android
cd <out-dir>/GrpcDummy/android && ./gradlew assembleDebug
```

The [example app](../example/) is a development playground with the newest React Native. CI does not
use it: it links the library source from the repository root and only covers one React Native version.

## Not covered

- Loading the native module at runtime (a build does not start the app).
- A real TLS handshake with certificate pinning.
