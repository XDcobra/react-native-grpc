#import "Grpc.h"
#import "SpkiPinning.h"
#import <GRPCClient/GRPCCall.h>
#import <GRPCClient/GRPCTransport.h>

@interface GrpcResponseHandler : NSObject <GRPCResponseHandler>

- (instancetype)initWithInitialMetadataCallback:(void (^)(NSDictionary *))initialMetadataCallback
                                messageCallback:(void (^)(id))messageCallback
                                  closeCallback:(void (^)(NSDictionary *, NSError *))closeCallback
                              writeDataCallback:(void (^)(void))writeDataCallback;

- (instancetype)initWithInitialMetadataCallback:(void (^)(NSDictionary *))initialMetadataCallback
                                messageCallback:(void (^)(id))messageCallback
                                  closeCallback:(void (^)(NSDictionary *, NSError *))closeCallback;

@end

@implementation GrpcResponseHandler {
    void (^_initialMetadataCallback)(NSDictionary *);

    void (^_messageCallback)(id);

    void (^_closeCallback)(NSDictionary *, NSError *);

    void (^_writeDataCallback)(void);

    dispatch_queue_t _dispatchQueue;
}

- (instancetype)initWithInitialMetadataCallback:(void (^)(NSDictionary *))initialMetadataCallback
                                messageCallback:(void (^)(id))messageCallback
                                  closeCallback:(void (^)(NSDictionary *, NSError *))closeCallback
                              writeDataCallback:(void (^)(void))writeDataCallback {
    if ((self = [super init])) {
        _initialMetadataCallback = initialMetadataCallback;
        _messageCallback = messageCallback;
        _closeCallback = closeCallback;
        _writeDataCallback = writeDataCallback;
        _dispatchQueue = dispatch_queue_create(nil, DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (instancetype)initWithInitialMetadataCallback:(void (^)(NSDictionary *))initialMetadataCallback
                                messageCallback:(void (^)(id))messageCallback
                                  closeCallback:(void (^)(NSDictionary *, NSError *))closeCallback {
    return [self initWithInitialMetadataCallback:initialMetadataCallback
                                 messageCallback:messageCallback
                                   closeCallback:closeCallback
                               writeDataCallback:nil];
}

- (void)didReceiveInitialMetadata:(NSDictionary *)initialMetadata {
    if (self->_initialMetadataCallback) {
        self->_initialMetadataCallback(initialMetadata);
    }
}

- (void)didReceiveRawMessage:(id)message {
    if (self->_messageCallback) {
        self->_messageCallback(message);
    }
}

- (void)didCloseWithTrailingMetadata:(NSDictionary *)trailingMetadata error:(NSError *)error {
    if (self->_closeCallback) {
        self->_closeCallback(trailingMetadata, error);
    }
}

- (void)didWriteData {
    if (self->_writeDataCallback) {
        self->_writeDataCallback();
    }
}

- (dispatch_queue_t)dispatchQueue {
    return _dispatchQueue;
}

@end

@implementation Grpc {
    bool hasListeners;
    NSMutableDictionary<NSNumber *, GRPCCall2 *> *calls;
}

- (instancetype)init {
    if (self = [super init]) {
        calls = [[NSMutableDictionary alloc] init];
    }

    return self;
}

// Will be called when this module's first listener is added.
- (void)startObserving {
    hasListeners = YES;
    // Set up any upstream listeners or background tasks as necessary
}

// Will be called when this module's last listener is removed, or on dealloc.
- (void)stopObserving {
    hasListeners = NO;
    // Remove upstream listeners, stop unnecessary background tasks
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"grpc-call"];
}

- (GRPCCallOptions *)getCallOptionsWithHeaders:(NSDictionary *)headers
                              deadlineSeconds:(NSNumber *)deadlineSeconds {
    GRPCMutableCallOptions *options = [[GRPCMutableCallOptions alloc] init];
    options.initialMetadata = headers;
    options.transport = self.grpcInsecure ? GRPCDefaultTransportImplList.core_insecure : GRPCDefaultTransportImplList.core_secure;

    if (!self.grpcInsecure) {
        if (self.grpcRootCertsPem.length > 0) {
            options.PEMRootCertificates = self.grpcRootCertsPem;
        }
        if (self.grpcCertificateChainPem.length > 0) {
            options.PEMCertificateChain = self.grpcCertificateChainPem;
        }
        if (self.grpcPrivateKeyPem.length > 0) {
            options.PEMPrivateKey = self.grpcPrivateKeyPem;
        }
        if (self.grpcHostNameOverride.length > 0) {
            options.hostNameOverride = self.grpcHostNameOverride;
        }
    }

    if (self.grpcResponseSizeLimit != nil) {
        options.responseSizeLimit = self.grpcResponseSizeLimit.unsignedLongValue;
    }
    NSTimeInterval deadline;
    if (deadlineSeconds != nil) {
        deadline = MAX(0, [deadlineSeconds doubleValue]);
    } else if (self.grpcCallDeadlineSeconds > 0) {
        deadline = self.grpcCallDeadlineSeconds;
    } else {
        deadline = 120;
    }
    if (deadline > 0) {
        options.timeout = deadline;
    }

    return options;
}

RCT_EXPORT_METHOD(getHost:
    (RCTPromiseResolveBlock) resolve) {
    resolve(self.grpcHost);
}

RCT_EXPORT_METHOD(getIsInsecure:
    (RCTPromiseResolveBlock) resolve) {
    resolve([NSNumber numberWithBool:self.grpcInsecure]);
}

RCT_EXPORT_METHOD(setHost:
    (NSString *) host) {
    self.grpcHost = host;
}


RCT_EXPORT_METHOD(setInsecure:
    (nonnull NSNumber*) insecure) {
    self.grpcInsecure = [insecure boolValue];
}

RCT_EXPORT_METHOD(setTlsOptions:
    (NSDictionary *) options) {
    NSString *rootCerts = [self tlsStringFromOptions:options key:@"rootCertsPem"];
    NSString *certChain = [self tlsStringFromOptions:options key:@"certificateChainPem"];
    NSString *privateKey = [self tlsStringFromOptions:options key:@"privateKeyPem"];
    NSString *hostOverride = [self tlsStringFromOptions:options key:@"hostNameOverride"];
    NSArray<NSString *> *pins = SpkiNormalizePins(options[@"spkiSha256Pins"]);

    BOOL hasCert = certChain.length > 0;
    BOOL hasKey = privateKey.length > 0;
    if (hasCert != hasKey) {
        @throw [NSException exceptionWithName:NSInvalidArgumentException
                                       reason:@"mTLS requires both certificateChainPem and privateKeyPem"
                                     userInfo:nil];
    }

    if (pins.count > 0) {
        // gRPC ObjC has no handshake SPKI hook; pin by trusting only matching PEM certs.
        if (rootCerts.length == 0) {
            @throw [NSException exceptionWithName:NSInvalidArgumentException
                                           reason:@"spkiSha256Pins on iOS requires rootCertsPem (include the pinned leaf or intermediate PEM)"
                                         userInfo:nil];
        }
        NSError *pinError = nil;
        if (!SpkiPemCertificatesMatchPins(rootCerts, pins, &pinError)) {
            @throw [NSException exceptionWithName:NSInvalidArgumentException
                                           reason:pinError.localizedDescription ?: @"SPKI pin mismatch for rootCertsPem"
                                         userInfo:nil];
        }
    }

    self.grpcRootCertsPem = rootCerts;
    self.grpcCertificateChainPem = certChain;
    self.grpcPrivateKeyPem = privateKey;
    self.grpcHostNameOverride = hostOverride;
    self.grpcSpkiSha256Pins = pins;
}

- (NSString *)tlsStringFromOptions:(NSDictionary *)options key:(NSString *)key {
    id value = options[key];
    if (value == nil || value == [NSNull null]) {
        return nil;
    }
    if (![value isKindOfClass:[NSString class]]) {
        return nil;
    }
    NSString *string = (NSString *)value;
    return string.length > 0 ? string : nil;
}

RCT_EXPORT_METHOD(setResponseSizeLimit:
    (nonnull NSNumber*) limit) {
    self.grpcResponseSizeLimit = limit;
}

RCT_EXPORT_METHOD(setCallDeadlineSeconds:
    (nonnull NSNumber*) seconds) {
    self.grpcCallDeadlineSeconds = MAX(0, [seconds doubleValue]);
}

RCT_EXPORT_METHOD(unaryCall:
    (nonnull NSNumber*)callId
        path:(NSString*)path
        obj:(NSDictionary*)obj
        headers:(NSDictionary*)headers
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    GRPCCall2 *call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj];

    [call writeData:requestData];
    [call finish];

    [calls setObject:call forKey:callId];

    resolve([NSNull null]);
}

RCT_EXPORT_METHOD(serverStreamingCall:
    (nonnull NSNumber*)callId
        path:(NSString*)path
        obj:(NSDictionary*)obj
        headers:(NSDictionary*)headers
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    GRPCCall2 *call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj];

    [call writeData:requestData];
    [call finish];

    [calls setObject:call forKey:callId];

    resolve([NSNull null]);
}

