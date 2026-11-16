#!/usr/bin/env bash
# Creates a fresh React Native app in <out-dir>/GrpcDummy and installs the PACKED
# library (npm pack tarball, so the "files" field of package.json is tested too).
# Native builds happen afterwards in <out-dir>/GrpcDummy/{android,ios}.
#
# Usage: test/app/create-dummy-app.sh <out-dir> [react-native-version, default: latest]
set -euo pipefail

OUT=${1:?usage: create-dummy-app.sh <out-dir> [rn-version]}
RN_VERSION=${2:-latest}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

echo "==> Packing library"
cd "$ROOT"
yarn install --frozen-lockfile
yarn build
rm -f "$OUT"/xdcobra-react-native-grpc-*.tgz
npm pack --pack-destination "$OUT" >/dev/null
TARBALL=$(ls "$OUT"/xdcobra-react-native-grpc-*.tgz | head -1)
echo "    $TARBALL"

echo "==> Creating React Native app ($RN_VERSION)"
cd "$OUT"
rm -rf GrpcDummy
npx --yes @react-native-community/cli@latest init GrpcDummy \
  --version "$RN_VERSION" --skip-install --skip-git-init --pm npm

cd GrpcDummy
echo "==> Installing dependencies"
npm install --no-audit --no-fund
npm install --no-audit --no-fund "$TARBALL" @bufbuild/protobuf
cp "$ROOT/test/app/App.tsx" App.tsx

echo "==> Typechecking App.tsx against the packed library"
# The template's tsconfig resolves the "react-native" export condition (src/*.ts). Consumers
# without it read the published declarations instead, so check those too:
#   - "types" export condition (moduleResolution bundler/node16 without "react-native")
#   - top-level "types" field (moduleResolution node10, which ignores "exports")
npx tsc --noEmit
cat > tsconfig.grpc-exports.json <<'JSON'
{ "extends": "./tsconfig.json", "compilerOptions": { "customConditions": [] } }
JSON
npx tsc --noEmit -p tsconfig.grpc-exports.json
cat > grpc-node10.ts <<'TS'
import { GrpcClient, createClient } from '@xdcobra/react-native-grpc';
export const check: [typeof GrpcClient, typeof createClient] = [GrpcClient, createClient];
TS
# TypeScript 6 deprecates node10 resolution; silence that only where the option exists.
TS_MAJOR=$(node -p "require('typescript/package.json').version.split('.')[0]")
IGNORE_DEPRECATIONS=""
if [ "$TS_MAJOR" -ge 6 ]; then IGNORE_DEPRECATIONS='"ignoreDeprecations": "6.0",'; fi
cat > tsconfig.grpc-node10.json <<JSON
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    $IGNORE_DEPRECATIONS
    "module": "commonjs",
    "moduleResolution": "node10",
    "customConditions": null,
    "resolvePackageJsonImports": null,
    "allowImportingTsExtensions": false
  },
  "include": [],
  "files": ["grpc-node10.ts"]
}
JSON
npx tsc --noEmit -p tsconfig.grpc-node10.json
rm -f tsconfig.grpc-exports.json tsconfig.grpc-node10.json grpc-node10.ts

echo "==> Bundling JS (Metro must resolve the library)"
npx react-native bundle --platform ios --dev false --entry-file index.js \
  --bundle-output "$OUT/ios.bundle" >/dev/null
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output "$OUT/android.bundle" >/dev/null

echo "==> Dummy app ready: $OUT/GrpcDummy"
