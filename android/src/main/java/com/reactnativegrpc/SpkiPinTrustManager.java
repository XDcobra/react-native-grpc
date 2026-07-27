package com.reactnativegrpc;

import android.util.Base64;

import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import javax.net.ssl.X509TrustManager;

/**
 * Delegates chain validation to {@code base}, then requires at least one
 * certificate in the chain to match a SHA-256 SPKI pin (OkHttp-compatible).
 */
final class SpkiPinTrustManager implements X509TrustManager {
  private final X509TrustManager base;
  private final Set<String> pins;

  SpkiPinTrustManager(X509TrustManager base, List<String> pins) {
    if (base == null) {
      throw new IllegalArgumentException("base trust manager required");
    }
    if (pins == null || pins.isEmpty()) {
      throw new IllegalArgumentException("SPKI pins required");
    }
    this.base = base;
    this.pins = Collections.unmodifiableSet(new LinkedHashSet<>(pins));
  }

  @Override
  public void checkClientTrusted(X509Certificate[] chain, String authType)
    throws CertificateException {
    base.checkClientTrusted(chain, authType);
  }

  @Override
  public void checkServerTrusted(X509Certificate[] chain, String authType)
    throws CertificateException {
    base.checkServerTrusted(chain, authType);
    if (!chainMatchesPins(chain, pins)) {
      throw new CertificateException("Certificate SPKI pin mismatch");
    }
  }

  @Override
  public X509Certificate[] getAcceptedIssuers() {
    return base.getAcceptedIssuers();
  }

  static boolean chainMatchesPins(X509Certificate[] chain, Set<String> pins)
    throws CertificateException {
    if (chain == null || chain.length == 0) {
      return false;
    }
    for (X509Certificate cert : chain) {
      if (pins.contains(spkiSha256Base64(cert))) {
        return true;
      }
    }
    return false;
  }

  static String spkiSha256Base64(X509Certificate cert) throws CertificateException {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(cert.getPublicKey().getEncoded());
      return Base64.encodeToString(hash, Base64.NO_WRAP);
    } catch (Exception e) {
      throw new CertificateException("Failed to compute SPKI pin", e);
    }
  }

  /** Normalize pin strings: strip optional {@code sha256/} prefix; drop empties. */
  static List<String> normalizePins(List<String> raw) {
    if (raw == null || raw.isEmpty()) {
      return null;
    }
    List<String> out = new ArrayList<>();
    for (String pin : raw) {
      if (pin == null) {
        continue;
      }
      String trimmed = pin.trim();
      if (trimmed.isEmpty()) {
        continue;
      }
      if (trimmed.regionMatches(true, 0, "sha256/", 0, 7)) {
        trimmed = trimmed.substring(7).trim();
      }
      if (!trimmed.isEmpty()) {
        out.add(trimmed);
      }
    }
    return out.isEmpty() ? null : out;
  }
}
