/**
 * XML Digital Signature for SIFEN
 *
 * Signs XML documents with RSA-SHA256 enveloped signature.
 * Uses node-forge to parse .p12 certificates and xml-crypto for signing.
 * No Java dependency required.
 */

import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/**
 * Parse a .p12 (PKCS#12) certificate buffer and extract private key + X.509 cert.
 * Wraps in try/catch to sanitize errors (never expose cert password in stack traces).
 */
function parseCertificate(p12Buffer: Buffer, password: string): { privateKeyPem: string; certPem: string } {
  try {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Extract private key
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
    if (!keyBag || keyBag.length === 0 || !keyBag[0].key) {
      throw new Error('No private key found in certificate');
    }
    const privateKeyPem = forge.pki.privateKeyToPem(keyBag[0].key);

    // Extract X.509 certificate
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag];
    if (!certBag || certBag.length === 0 || !certBag[0].cert) {
      throw new Error('No certificate found in .p12 file');
    }
    const certPem = forge.pki.certificateToPem(certBag[0].cert);

    return { privateKeyPem, certPem };
  } catch (err: any) {
    // Sanitize: never expose the password in error messages/stack traces
    const msg = err.message || '';
    if (msg.includes('Invalid password') || msg.includes('PKCS#12 MAC') || msg.includes('bad decrypt')) {
      throw new Error('Contraseña del certificado incorrecta');
    }
    if (msg.includes('No private key') || msg.includes('No certificate')) {
      throw new Error(msg); // These are safe to expose
    }
    throw new Error('Error al procesar el certificado .p12. Verifique que el archivo y la contraseña sean correctos.');
  }
}

/**
 * Sign an XML document using enveloped RSA-SHA256 signature.
 *
 * @param xml - The unsigned XML string
 * @param certBuffer - The .p12 certificate file as Buffer
 * @param password - The certificate password
 * @returns The signed XML string
 */
export async function signXML(xml: string, certBuffer: Buffer, password: string): Promise<string> {
  const { privateKeyPem, certPem } = parseCertificate(certBuffer, password);

  // Clean PEM for embedding in KeyInfo
  const cleanCert = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\r?\n/g, '');

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });

  // Reference to the DE element with enveloped signature transform
  sig.addReference({
    xpath: "//*[local-name(.)='DE']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  // Add KeyInfo with X509 certificate
  sig.keyInfoProvider = {
    getKeyInfo(): string {
      return `<X509Data><X509Certificate>${cleanCert}</X509Certificate></X509Data>`;
    },
  } as any;

  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='DE']", action: 'append' },
  });

  return sig.getSignedXml();
}
