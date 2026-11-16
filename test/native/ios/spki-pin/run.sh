#!/usr/bin/env bash
# Checks ios/SpkiPinning.m against OpenSSL for RSA 2048/3072/4096 and EC P-256/P-384.
# Runs on macOS only (compiles the Objective-C file with clang; the Security.framework
# calls it uses behave the same on macOS and iOS).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../../../.."
cd "$ROOT"
OPENSSL=${OPENSSL:-$(command -v openssl)}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

: > "$WORK/expected.txt"
while read -r name spec; do
  if [[ $spec == ec:* ]]; then
    "$OPENSSL" ecparam -name "${spec#ec:}" -genkey -noout -out "$WORK/$name.key"
    "$OPENSSL" req -x509 -key "$WORK/$name.key" -subj /CN=t -days 2 -out "$WORK/$name.pem" 2>/dev/null
  else
    "$OPENSSL" req -x509 -newkey "$spec" -nodes -keyout "$WORK/$name.key" -out "$WORK/$name.pem" -subj /CN=t -days 2 2>/dev/null
  fi
  "$OPENSSL" x509 -in "$WORK/$name.pem" -outform der -out "$WORK/$name.der"
  pin=$("$OPENSSL" x509 -in "$WORK/$name.pem" -pubkey -noout | "$OPENSSL" pkey -pubin -outform der | "$OPENSSL" dgst -sha256 -binary | base64)
  echo "$name $pin" >> "$WORK/expected.txt"
done <<LIST
rsa2048 rsa:2048
rsa3072 rsa:3072
rsa4096 rsa:4096
ec256 ec:prime256v1
ec384 ec:secp384r1
LIST

clang -fobjc-arc -Iios "$HERE/check.m" ios/SpkiPinning.m -framework Foundation -framework Security -o "$WORK/check"
"$WORK/check" "$WORK" > "$WORK/actual.txt"
if diff "$WORK/expected.txt" "$WORK/actual.txt"; then echo "OK: all SPKI pins match OpenSSL"; else echo "FAIL"; exit 1; fi
