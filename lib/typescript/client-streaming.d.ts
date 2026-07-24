import { GrpcServerInputStream } from './types';
export declare class ServerInputStream implements GrpcServerInputStream {
    private callId;
    private method;
    constructor(callId: number, method: string);
    send(data: Uint8Array): Promise<void>;
    complete(): Promise<void>;
}
//# sourceMappingURL=client-streaming.d.ts.map