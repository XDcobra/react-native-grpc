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
installs the tarball, copies `test/app/App.tsx` into it and bundles the JS for both platforms.

Then build natively:

```sh
# iOS (macOS only)
cd <out-dir>/GrpcDummy/ios && bundle install && bundle exec pod install
xcodebuild -workspace GrpcDummy.xcworkspace -scheme GrpcDummy -sdk iphonesimulator \
  -configuration Debug CODE_SIGNING_ALLOWED=NO build

# Android
cd <out-dir>/GrpcDummy/android && ./gradlew assembleDebug
```

## Not covered

- Loading the native module at runtime (a build does not start the app).
- A real TLS handshake with certificate pinning.
