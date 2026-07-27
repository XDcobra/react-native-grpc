#import "SpkiPinning.h"
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>

NSArray<NSString *> *SpkiNormalizePins(NSArray *rawPins) {
  if (rawPins == nil || rawPins.count == 0) {
    return nil;
  }
  NSMutableArray<NSString *> *out = [NSMutableArray array];
  for (id item in rawPins) {
    if (![item isKindOfClass:[NSString class]]) {
      continue;
    }
    NSString *pin = [(NSString *)item
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (pin.length == 0) {
      continue;
    }
    if ([pin.lowercaseString hasPrefix:@"sha256/"]) {
      pin = [[pin substringFromIndex:7]
        stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    }
    if (pin.length > 0) {
      [out addObject:pin];
    }
  }
  return out.count > 0 ? [out copy] : nil;
}

NSString *SpkiSha256Base64FromCertificateData(NSData *certDer) {
  if (certDer.length == 0) {
    return nil;
  }
  SecCertificateRef cert = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)certDer);
  if (cert == NULL) {
    return nil;
  }

  SecKeyRef key = SecCertificateCopyKey(cert);
  CFRelease(cert);
  if (key == NULL) {
    return nil;
  }

  // OpenSSL/SPKI DER export of the public key (matches Android PublicKey.getEncoded()).
  CFDataRef spkiData = NULL;
  OSStatus status = SecItemExport(key, kSecFormatOpenSSL, 0, NULL, &spkiData);
  CFRelease(key);
  if (status != errSecSuccess || spkiData == NULL) {
    return nil;
  }

  NSData *spki = (__bridge_transfer NSData *)spkiData;
  uint8_t digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(spki.bytes, (CC_LONG)spki.length, digest);
  return [[NSData dataWithBytes:digest length:CC_SHA256_DIGEST_LENGTH]
    base64EncodedStringWithOptions:0];
}

static NSArray<NSData *> *CertificatesFromPem(NSString *pem) {
  if (pem.length == 0) {
    return @[];
  }
  NSMutableArray<NSData *> *certs = [NSMutableArray array];
  NSArray<NSString *> *parts = [pem componentsSeparatedByString:@"-----BEGIN CERTIFICATE-----"];
  for (NSString *part in parts) {
    NSRange end = [part rangeOfString:@"-----END CERTIFICATE-----"];
    if (end.location == NSNotFound) {
      continue;
    }
    NSString *b64 = [[part substringToIndex:end.location]
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    b64 = [[b64 componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]
      componentsJoinedByString:@""];
    NSData *der = [[NSData alloc] initWithBase64EncodedString:b64 options:0];
    if (der.length > 0) {
      [certs addObject:der];
    }
  }
  return certs;
}

BOOL SpkiPemCertificatesMatchPins(NSString *pem, NSArray<NSString *> *pins, NSError **error) {
  if (pins.count == 0) {
    return YES;
  }
  NSArray<NSData *> *certs = CertificatesFromPem(pem);
  if (certs.count == 0) {
    if (error) {
      *error = [NSError errorWithDomain:@"SpkiPinning"
                                   code:1
                               userInfo:@{
                                 NSLocalizedDescriptionKey : @"rootCertsPem contained no certificates"
                               }];
    }
    return NO;
  }
  NSSet<NSString *> *pinSet = [NSSet setWithArray:pins];
  for (NSData *der in certs) {
    NSString *pin = SpkiSha256Base64FromCertificateData(der);
    if (pin != nil && [pinSet containsObject:pin]) {
      return YES;
    }
  }
  if (error) {
    *error = [NSError errorWithDomain:@"SpkiPinning"
                                 code:2
                             userInfo:@{
                               NSLocalizedDescriptionKey :
                                 @"spkiSha256Pins do not match any certificate in rootCertsPem"
                             }];
  }
  return NO;
}
