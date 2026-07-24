import { fromByteArray } from 'base64-js';
import { Grpc } from './client';
export class ServerInputStream {
  // eslint-disable-next-line prettier/prettier
  constructor(callId, method) {
    this.callId = callId;
    this.method = method;
  }
  send(data) {
    return Grpc.clientStreamingCall(this.callId, this.method, {
      data: fromByteArray(data)
    });
  }
  complete() {
    return Grpc.finishClientStreaming(this.callId);
  }
}
//# sourceMappingURL=client-streaming.js.map