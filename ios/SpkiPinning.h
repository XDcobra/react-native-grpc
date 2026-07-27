#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Strip optional `sha256/` prefix; return nil if empty. */
NSArray<NSString *> *_Nullable SpkiNormalizePins(NSArray *_Nullable rawPins);

/**
 * SHA-256 SPKI pin (standard base64) for a DER-encoded X.509 certificate.
 * Returns nil if the public key cannot be exported as SPKI.
 */
NSString *_Nullable SpkiSha256Base64FromCertificateData(NSData *certDer);

/**
 * True if at least one certificate in the PEM bundle matches a pin.
 * On iOS, SPKI pins are enforced together with rootCertsPem (trust store).
 */
BOOL SpkiPemCertificatesMatchPins(NSString *_Nullable pem,
                                  NSArray<NSString *> *pins,
                                  NSError *_Nullable *_Nullable error);

NS_ASSUME_NONNULL_END
