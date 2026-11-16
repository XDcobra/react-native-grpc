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

  // SubjectPublicKeyInfo DER of the public key (matches Android PublicKey.getEncoded()).
  // SecItemExport / kSecFormatOpenSSL exist on macOS only. On iOS the key is exported
  // raw (PKCS#1 for RSA, X9.63 for EC) and the fixed ASN.1 SPKI header for its type
  // and size is prepended.
  static const uint8_t kRsa2048[] = {0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
                                     0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00};
  static const uint8_t kRsa3072[] = {0x30, 0x82, 0x01, 0xa2, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
                                     0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x8f, 0x00};
  static const uint8_t kRsa4096[] = {0x30, 0x82, 0x02, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
                                     0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x02, 0x0f, 0x00};
  static const uint8_t kEc256[] = {0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
                                   0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00};
  static const uint8_t kEc384[] = {0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
                                   0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00};

  NSDictionary *attrs = (__bridge_transfer NSDictionary *)SecKeyCopyAttributes(key);
  NSString *keyType = attrs[(__bridge NSString *)kSecAttrKeyType];
  NSInteger keyBits = [attrs[(__bridge NSString *)kSecAttrKeySizeInBits] integerValue];
  CFDataRef rawKey = SecKeyCopyExternalRepresentation(key, NULL);
  CFRelease(key);
  if (rawKey == NULL) {
    return nil;
  }

  const uint8_t *header = NULL;
  size_t headerLength = 0;
  if ([keyType isEqualToString:(__bridge NSString *)kSecAttrKeyTypeRSA]) {
    if (keyBits == 2048) {
      header = kRsa2048;
      headerLength = sizeof(kRsa2048);
    } else if (keyBits == 3072) {
      header = kRsa3072;
      headerLength = sizeof(kRsa3072);
    } else if (keyBits == 4096) {
      header = kRsa4096;
      headerLength = sizeof(kRsa4096);
    }
  } else if ([keyType isEqualToString:(__bridge NSString *)kSecAttrKeyTypeECSECPrimeRandom]) {
    if (keyBits == 256) {
      header = kEc256;
      headerLength = sizeof(kEc256);
    } else if (keyBits == 384) {
      header = kEc384;
      headerLength = sizeof(kEc384);
    }
  }
  if (header == NULL) {
    // Unsupported key type or size: no pin can match.
    CFRelease(rawKey);
    return nil;
  }

  NSMutableData *spkiBytes = [NSMutableData dataWithBytes:header length:headerLength];
  [spkiBytes appendData:(__bridge NSData *)rawKey];
  CFRelease(rawKey);

  NSData *spki = spkiBytes;
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
