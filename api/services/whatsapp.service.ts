/**
 * WhatsApp Verification Service
 * Uses Meta WhatsApp Business API to send verification codes
 *
 * SETUP INSTRUCTIONS:
 * 1. Create Meta Business Account: https://business.facebook.com
 * 2. Set up WhatsApp Business API: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
 * 3. Get Phone Number ID and Access Token from Meta Business Dashboard
 * 4. Add to .env:
 *    WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
 *    WHATSAPP_ACCESS_TOKEN=your_access_token
 *    WHATSAPP_VERIFICATION_ENABLED=false  (set to true when ready)
 */

import { logger } from '../utils/logger';
interface WhatsAppMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

class WhatsAppService {
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly enabled: boolean;
  private readonly apiUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.enabled = process.env.WHATSAPP_VERIFICATION_ENABLED === 'true';

    if (this.enabled && (!this.phoneNumberId || !this.accessToken)) {
      logger.warn('BACKEND', '⚠️  WhatsApp verification is enabled but credentials are missing');
    }
  }

  /**
   * Send verification code via WhatsApp
   */
  async sendVerificationCode(phone: string, code: string): Promise<boolean> {
    if (!this.enabled) {
      logger.info('BACKEND', `📱 [DEMO MODE] Verification code for ${phone}: ${code}`);
      return true; // In demo mode, always succeed
    }

    try {
      const message = this.buildVerificationMessage(code);
      const response = await this.sendMessage(phone, message);

      logger.info('BACKEND', `✅ Verification code sent to ${phone} via WhatsApp`);
      return true;
    } catch (error) {
      logger.error('BACKEND', '❌ Error sending WhatsApp verification code:', error);
      throw new Error('Error al enviar código de verificación por WhatsApp');
    }
  }

  /**
   * Build verification message
   */
  private buildVerificationMessage(code: string): string {
    return `🔐 *Ordefy - Código de Verificación*\n\n` +
           `Tu código de verificación es:\n\n` +
           `*${code}*\n\n` +
           `Este código expira en 10 minutos.\n\n` +
           `Si no solicitaste este código, ignora este mensaje.`;
  }

  /**
   * Send WhatsApp message using Meta Cloud API
   */
  private async sendMessage(phone: string, text: string): Promise<WhatsAppMessageResponse> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    // Clean phone number (remove +, spaces, dashes)
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'text',
      text: { body: text }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`WhatsApp API Error: ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  /**
   * Send account recovery message
   */
  async sendAccountRecoveryMessage(phone: string, email: string): Promise<boolean> {
    if (!this.enabled) {
      logger.info('BACKEND', `📱 [DEMO MODE] Recovery message for ${phone}: Account exists with email ${email}`);
      return true;
    }

    try {
      const message = `🔐 *Ordefy - Cuenta Existente*\n\n` +
                     `Este número de teléfono ya está registrado con la cuenta:\n\n` +
                     `📧 ${email}\n\n` +
                     `Si olvidaste tu contraseña, puedes recuperarla desde la pantalla de inicio de sesión.\n\n` +
                     `Si no reconoces esta cuenta, contacta a soporte.`;

      await this.sendMessage(phone, message);
      logger.info('BACKEND', `✅ Account recovery message sent to ${phone}`);
      return true;
    } catch (error) {
      logger.error('BACKEND', '❌ Error sending account recovery message:', error);
      return false;
    }
  }

  /**
   * Check if WhatsApp verification is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

export default new WhatsAppService();
