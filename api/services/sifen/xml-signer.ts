/**
 * XML Digital Signature for SIFEN
 *
 * Signs XML documents with RSA-SHA256 enveloped signature.
 * Accepts pre-extracted PEM strings (private key + certificate).
 * The .p12 file and its password are never accepted or persisted here.
 */

import { SignedXml } from 'xml-crypto';

/**
 * Sign an XML document using an enveloped RSA-SHA256 signature.
 *
 * @param xml          - The unsigned XML string
 * @param privateKeyPem - RSA private key in PEM format (decrypted in memory, not stored)
 * @param certPem       - X.509 certificate in PEM format
 * @returns The signed XML string
 */
export async function signXML(
  xml: string,
  privateKeyPem: string,
  certPem: string,
): Promise<string> {
  const cleanCert = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\r?\n/g, '');

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });

  sig.addReference({
    xpath: "//*[local-name(.)='DE']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  (sig as unknown as { keyInfoProvider: { getKeyInfo(): string } }).keyInfoProvider = {
    getKeyInfo(): string {
      return `<X509Data><X509Certificate>${cleanCert}</X509Certificate></X509Data>`;
    },
  };

  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='DE']", action: 'append' },
  });

  return sig.getSignedXml();
}

/**
 * Parse a .p12 (PKCS#12) buffer and extract private key + X.509 certificate as PEM.
 * Used once during setup. The password and .p12 buffer are discarded after this call.
 */
export function extractPemsFromP12(
  p12Buffer: Buffer,
  password: string,
): { privateKeyPem: string; certPem: string } {
  // Lazy import: node-forge is only needed at certificate setup time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const forge = require('node-forge') as typeof import('node-forge');

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