RCT_EXPORT_METHOD(cancelGrpcCall:
    (nonnull NSNumber*)callId
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    GRPCCall2 *call = [calls objectForKey:callId];

    if (call != nil) {
        [call cancel];

        resolve([NSNumber numberWithBool:true]);
    } else {
        resolve([NSNumber numberWithBool:false]);
    }
}

RCT_EXPORT_METHOD(clientStreamingCall:
    (nonnull NSNumber*)callId
        path:(NSString*)path
        obj:(NSDictionary*)obj
        headers:(NSDictionary*)headers
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    GRPCCall2 *call = [calls objectForKey:callId];

    if (call == nil) {
        call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj];

        [calls setObject:call forKey:callId];
    }

    [call writeData:requestData];

    resolve([NSNull null]);
}

RCT_EXPORT_METHOD(bidiStreamingCall:
    (nonnull NSNumber*)callId
        path:(NSString*)path
        obj:(NSDictionary*)obj
        headers:(NSDictionary*)headers
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    GRPCCall2 *call = [calls objectForKey:callId];

    if (call == nil) {
        call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj];

        [calls setObject:call forKey:callId];
    }

    [call writeData:requestData];

    resolve([NSNull null]);
}

RCT_EXPORT_METHOD(finishClientStreaming:
    (nonnull NSNumber*)callId
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    GRPCCall2 *call = [calls objectForKey:callId];

    if (call != nil) {
        [call finish];

        resolve([NSNumber numberWithBool:true]);
    } else {
        resolve([NSNumber numberWithBool:false]);
    }
}

