/**
 * Email Service - Resend Integration
 *
 * Handles all transactional emails for Ordefy:
 * - Collaborator invitations
 * - Password reset
 * - Order confirmations (future)
 * - Trial expiration reminders (future)
 *
 * @author Bright Idea
 * @date 2026-01-15
 */

import { Resend } from 'resend';

// Lazy-initialized Resend client (only created when API key exists)
let resendClient: Resend | null = null;

const getResendClient = (): Resend | null => {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

// Email configuration
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Ordefy <noreply@ordefy.io>';
const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ordefy.io';

// Check if email is enabled
const isEmailEnabled = (): boolean => {
  return !!process.env.RESEND_API_KEY;
};

// ================================================================
// EMAIL TEMPLATES
// ================================================================

interface CollaboratorInviteData {
  inviteeName: string;
  inviterName: string;
  storeName: string;
  role: string;
  inviteLink: string;
  expiresAt: Date;
}

interface PasswordResetData {
  userName: string;
  resetLink: string;
  expiresInMinutes: number;
}

interface WelcomeEmailData {
  userName: string;
  storeName: string;
}

// ================================================================
// EMAIL FUNCTIONS
// ================================================================

/**
 * Send collaborator invitation email
 */
export async function sendCollaboratorInvite(
  to: string,
  data: CollaboratorInviteData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailEnabled()) {
    logger.info('BACKEND', '📧 [EMAIL] Resend not configured, skipping email to:', to);
    return { success: true, messageId: 'skipped-no-api-key' };
  }

  const roleLabels: Record<string, string> = {
    owner: 'Propietario',
    admin: 'Administrador',
    logistics: 'Logística',
    confirmador: 'Confirmador',
    contador: 'Contador',
    inventario: 'Inventario'
  };

  const roleLabel = roleLabels[data.role] || data.role;
  const expiresFormatted = data.expiresAt.toLocaleDateString('es-PY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  try {
    const { data: result, error } = await getResendClient()!.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `${data.inviterName} te invitó a ${data.storeName} en Ordefy`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #8b5cf6; margin: 0; font-size: 28px;">Ordefy</h1>
          </div>

          <div style="background: #f9fafb; border-radius: 12px; padding: 30px; margin-bottom: 20px;">
            <h2 style="margin: 0 0 20px 0; color: #1f2937;">¡Hola ${data.inviteeName}!</h2>

            <p style="margin: 0 0 15px 0;">
              <strong>${data.inviterName}</strong> te ha invitado a unirte al equipo de
              <strong>${data.storeName}</strong> en Ordefy como <strong>${roleLabel}</strong>.
            </p>

            <p style="margin: 0 0 25px 0;">
              Ordefy es una plataforma de gestión de e-commerce que te ayudará a administrar
              pedidos, inventario, envíos y más.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.inviteLink}"
                 style="background: #8b5cf6; color: white; padding: 14px 32px;
                        border-radius: 8px; text-decoration: none; font-weight: 600;
                        display: inline-block;">
                Aceptar Invitación
              </a>
            </div>

            <p style="margin: 0; font-size: 14px; color: #6b7280;">
              Este enlace expira el ${expiresFormatted}.
            </p>
          </div>

          <p style="font-size: 12px; color: #9ca3af; text-align: center;">
            Si no esperabas esta invitación, puedes ignorar este email.
            <br>
            © ${new Date().getFullYear()} Ordefy by Bright Idea
          </p>
        </body>
        </html>
      `,
      text: `
¡Hola ${data.inviteeName}!

${data.inviterName} te ha invitado a unirte al equipo de ${data.storeName} en Ordefy como ${roleLabel}.

Haz clic en el siguiente enlace para aceptar la invitación:
${data.inviteLink}

Este enlace expira el ${expiresFormatted}.

Si no esperabas esta invitación, puedes ignorar este email.

© ${new Date().getFullYear()} Ordefy by Bright Idea
      `.trim()
    });

    if (error) {
      logger.error('BACKEND', '❌ [EMAIL] Resend error:', error);
      return { success: false, error: error.message };
    }

    logger.info('BACKEND', '✅ [EMAIL] Invitation sent to:', to, 'messageId:', result?.id);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    logger.error('BACKEND', '❌ [EMAIL] Exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordReset(
  to: string,
  data: PasswordResetData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailEnabled()) {
    logger.info('BACKEND', '📧 [EMAIL] Resend not configured, skipping password reset to:', to);
    return { success: true, messageId: 'skipped-no-api-key' };
  }

  try {
    const { data: result, error } = await getResendClient()!.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: 'Restablecer tu contraseña - Ordefy',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #8b5cf6; margin: 0; font-size: 28px;">Ordefy</h1>
          </div>

          <div style="background: #f9fafb; border-radius: 12px; padding: 30px; margin-bottom: 20px;">
            <h2 style="margin: 0 0 20px 0; color: #1f2937;">Restablecer Contraseña</h2>

            <p style="margin: 0 0 15px 0;">
              Hola ${data.userName},
            </p>

            <p style="margin: 0 0 25px 0;">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta en Ordefy.
              Haz clic en el botón de abajo para crear una nueva contraseña.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.resetLink}"
                 style="background: #8b5cf6; color: white; padding: 14px 32px;
                        border-radius: 8px; text-decoration: none; font-weight: 600;
                        display: inline-block;">
                Restablecer Contraseña
              </a>
            </div>

            <p style="margin: 0; font-size: 14px; color: #6b7280;">
              Este enlace expira en ${data.expiresInMinutes} minutos.
            </p>
          </div>

          <p style="font-size: 12px; color: #9ca3af; text-align: center;">
            Si no solicitaste restablecer tu contraseña, puedes ignorar este email.
            <br>
            © ${new Date().getFullYear()} Ordefy by Bright Idea
          </p>
        </body>
        </html>
      `,
      text: `
Restablecer Contraseña

Hola ${data.userName},

Recibimos una solicitud para restablecer la contraseña de tu cuenta en Ordefy.

Haz clic en el siguiente enlace para crear una nueva contraseña:
${data.resetLink}

Este enlace expira en ${data.expiresInMinutes} minutos.

Si no solicitaste restablecer tu contraseña, puedes ignorar este email.

© ${new Date().getFullYear()} Ordefy by Bright Idea
      `.trim()
    });

    if (error) {
      logger.error('BACKEND', '❌ [EMAIL] Resend error:', error);
      return { success: false, error: error.message };
    }

    logger.info('BACKEND', '✅ [EMAIL] Password reset sent to:', to, 'messageId:', result?.id);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    logger.error('BACKEND', '❌ [EMAIL] Exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send welcome email after registration
 */
export async function sendWelcomeEmail(
  to: string,
  data: WelcomeEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isEmailEnabled()) {
    logger.info('BACKEND', '📧 [EMAIL] Resend not configured, skipping welcome email to:', to);
    return { success: true, messageId: 'skipped-no-api-key' };
  }

  try {
    const { data: result, error } = await getResendClient()!.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `¡Bienvenido a Ordefy, ${data.userName}!`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #8b5cf6; margin: 0; font-size: 28px;">Ordefy</h1>
          </div>

          <div style="background: #f9fafb; border-radius: 12px; padding: 30px; margin-bottom: 20px;">
            <h2 style="margin: 0 0 20px 0; color: #1f2937;">¡Bienvenido a Ordefy! 🎉</h2>

            <p style="margin: 0 0 15px 0;">
              Hola ${data.userName},
            </p>

            <p style="margin: 0 0 15px 0;">
              Tu tienda <strong>${data.storeName}</strong> está lista.
              Estamos emocionados de tenerte en Ordefy.
            </p>

            <p style="margin: 0 0 25px 0;">
              <strong>Próximos pasos:</strong>
            </p>

            <ul style="margin: 0 0 25px 0; padding-left: 20px;">
              <li>Configura tu primera transportadora</li>
              <li>Agrega tus productos o conecta Shopify</li>
              <li>Crea tu primer pedido</li>
            </ul>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${APP_URL}"
                 style="background: #8b5cf6; color: white; padding: 14px 32px;
                        border-radius: 8px; text-decoration: none; font-weight: 600;
                        display: inline-block;">
                Ir a Ordefy
              </a>
            </div>
          </div>

          <p style="font-size: 12px; color: #9ca3af; text-align: center;">
            ¿Necesitas ayuda? Responde a este email.
            <br>
            © ${new Date().getFullYear()} Ordefy by Bright Idea
          </p>
        </body>
        </html>
      `,
      text: `
¡Bienvenido a Ordefy! 🎉

Hola ${data.userName},

Tu tienda ${data.storeName} está lista. Estamos emocionados de tenerte en Ordefy.

Próximos pasos:
- Configura tu primera transportadora
- Agrega tus productos o conecta Shopify
- Crea tu primer pedido

Ir a Ordefy: ${APP_URL}

¿Necesitas ayuda? Responde a este email.

© ${new Date().getFullYear()} Ordefy by Bright Idea
      `.trim()
    });

    if (error) {
      logger.error('BACKEND', '❌ [EMAIL] Resend error:', error);
      return { success: false, error: error.message };
    }

    logger.info('BACKEND', '✅ [EMAIL] Welcome email sent to:', to, 'messageId:', result?.id);
    return { success: true, messageId: result?.id };
  } catch (err: any) {
    logger.error('BACKEND', '❌ [EMAIL] Exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check if email service is configured
 */
export function isConfigured(): boolean {
  return isEmailEnabled();
}

export default {
  sendCollaboratorInvite,
  sendPasswordReset,
  sendWelcomeEmail,
  isConfigured
};
