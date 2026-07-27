import 'text-encoding';
import { create } from '@bufbuild/protobuf';
import { createClient, GrpcClient } from '@xdcobra/react-native-grpc';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  ExampleRequestSchema,
  Examples,
} from './gen/example_pb';

export default function App() {
  const [result, setResult] = useState<string>();

  useEffect(() => {
    GrpcClient.setHost('example.com');
    GrpcClient.setInsecure(true);

    const client = createClient(Examples, GrpcClient);
    const request = create(ExampleRequestSchema, {
      message: 'Hello World',
    });

    client
      .sendExampleMessage(request)
      .then((response) => setResult(response.message))
      .catch(() => {
        // Demo host is unreachable; leave result empty.
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text>Result: {result}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 60,
    height: 60,
    marginVertical: 20,
  },
});
