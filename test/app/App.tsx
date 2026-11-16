// Dummy app used by CI (test/app/create-dummy-app.sh). It only needs to import the
// packed library so Metro, autolinking and the native build all pick it up.
import React from 'react';
import { SafeAreaView, Text } from 'react-native';
import {
  GrpcClient,
  GrpcStatusCode,
  createChannel,
} from '@xdcobra/react-native-grpc';

export default function App() {
  const channel = React.useMemo(
    () => createChannel({ host: 'localhost:50051', insecure: true }),
    []
  );
  return (
    <SafeAreaView>
      <Text>
        grpc dummy {typeof GrpcClient} {GrpcStatusCode.OK} {typeof channel}
      </Text>
    </SafeAreaView>
  );
}
