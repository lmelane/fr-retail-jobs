#!/usr/bin/env bash
# D-453 §3 (30/09/2026) — PKI de TEST des témoins de complétion de chaîne TLS
# (`src/lib/tlsChainCompletion.test.ts`). Rejouable :
#   bash apps/aggregator/scripts/ops/generer-pki-test-chaine-tls.sh
# Exige OpenSSL >= 3.4 (`-not_before` / `-not_after`) : l'intermédiaire expiré porte des dates
# PASSÉES fixes, qu'aucune option `-days` ne sait écrire. Les fichiers sont versionnés parce que
# l'OpenSSL 3.0 de la CI ne sait pas les régénérer.
#
# Les clés des autorités restent dans un dossier temporaire détruit à la sortie : seule la clé
# commune des feuilles est versionnée, parce que le serveur TLS local des témoins en a besoin.
# Aucune de ces autorités n'est une racine de Node : les témoins les passent explicitement.
set -euo pipefail

OUT="$(cd "$(dirname "$0")/../.." && pwd)/src/lib/__fixtures__/tls-chain"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

FROM=20260101000000Z
TO=21251231000000Z
SERIAL=1000
AIA=http://aia.test

key() { openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1" 2>/dev/null; }

# emit <nom> <CN> <émetteur|self> <extensions> [début] [fin] [clé]
emit() {
  local name=$1 cn=$2 issuer=$3 extensions=$4 from=${5:-$FROM} to=${6:-$TO} keyfile=${7:-$WORK/$1.key}
  [ -f "$keyfile" ] || key "$keyfile"
  printf '[v3]\n%b\n' "$extensions" > "$WORK/$name.ext"
  openssl req -new -key "$keyfile" -subj "/O=Catwalks Test D453/CN=$cn" -out "$WORK/$name.csr"
  SERIAL=$((SERIAL + 1))
  if [ "$issuer" = self ]; then
    openssl x509 -req -in "$WORK/$name.csr" -key "$keyfile" -set_serial "$SERIAL" \
      -not_before "$from" -not_after "$to" -extfile "$WORK/$name.ext" -extensions v3 -out "$WORK/$name.pem" 2>/dev/null
  else
    openssl x509 -req -in "$WORK/$name.csr" -CA "$WORK/$issuer.pem" -CAkey "$WORK/$issuer.key" -set_serial "$SERIAL" \
      -not_before "$from" -not_after "$to" -extfile "$WORK/$name.ext" -extensions v3 -out "$WORK/$name.pem" 2>/dev/null
  fi
}

CA='basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash'
SUB="$CA\nauthorityKeyIdentifier=keyid:always"
# leaf <nom> <émetteur> <SAN> <ligne AIA ou vide>
leaf() {
  local extensions="basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:$3\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always"
  [ -n "$4" ] && extensions="$extensions\n$4"
  emit "$1" "$3" "$2" "$extensions" "$FROM" "$TO" "$WORK/leaf.key"
}

# Racine de confiance des témoins, et la chaîne saine.
emit root 'Catwalks Test Root D453' self "$CA"
emit inter 'Catwalks Test Intermediate D453' root "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always"
leaf leaf inter careers.test "authorityInfoAccess=caIssuers;URI:$AIA/inter.crt"

# Attaques : chaque « intermédiaire » servi par l'AIA viole UNE propriété.
emit impostor 'Catwalks Test Intermediate D453' root "$SUB"          # même nom, autre clé : n'a pas signé la feuille
emit rogue-root 'Rogue Root D453' self "$CA"                          # racine hors des ancres
emit rogue-inter 'Rogue Intermediate D453' rogue-root "$SUB"          # AC valide… vers une racine non reconnue
emit attacker-ca 'Attacker CA D453' self "$CA"                        # auto-signée : deviendrait une ancre
emit not-ca 'Not A CA D453' root 'basicConstraints=critical,CA:FALSE\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always'
emit no-certsign 'No CertSign CA D453' root 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always'
emit expired-inter 'Expired Intermediate D453' root "$SUB" 20200101000000Z 20210101000000Z

leaf leaf-rogue rogue-inter careers.test "authorityInfoAccess=caIssuers;URI:$AIA/rogue-inter.crt"
leaf leaf-attacker attacker-ca careers.test "authorityInfoAccess=caIssuers;URI:$AIA/attacker-ca.crt"
leaf leaf-not-ca not-ca careers.test "authorityInfoAccess=caIssuers;URI:$AIA/not-ca.crt"
leaf leaf-no-certsign no-certsign careers.test "authorityInfoAccess=caIssuers;URI:$AIA/no-certsign.crt"
leaf leaf-expired-inter expired-inter careers.test "authorityInfoAccess=caIssuers;URI:$AIA/expired-inter.crt"
leaf leaf-wrong-host inter other.test "authorityInfoAccess=caIssuers;URI:$AIA/inter.crt"
leaf leaf-no-aia inter careers.test ''
leaf leaf-aia-ldap inter careers.test 'authorityInfoAccess=caIssuers;URI:ldap://aia.test/cn=inter'
leaf leaf-aia-metadata inter careers.test 'authorityInfoAccess=caIssuers;URI:http://169.254.169.254/latest/meta-data/'
leaf leaf-aia-private-dns inter careers.test 'authorityInfoAccess=caIssuers;URI:http://aia-internal.test/inter.crt'
# Feuille auto-signée : une autre erreur TLS, que la complétion ne doit jamais toucher.
emit leaf-self-signed careers.test self "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:careers.test\nauthorityInfoAccess=caIssuers;URI:$AIA/inter.crt" "$FROM" "$TO" "$WORK/leaf.key"

for name in root inter impostor rogue-inter attacker-ca not-ca no-certsign expired-inter \
  leaf leaf-rogue leaf-attacker leaf-not-ca leaf-no-certsign leaf-expired-inter leaf-wrong-host \
  leaf-no-aia leaf-aia-ldap leaf-aia-metadata leaf-aia-private-dns leaf-self-signed; do
  cp "$WORK/$name.pem" "$OUT/$name.pem"
done
openssl x509 -in "$WORK/inter.pem" -outform DER -out "$OUT/inter.der"
cp "$WORK/leaf.key" "$OUT/leaf.key"
echo "PKI de test écrite dans $OUT"
