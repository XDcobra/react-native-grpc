#import "Grpc.h"
#import "SpkiPinning.h"
#import <GRPCClient/GRPCCall.h>
#import <GRPCClient/GRPCTransport.h>

static NSString * const kGrpcDefaultChannelId = @"default";

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
    /** channelId → mutable config dictionary (extra channels; default uses properties). */
    NSMutableDictionary<NSString *, NSMutableDictionary *> *channelConfigs;
}

- (instancetype)init {
    if (self = [super init]) {
        calls = [[NSMutableDictionary alloc] init];
        channelConfigs = [[NSMutableDictionary alloc] init];
        self.grpcCallDeadlineSeconds = 120;
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

- (NSMutableDictionary *)configForChannelId:(NSString *)channelId {
    NSString *key = (channelId.length > 0) ? channelId : kGrpcDefaultChannelId;
    if ([key isEqualToString:kGrpcDefaultChannelId]) {
        NSMutableDictionary *cfg = [NSMutableDictionary dictionary];
        if (self.grpcHost != nil) {
            cfg[@"host"] = self.grpcHost;
        }
        cfg[@"insecure"] = @(self.grpcInsecure);
        cfg[@"callDeadlineSeconds"] = @(self.grpcCallDeadlineSeconds > 0 ? self.grpcCallDeadlineSeconds : 120);
        if (self.grpcResponseSizeLimit != nil) {
            cfg[@"responseSizeLimit"] = self.grpcResponseSizeLimit;
        }
        if (self.grpcRootCertsPem.length > 0) {
            cfg[@"rootCertsPem"] = self.grpcRootCertsPem;
        }
        if (self.grpcCertificateChainPem.length > 0) {
            cfg[@"certificateChainPem"] = self.grpcCertificateChainPem;
        }
        if (self.grpcPrivateKeyPem.length > 0) {
            cfg[@"privateKeyPem"] = self.grpcPrivateKeyPem;
        }
        if (self.grpcHostNameOverride.length > 0) {
            cfg[@"hostNameOverride"] = self.grpcHostNameOverride;
        }
        if (self.grpcSpkiSha256Pins.count > 0) {
            cfg[@"spkiSha256Pins"] = self.grpcSpkiSha256Pins;
        }
        return cfg;
    }
    return channelConfigs[key];
}

- (GRPCCallOptions *)getCallOptionsWithHeaders:(NSDictionary *)headers
                              deadlineSeconds:(NSNumber *)deadlineSeconds
                                channelConfig:(NSDictionary *)cfg {
    GRPCMutableCallOptions *options = [[GRPCMutableCallOptions alloc] init];
    options.initialMetadata = headers;
    BOOL insecure = [cfg[@"insecure"] boolValue];
    options.transport = insecure ? GRPCDefaultTransportImplList.core_insecure : GRPCDefaultTransportImplList.core_secure;

    if (!insecure) {
        NSString *rootCerts = cfg[@"rootCertsPem"];
        NSString *certChain = cfg[@"certificateChainPem"];
        NSString *privateKey = cfg[@"privateKeyPem"];
        NSString *hostOverride = cfg[@"hostNameOverride"];
        if (rootCerts.length > 0) {
            options.PEMRootCertificates = rootCerts;
        }
        if (certChain.length > 0) {
            options.PEMCertificateChain = certChain;
        }
        if (privateKey.length > 0) {
            options.PEMPrivateKey = privateKey;
        }
        if (hostOverride.length > 0) {
            options.hostNameOverride = hostOverride;
        }
    }

    NSNumber *responseSizeLimit = cfg[@"responseSizeLimit"];
    if (responseSizeLimit != nil) {
        options.responseSizeLimit = responseSizeLimit.unsignedLongValue;
    }
    NSTimeInterval deadline;
    if (deadlineSeconds != nil) {
        deadline = MAX(0, [deadlineSeconds doubleValue]);
    } else {
        NSNumber *channelDeadline = cfg[@"callDeadlineSeconds"];
        if (channelDeadline != nil && [channelDeadline doubleValue] > 0) {
            deadline = [channelDeadline doubleValue];
        } else {
            deadline = 120;
        }
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

/** No-op on iOS (host applied per call); kept for API parity with Android. */
RCT_EXPORT_METHOD(initGrpcChannel) {
}

RCT_EXPORT_METHOD(createChannel:
    (NSString *)channelId
        config:(NSDictionary *)config) {
    if (channelId.length == 0) {
        @throw [NSException exceptionWithName:NSInvalidArgumentException
                                       reason:@"channelId is required"
                                     userInfo:nil];
    }
    if ([channelId isEqualToString:kGrpcDefaultChannelId]) {
        @throw [NSException exceptionWithName:NSInvalidArgumentException
                                       reason:@"channelId \"default\" is reserved for GrpcClient"
                                     userInfo:nil];
    }
    NSString *host = config[@"host"];
    if (![host isKindOfClass:[NSString class]] || host.length == 0) {
        @throw [NSException exceptionWithName:NSInvalidArgumentException
                                       reason:@"createChannel requires host"
                                     userInfo:nil];
    }

    NSMutableDictionary *cfg = [NSMutableDictionary dictionary];
    cfg[@"host"] = host;
    cfg[@"insecure"] = @([config[@"insecure"] boolValue]);
    NSNumber *deadline = config[@"callDeadlineSeconds"];
    cfg[@"callDeadlineSeconds"] = (deadline != nil && deadline != (id)[NSNull null])
        ? @(MAX(0, [deadline doubleValue]))
        : @(120);
    id responseSize = config[@"responseSizeLimit"];
    if (responseSize != nil && responseSize != [NSNull null]) {
        cfg[@"responseSizeLimit"] = responseSize;
    }

    id tlsObj = config[@"tls"];
    if ([tlsObj isKindOfClass:[NSDictionary class]]) {
        NSDictionary *tls = (NSDictionary *)tlsObj;
        NSString *rootCerts = [self tlsStringFromOptions:tls key:@"rootCertsPem"];
        NSString *certChain = [self tlsStringFromOptions:tls key:@"certificateChainPem"];
        NSString *privateKey = [self tlsStringFromOptions:tls key:@"privateKeyPem"];
        NSString *hostOverride = [self tlsStringFromOptions:tls key:@"hostNameOverride"];
        NSArray<NSString *> *pins = SpkiNormalizePins(tls[@"spkiSha256Pins"]);

        BOOL hasCert = certChain.length > 0;
        BOOL hasKey = privateKey.length > 0;
        if (hasCert != hasKey) {
            @throw [NSException exceptionWithName:NSInvalidArgumentException
                                           reason:@"mTLS requires both certificateChainPem and privateKeyPem"
                                         userInfo:nil];
        }
        if (pins.count > 0) {
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
        if (rootCerts.length > 0) {
            cfg[@"rootCertsPem"] = rootCerts;
        }
        if (certChain.length > 0) {
            cfg[@"certificateChainPem"] = certChain;
        }
        if (privateKey.length > 0) {
            cfg[@"privateKeyPem"] = privateKey;
        }
        if (hostOverride.length > 0) {
            cfg[@"hostNameOverride"] = hostOverride;
        }
        if (pins.count > 0) {
            cfg[@"spkiSha256Pins"] = pins;
        }
    }

    channelConfigs[channelId] = cfg;
}

RCT_EXPORT_METHOD(closeChannel:
    (NSString *)channelId) {
    if (channelId.length == 0 || [channelId isEqualToString:kGrpcDefaultChannelId]) {
        return;
    }
    [channelConfigs removeObjectForKey:channelId];
}

RCT_EXPORT_METHOD(unaryCall:
    (nonnull NSNumber*)callId
        path:(NSString*)path
        obj:(NSDictionary*)obj
        headers:(NSDictionary*)headers
        channelId:(NSString*)channelId
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    NSError *startError = nil;
    GRPCCall2 *call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj channelId:channelId error:&startError];
    if (call == nil) {
        reject(@"channel_error", startError.localizedDescription ?: @"Channel not created", startError);
        return;
    }

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
        channelId:(NSString*)channelId
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    NSError *startError = nil;
    GRPCCall2 *call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj channelId:channelId error:&startError];
    if (call == nil) {
        reject(@"channel_error", startError.localizedDescription ?: @"Channel not created", startError);
        return;
    }

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
        channelId:(NSString*)channelId
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    GRPCCall2 *call = [calls objectForKey:callId];

    if (call == nil) {
        NSError *startError = nil;
        call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj channelId:channelId error:&startError];
        if (call == nil) {
            reject(@"channel_error", startError.localizedDescription ?: @"Channel not created", startError);
            return;
        }

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
        channelId:(NSString*)channelId
        resolver:(RCTPromiseResolveBlock)resolve
        rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *requestData = [[NSData alloc] initWithBase64EncodedString:[obj valueForKey:@"data"] options:NSDataBase64DecodingIgnoreUnknownCharacters];

    GRPCCall2 *call = [calls objectForKey:callId];

    if (call == nil) {
        NSError *startError = nil;
        call = [self startGrpcCallWithId:callId path:path headers:headers deadlineFromObj:obj channelId:channelId error:&startError];
        if (call == nil) {
            reject(@"channel_error", startError.localizedDescription ?: @"Channel not created", startError);
            return;
        }

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
                   deadlineFromObj:(NSDictionary *)obj
                         channelId:(NSString *)channelId
                             error:(NSError **)outError {
    NSDictionary *cfg = [self configForChannelId:channelId];
    if (cfg == nil) {
        if (outError) {
            *outError = [NSError errorWithDomain:@"Grpc"
                                            code:0
                                        userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Unknown channel: %@", channelId]}];
        }
        return nil;
    }
    NSString *host = cfg[@"host"];
    if (host.length == 0) {
        if (outError) {
            *outError = [NSError errorWithDomain:@"Grpc"
                                            code:0
                                        userInfo:@{NSLocalizedDescriptionKey: @"Channel host not set"}];
        }
        return nil;
    }

    GRPCRequestOptions *requestOptions = [[GRPCRequestOptions alloc] initWithHost:host
                                                                             path:path
                                                                           safety:GRPCCallSafetyDefault];

    NSNumber *deadlineOverride = nil;
    id rawDeadline = [obj valueForKey:@"deadlineSeconds"];
    if ([rawDeadline isKindOfClass:[NSNumber class]]) {
        deadlineOverride = (NSNumber *)rawDeadline;
    }

    GRPCCallOptions *callOptions = [self getCallOptionsWithHeaders:headers deadlineSeconds:deadlineOverride channelConfig:cfg];

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
