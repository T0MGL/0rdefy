// ================================================================
// QR CODE GENERATOR UTILITY
// ================================================================
// Generates QR codes for order delivery tracking
// ================================================================

import QRCode from 'qrcode';

/**
 * Generate a QR code data URL for a delivery link
 * @param deliveryToken - The unique delivery token for the order
 * @param baseUrl - Base URL of the application (default: localhost)
 * @returns Promise<string> - Data URL of the generated QR code
 */
export async function generateDeliveryQRCode(
  deliveryToken: string,
  baseUrl: string = process.env.FRONTEND_URL || 'http://localhost:8080'
): Promise<string> {
  try {
    const deliveryUrl = `${baseUrl}/delivery/${deliveryToken}`;

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(deliveryUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    return qrCodeDataUrl;
  } catch (error) {
    console.error('[QR Generator] Error generating QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Generate a QR code as a buffer (for saving to file storage)
 * @param deliveryToken - The unique delivery token for the order
 * @param baseUrl - Base URL of the application
 * @returns Promise<Buffer> - Buffer of the QR code image
 */
export async function generateDeliveryQRCodeBuffer(
  deliveryToken: string,
  baseUrl: string = process.env.FRONTEND_URL || 'http://localhost:8080'
): Promise<Buffer> {
  try {
    const deliveryUrl = `${baseUrl}/delivery/${deliveryToken}`;

    // Generate QR code as buffer
    const buffer = await QRCode.toBuffer(deliveryUrl, {
      errorCorrectionLevel: 'M',
      type: 'png',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    return buffer;
  } catch (error) {
    console.error('[QR Generator] Error generating QR code buffer:', error);
    throw new Error('Failed to generate QR code buffer');
  }
}

/**
 * Generate a QR code as SVG string
 * @param deliveryToken - The unique delivery token for the order
 * @param baseUrl - Base URL of the application
 * @returns Promise<string> - SVG string of the QR code
 */
export async function generateDeliveryQRCodeSVG(
  deliveryToken: string,
  baseUrl: string = process.env.FRONTEND_URL || 'http://localhost:8080'
): Promise<string> {
  try {
    const deliveryUrl = `${baseUrl}/delivery/${deliveryToken}`;

    // Generate QR code as SVG
    const svg = await QRCode.toString(deliveryUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    return svg;
  } catch (error) {
    console.error('[QR Generator] Error generating QR code SVG:', error);
    throw new Error('Failed to generate QR code SVG');
  }
}
