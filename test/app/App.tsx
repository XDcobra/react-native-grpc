// Dummy app used by CI (test/app/create-dummy-app.sh). It imports the packed library so
// Metro, autolinking and the native build all pick it up, and `tsc` checks it against the
// published type declarations (root entry and the `create-client` subpath).
import React from 'react';
import { SafeAreaView, Text } from 'react-native';
import {
  GrpcClient,
  GrpcError,
  GrpcStatusCode,
  createChannel,
  createClient,
  type GrpcCallOptions,
} from '@xdcobra/react-native-grpc';
// Type-only, so Metro never resolves the subpath at runtime: React Native < 0.79 does not
// enable package "exports" in Metro by default. tsc still resolves it via "exports".
import type {
  createClient as createClientSubpath,
  GrpcTransport,
} from '@xdcobra/react-native-grpc/create-client';

const transport: GrpcTransport = GrpcClient;
const options: GrpcCallOptions = { deadlineSeconds: 5 };
const status: GrpcStatusCode = GrpcStatusCode.OK;
// Both entry points must expose the same function type.
const sameCreateClient: typeof createClientSubpath = createClient;

export default function App() {
  const channel = React.useMemo(
    () => createChannel({ host: 'localhost:50051', insecure: true }),
    []
  );
  const call = React.useCallback(() => {
    // Typechecked only: unary calls return a thenable with cancel().
    const unary = GrpcClient.unaryCall(
      '/svc/Method',
      new Uint8Array(),
      {},
      options
    );
    unary.cancel();
    return unary.then(
      (res) => res.status,
      (err: unknown) => (err instanceof GrpcError ? err.code : undefined)
    );
  }, []);
  return (
    <SafeAreaView>
      <Text>
        grpc dummy {typeof transport} {status} {typeof channel}{' '}
        {typeof sameCreateClient} {typeof call}
      </Text>
    </SafeAreaView>
  );
}
