#import <Foundation/Foundation.h>
#import "SpkiPinning.h"

// Usage: check <dir>  — prints "<name> <pin>" for each <name>.der in <dir>.
int main(int argc, char **argv) {
  @autoreleasepool {
    for (NSString *n in @[@"rsa2048", @"rsa3072", @"rsa4096", @"ec256", @"ec384"]) {
      NSString *path = [NSString stringWithFormat:@"%s/%@.der", argv[1], n];
      NSString *pin = SpkiSha256Base64FromCertificateData([NSData dataWithContentsOfFile:path]);
      printf("%s %s\n", n.UTF8String, pin ? pin.UTF8String : "nil");
    }
  }
  return 0;
}
