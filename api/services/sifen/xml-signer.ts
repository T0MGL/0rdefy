/**
 * XML Digital Signature for SIFEN
 *
 * Signs XML documents with enveloped RSA-SHA256 per xmldsig-core.
 * Accepts pre-extracted PEM strings (private key + certificate).
 * The .p12 file and its password are never accepted or persisted here.
 *
 * Critical details for SIFEN (Paraguay) compliance, MT-SIFEN-010 section 10:
 *   1. The `<ds:Signature>` element MUST be a SIBLING of `<DE>` inside
 *      `<rDE>` (location action: "after"), NOT a child of `<DE>`. Placing
 *      Signature inside DE triggers "0140 XML no tiene firma".
 *   2. The Reference MUST target the DE's `Id` attribute (= CDC). The URI
 *      must be `#${CDC}` with the hash prefix, and idAttribute must be set
 *      so xml-crypto resolves the Id correctly.
 *   3. `<ds:KeyInfo>` with `<ds:X509Data><ds:X509Certificate>` is required.
 *      In xml-crypto v6 this is produced by providing `publicCert` +
 *      `getKeyInfoContent`. The legacy `keyInfoProvider` path was removed
 *      in v6.
 */

import { SignedXml } from 'xml-crypto';

/**
 * Sign an XML document using an enveloped RSA-SHA256 signature.
 *
 * @param xml           The unsigned XML string emitted by xmlgen. Must
 *                      contain `<rDE><DE Id="<CDC>">...</DE></rDE>`.
 * @param privateKeyPem RSA private key in PEM format (decrypted in memory,
 *                      never persisted).
 * @param certPem       X.509 certificate in PEM format.
 * @returns             The signed XML string (Signature placed after DE
 *                      inside rDE, with KeyInfo/X509Data/X509Certificate).
 */
export async function signXML(
  xml: string,
  privateKeyPem: string,
  certPem: string,
): Promise<string> {
  // Extract the base64 body of the certificate so we can embed it inside
  // KeyInfo/X509Data. xml-crypto can also derive this from `publicCert` via
  // its default `getKeyInfoContent`, but we supply our own for determinism
  // and to guarantee a single cert is emitted even if the PEM has multiple.
  const certBase64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\r?\n/g, '')
    .trim();

  // Extract CDC (44 digits) from <DE Id="..."> so we can build a fragment
  // URI. xml-crypto will use this URI verbatim in SignedInfo/Reference.
  const idMatch = xml.match(/<DE[^>]*\bId\s*=\s*"(\d{44})"/);
  const referenceUri = idMatch ? `#${idMatch[1]}` : '';

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    idAttribute: 'Id',
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='DE']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    uri: referenceUri,
  });

  // Signature is a sibling of DE inside rDE, not a child of DE.
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='DE']", action: 'after' },
  });

  return sig.getSignedXml();
}

/**
 * Parse a .p12 (PKCS#12) buffer and extract private key + X.509 certificate
 * as PEM. Used once during certificate upload. The password and buffer are
 * discarded immediately after this call.
 */
export async function extractPemsFromP12(
  p12Buffer: Buffer,
  password: string,
): Promise<{ privateKeyPem: string; certPem: string }> {
  const forge = (await import('node-forge')).default ?? (await import('node-forge'));

  try {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
    if (!keyBag || keyBag.length === 0 || !keyBag[0].key) {
      throw new Error('No se encontró clave privada en el archivo .p12');
    }
    const privateKeyPem = forge.pki.privateKeyToPem(keyBag[0].key);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag];
    if (!certBag || certBag.length === 0 || !certBag[0].cert) {
      throw new Error('No se encontró certificado en el archivo .p12');
    }
    const certPem = forge.pki.certificateToPem(certBag[0].cert);

    return { privateKeyPem, certPem };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (
      msg.includes('Invalid password') ||
      msg.includes('PKCS#12 MAC') ||
      msg.includes('bad decrypt')
    ) {
      throw new Error('Contraseña del certificado incorrecta');
    }
    if (
      msg.includes('No se encontró clave privada') ||
      msg.includes('No se encontró certificado')
    ) {
      throw err;
    }
    throw new Error(
      'Error al procesar el certificado .p12. Verifique que el archivo y la contraseña sean correctos.',
    );
  }
}