- (GRPCCall2 *)startGrpcCallWithId:(NSNumber *)callId
                              path:(NSString *)path
                           headers:(NSDictionary *)headers
                   deadlineFromObj:(NSDictionary *)obj {
    GRPCRequestOptions *requestOptions = [[GRPCRequestOptions alloc] initWithHost:self.grpcHost
                                                                             path:path
                                                                           safety:GRPCCallSafetyDefault];

    NSNumber *deadlineOverride = nil;
    id rawDeadline = [obj valueForKey:@"deadlineSeconds"];
    if ([rawDeadline isKindOfClass:[NSNumber class]]) {
        deadlineOverride = (NSNumber *)rawDeadline;
    }

    GRPCCallOptions *callOptions = [self getCallOptionsWithHeaders:headers deadlineSeconds:deadlineOverride];

    GrpcResponseHandler *handler = [[GrpcResponseHandler alloc] initWithInitialMetadataCallback:^(NSDictionary *initialMetadata) {
                if (self->hasListeners) {
                    NSDictionary *responseHeaders = [[NSMutableDictionary alloc] initWithDictionary:initialMetadata];

                    [responseHeaders enumerateKeysAndObjectsUsingBlock:^(id key, id object, BOOL *exit) {
                        if ([object isKindOfClass:[NSData class]]) {
                            [responseHeaders setValue:[object base64EncodedStringWithOptions:0] forKey:key];
                        }
                    }];

                    NSDictionary *event = @{
                            @"id": callId,
                            @"type": @"headers",
                            @"payload": responseHeaders,
                    };

                    [self sendEventWithName:@"grpc-call" body:event];
                }
            }
    messageCallback:^(id message) {
        NSData *data = (NSData *) message;

        if (self->hasListeners) {
            NSDictionary *event = @{
                    @"id": callId,
                    @"type": @"response",
                    @"payload": [data base64EncodedStringWithOptions:nil],
            };

            [self sendEventWithName:@"grpc-call" body:event];
        }
    }
        closeCallback:^(NSDictionary *trailingMetadata, NSError *error) {
            [calls removeObjectForKey:callId];

            NSDictionary *responseTrailers = [[NSMutableDictionary alloc] initWithDictionary:trailingMetadata];

            [responseTrailers enumerateKeysAndObjectsUsingBlock:^(id key, id object, BOOL *exit) {
                if ([object isKindOfClass:[NSData class]]) {
                    [responseTrailers setValue:[object base64EncodedStringWithOptions:0] forKey:key];
                }
            }];

            if (self->hasListeners) {
                if (error != nil) {
                    NSDictionary *event = @{
                            @"id": callId,
                            @"type": @"error",
                            @"error": error.localizedDescription,
                            @"code": [NSNumber numberWithLong:error.code],
                            @"trailers": responseTrailers,
                    };

                    [self sendEventWithName:@"grpc-call" body:event];
                } else {
                    NSDictionary *event = @{
                            @"id": callId,
                            @"type": @"trailers",
                            @"payload": responseTrailers,
                    };

                    [self sendEventWithName:@"grpc-call" body:event];
                }
            }
        }
    ];

    GRPCCall2 *call = [[GRPCCall2 alloc] initWithRequestOptions:requestOptions
                                                responseHandler:handler
                                                    callOptions:callOptions];

    [call start];

    return call;
}

RCT_EXPORT_MODULE()

@end