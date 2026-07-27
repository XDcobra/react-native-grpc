package com.reactnativegrpc;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Collection;

import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

final class TrustManagers {
  private TrustManagers() {}

  static X509TrustManager systemTrustManager() throws Exception {
    TrustManagerFactory factory =
      TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    factory.init((KeyStore) null);
    return requireX509(factory);
  }

  static X509TrustManager fromPemRoots(String pem) throws Exception {
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    InputStream in = new ByteArrayInputStream(pem.getBytes(StandardCharsets.UTF_8));
    Collection<? extends Certificate> certs = cf.generateCertificates(in);
    if (certs.isEmpty()) {
      throw new IllegalArgumentException("rootCertsPem contained no certificates");
    }
    KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
    keyStore.load(null);
    int i = 0;
    for (Certificate cert : certs) {
      keyStore.setCertificateEntry("ca-" + i++, cert);
    }
    TrustManagerFactory factory =
      TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    factory.init(keyStore);
    return requireX509(factory);
  }

  private static X509TrustManager requireX509(TrustManagerFactory factory) {
    for (javax.net.ssl.TrustManager tm : factory.getTrustManagers()) {
      if (tm instanceof X509TrustManager) {
        return (X509TrustManager) tm;
      }
    }
    throw new IllegalStateException("No X509TrustManager found");
  }
}
