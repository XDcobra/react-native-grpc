#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface Grpc : RCTEventEmitter <RCTBridgeModule>

@property (nonatomic, copy) NSString* grpcHost;
@property (nonatomic, copy) NSNumber* grpcResponseSizeLimit;
@property (nonatomic, assign) BOOL grpcInsecure;
/** Per-call timeout in seconds (0 = gRPC default). Default 120. */
@property (nonatomic, assign) NSTimeInterval grpcCallDeadlineSeconds;
/** PEM trust roots; nil = gRPC default roots. */
@property (nonatomic, copy) NSString* grpcRootCertsPem;
/** PEM client certificate chain for mTLS. */
@property (nonatomic, copy) NSString* grpcCertificateChainPem;
/** PEM client private key for mTLS. */
@property (nonatomic, copy) NSString* grpcPrivateKeyPem;
/** TLS hostname override (SNI / cert verification). */
@property (nonatomic, copy) NSString* grpcHostNameOverride;

@end