/**
 * Ordefy Email Template System
 *
 * Reusable, branded HTML email templates.
 * All emails share a single base layout (header, footer, branding).
 * Individual templates only define their content block.
 *
 * Brand tokens (from the app design system):
 *   Primary (lime green): #b0e636
 *   Dark bg: #131318
 *   Card bg: #1c1d22
 *   Card border: #2a2b33
 *   Text primary: #f2f2f2
 *   Text secondary: #9ca3af
 *   Text muted: #6b7280
 */

const BRAND = {
  primary: '#b0e636',
  primaryDark: '#9acd2e',
  bg: '#131318',
  card: '#1c1d22',
  cardBorder: '#2a2b33',
  text: '#f2f2f2',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  white: '#ffffff',
  divider: '#2a2b33',
  footerBg: '#0e0e12',
} as const;

const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ordefy.io';
const CURRENT_YEAR = new Date().getFullYear();

interface BaseLayoutOptions {
  preheader: string;
  content: string;
}

function baseLayout({ preheader, content }: BaseLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>Ordefy</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    :root { color-scheme: dark light; supported-color-schemes: dark light; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; padding: 0 16px !important; }
      .content-cell { padding: 28px 20px !important; }
      .btn-cell a { display: block !important; width: 100% !important; padding: 16px 24px !important; }
      .header-cell { padding: 24px 20px !important; }
      .footer-cell { padding: 20px 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <!-- Preheader (hidden preview text) -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader}
    ${'&#847; &zwnj; &nbsp; '.repeat(20)}
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${BRAND.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px 20px;">

        <!-- Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="container" style="max-width: 560px; width: 100%;">

          <!-- Logo header -->
          <tr>
            <td class="header-cell" align="center" style="padding: 0 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size: 28px; font-weight: 700; letter-spacing: -0.5px; color: ${BRAND.white};">
                    <span style="color: ${BRAND.primary};">O</span>rdefy
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${BRAND.card}; border: 1px solid ${BRAND.cardBorder}; border-radius: 12px;">
                <tr>
                  <td class="content-cell" style="padding: 40px 36px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="footer-cell" style="padding: 28px 0 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding: 0 0 16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding: 0 12px;">
                          <a href="${APP_URL}" style="color: ${BRAND.textMuted}; text-decoration: none; font-size: 12px;">App</a>
                        </td>
                        <td style="color: ${BRAND.divider}; font-size: 12px;">|</td>
                        <td style="padding: 0 12px;">
                          <a href="https://ordefy.io" style="color: ${BRAND.textMuted}; text-decoration: none; font-size: 12px;">Sitio web</a>
                        </td>
                        <td style="color: ${BRAND.divider}; font-size: 12px;">|</td>
                        <td style="padding: 0 12px;">
                          <a href="mailto:soporte@ordefy.io" style="color: ${BRAND.textMuted}; text-decoration: none; font-size: 12px;">Soporte</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-size: 11px; color: ${BRAND.textMuted}; line-height: 1.5; padding: 0 0 8px;">
                    &copy; ${CURRENT_YEAR} Ordefy by Bright Idea. Todos los derechos reservados.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 700; color: ${BRAND.white}; line-height: 1.3;">${text}</h1>`;
}

function subheading(text: string): string {
  return `<p style="margin: 0 0 24px; font-size: 14px; color: ${BRAND.textSecondary}; line-height: 1.5;">${text}</p>`;
}

function paragraph(text: string): string {
  return `<p style="margin: 0 0 16px; font-size: 15px; color: ${BRAND.text}; line-height: 1.6;">${text}</p>`;
}

function ctaButton(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 28px 0;">
  <tr>
    <td align="center" class="btn-cell">
      <a href="${href}" style="display: inline-block; background-color: ${BRAND.primary}; color: ${BRAND.bg}; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; letter-spacing: -0.2px; mso-padding-alt: 14px 32px;">${text}</a>
    </td>
  </tr>
</table>`;
}

function secondaryButton(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 12px 0;">
  <tr>
    <td align="center">
      <a href="${href}" style="display: inline-block; border: 1px solid ${BRAND.cardBorder}; color: ${BRAND.text}; font-size: 14px; font-weight: 500; text-decoration: none; padding: 10px 24px; border-radius: 8px;">${text}</a>
    </td>
  </tr>
</table>`;
}

function divider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0;">
  <tr><td style="border-top: 1px solid ${BRAND.divider};"></td></tr>
</table>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
  <td style="padding: 8px 0; font-size: 13px; color: ${BRAND.textMuted}; white-space: nowrap; vertical-align: top; width: 120px;">${label}</td>
  <td style="padding: 8px 0 8px 12px; font-size: 14px; color: ${BRAND.text}; font-weight: 500;">${value}</td>
</tr>`;
}

function infoTable(rows: Array<{ label: string; value: string }>): string {
  const inner = rows.map((r) => infoRow(r.label, r.value)).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0; background-color: ${BRAND.bg}; border-radius: 8px; padding: 4px 16px;">
  ${inner}
</table>`;
}

function badge(text: string, color?: string): string {
  const bg = color || BRAND.primary;
  const fg = color ? BRAND.white : BRAND.bg;
  return `<span style="display: inline-block; background-color: ${bg}; color: ${fg}; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${text}</span>`;
}

function smallText(text: string): string {
  return `<p style="margin: 0; font-size: 12px; color: ${BRAND.textMuted}; line-height: 1.5;">${text}</p>`;
}

function linkText(text: string, href: string): string {
  return `<a href="${href}" style="color: ${BRAND.primary}; text-decoration: none; font-weight: 500;">${text}</a>`;
}

function stepItem(number: number, text: string): string {
  return `<tr>
  <td style="width: 32px; vertical-align: top; padding: 6px 0;">
    <div style="width: 24px; height: 24px; border-radius: 50%; background-color: ${BRAND.primary}; color: ${BRAND.bg}; font-size: 12px; font-weight: 700; text-align: center; line-height: 24px;">${number}</div>
  </td>
  <td style="padding: 6px 0 6px 12px; font-size: 14px; color: ${BRAND.text}; line-height: 1.5;">${text}</td>
</tr>`;
}

function stepsList(steps: string[]): string {
  const inner = steps.map((s, i) => stepItem(i + 1, s)).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
  ${inner}
</table>`;
}

// ================================================================
// TEMPLATE: Welcome
// ================================================================

export interface WelcomeTemplateData {
  userName: string;
  storeName: string;
}

export function welcomeTemplate(data: WelcomeTemplateData): { html: string; text: string; subject: string } {
  const content = [
    heading(`Bienvenido a Ordefy, ${data.userName}`),
    subheading(`Tu tienda "${data.storeName}" esta lista para operar.`),
    paragraph('Ordefy es la plataforma que centraliza pedidos, inventario, envios y facturacion para que puedas escalar tu e-commerce sin perder el control.'),
    stepsList([
      'Configura tu primera transportadora para habilitar envios',
      'Agrega productos manualmente o conecta tu tienda Shopify',
      'Crea tu primer pedido y genera una guia de envio',
    ]),
    ctaButton('Ir a mi tienda', APP_URL),
    divider(),
    smallText('Si necesitas ayuda en cualquier momento, responde a este correo o escribe a soporte@ordefy.io.'),
  ].join('');

  return {
    subject: `Bienvenido a Ordefy, ${data.userName}`,
    html: baseLayout({ preheader: `Tu tienda "${data.storeName}" esta lista. Empieza a gestionar pedidos hoy.`, content }),
    text: `Bienvenido a Ordefy, ${data.userName}\n\nTu tienda "${data.storeName}" esta lista para operar.\n\nOrdefy centraliza pedidos, inventario, envios y facturacion para escalar tu e-commerce.\n\nPrimeros pasos:\n1. Configura tu primera transportadora\n2. Agrega productos o conecta Shopify\n3. Crea tu primer pedido\n\nIr a tu tienda: ${APP_URL}\n\nSoporte: soporte@ordefy.io\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Email Verification
// ================================================================

export interface EmailVerificationTemplateData {
  userName: string;
  verificationLink: string;
  expiresInMinutes: number;
}

export function emailVerificationTemplate(data: EmailVerificationTemplateData): { html: string; text: string; subject: string } {
  const content = [
    heading('Verifica tu correo electronico'),
    subheading('Un paso mas para activar tu cuenta.'),
    paragraph(`Hola ${data.userName}, confirma tu direccion de correo haciendo clic en el boton de abajo.`),
    ctaButton('Verificar correo', data.verificationLink),
    divider(),
    smallText(`Este enlace expira en ${data.expiresInMinutes} minutos. Si no creaste una cuenta en Ordefy, ignora este mensaje.`),
  ].join('');

  return {
    subject: 'Verifica tu correo en Ordefy',
    html: baseLayout({ preheader: 'Confirma tu correo para activar tu cuenta en Ordefy.', content }),
    text: `Verifica tu correo electronico\n\nHola ${data.userName}, confirma tu direccion de correo:\n${data.verificationLink}\n\nEste enlace expira en ${data.expiresInMinutes} minutos.\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Password Reset
// ================================================================

export interface PasswordResetTemplateData {
  userName: string;
  resetLink: string;
  expiresInMinutes: number;
}

export function passwordResetTemplate(data: PasswordResetTemplateData): { html: string; text: string; subject: string } {
  const content = [
    heading('Restablecer contrasena'),
    subheading('Recibimos una solicitud para cambiar tu contrasena.'),
    paragraph(`Hola ${data.userName}, haz clic en el boton para crear una nueva contrasena. Si no solicitaste este cambio, puedes ignorar este correo.`),
    ctaButton('Restablecer contrasena', data.resetLink),
    divider(),
    smallText(`Este enlace expira en ${data.expiresInMinutes} minutos. Por seguridad, no compartas este enlace con nadie.`),
  ].join('');

  return {
    subject: 'Restablecer contrasena en Ordefy',
    html: baseLayout({ preheader: 'Solicitud de cambio de contrasena para tu cuenta Ordefy.', content }),
    text: `Restablecer contrasena\n\nHola ${data.userName}, haz clic para crear una nueva contrasena:\n${data.resetLink}\n\nExpira en ${data.expiresInMinutes} minutos.\nSi no solicitaste esto, ignora este correo.\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Collaborator Invitation
// ================================================================

export interface CollaboratorInviteTemplateData {
  inviteeName: string;
  inviterName: string;
  storeName: string;
  role: string;
  inviteLink: string;
  expiresAt: Date;
}

export function collaboratorInviteTemplate(data: CollaboratorInviteTemplateData): { html: string; text: string; subject: string } {
  const roleLabels: Record<string, string> = {
    owner: 'Propietario',
    admin: 'Administrador',
    logistics: 'Logistica',
    confirmador: 'Confirmador',
    contador: 'Contador',
    inventario: 'Inventario',
  };
  const roleLabel = roleLabels[data.role] || data.role;
  const expiresFormatted = data.expiresAt.toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' });

  const content = [
    heading('Te invitaron al equipo'),
    subheading(`${data.inviterName} quiere que te unas a "${data.storeName}".`),
    paragraph(`Hola ${data.inviteeName}, fuiste invitado a colaborar en la tienda <strong>${data.storeName}</strong> en Ordefy.`),
    infoTable([
      { label: 'Tienda', value: data.storeName },
      { label: 'Rol', value: roleLabel },
      { label: 'Invitado por', value: data.inviterName },
    ]),
    ctaButton('Aceptar invitacion', data.inviteLink),
    divider(),
    smallText(`Esta invitacion expira el ${expiresFormatted}. Si no esperabas esta invitacion, ignora este correo.`),
  ].join('');

  return {
    subject: `${data.inviterName} te invito a ${data.storeName} en Ordefy`,
    html: baseLayout({ preheader: `Fuiste invitado como ${roleLabel} en "${data.storeName}". Acepta la invitacion.`, content }),
    text: `Te invitaron al equipo\n\nHola ${data.inviteeName},\n\n${data.inviterName} te invito a colaborar en "${data.storeName}" como ${roleLabel}.\n\nAcepta aqui: ${data.inviteLink}\n\nExpira el ${expiresFormatted}.\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Trial Starting
// ================================================================

export interface TrialStartTemplateData {
  userName: string;
  planName: string;
  trialDays: number;
  trialEndsAt: string;
}

export function trialStartTemplate(data: TrialStartTemplateData): { html: string; text: string; subject: string } {
  const content = [
    heading('Tu periodo de prueba comenzo'),
    subheading(`${data.trialDays} dias gratis del plan ${data.planName}.`),
    paragraph(`Hola ${data.userName}, tu prueba gratuita del plan <strong>${data.planName}</strong> esta activa. Tienes acceso completo a todas las funcionalidades durante ${data.trialDays} dias.`),
    infoTable([
      { label: 'Plan', value: data.planName },
      { label: 'Duracion', value: `${data.trialDays} dias` },
      { label: 'Finaliza', value: data.trialEndsAt },
    ]),
    paragraph('Aprovecha este periodo para configurar tu tienda, conectar integraciones y explorar todo lo que Ordefy ofrece.'),
    ctaButton('Explorar Ordefy', APP_URL),
    divider(),
    smallText('No se realizara ningun cobro durante el periodo de prueba. Te avisaremos antes de que termine.'),
  ].join('');

  return {
    subject: `Tu prueba gratuita de ${data.trialDays} dias comenzo`,
    html: baseLayout({ preheader: `Tienes ${data.trialDays} dias gratis del plan ${data.planName}. Explora todo lo que Ordefy ofrece.`, content }),
    text: `Tu periodo de prueba comenzo\n\nHola ${data.userName}, tu prueba del plan ${data.planName} esta activa por ${data.trialDays} dias.\nFinaliza: ${data.trialEndsAt}\n\nExplorar: ${APP_URL}\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Trial Ending Reminder
// ================================================================

export interface TrialEndingTemplateData {
  userName: string;
  planName: string;
  daysRemaining: number;
  upgradeLink: string;
}

export function trialEndingTemplate(data: TrialEndingTemplateData): { html: string; text: string; subject: string } {
  const urgency = data.daysRemaining <= 1 ? 'Ultimo dia' : `${data.daysRemaining} dias restantes`;

  const content = [
    heading('Tu prueba esta por terminar'),
    subheading(`${urgency} del plan ${data.planName}.`),
    paragraph(`Hola ${data.userName}, tu periodo de prueba gratuito finaliza en <strong>${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}</strong>. Para seguir usando todas las funcionalidades, activa tu suscripcion.`),
    paragraph('Al activar tu plan conservas toda tu configuracion, datos de pedidos, productos y equipo intactos.'),
    ctaButton('Activar plan', data.upgradeLink),
    secondaryButton('Comparar planes', `${APP_URL}/billing`),
    divider(),
    smallText('Si decides no continuar, tu cuenta pasara al plan gratuito con funcionalidades limitadas. Tus datos se conservan.'),
  ].join('');

  return {
    subject: `Tu prueba gratuita termina en ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}`,
    html: baseLayout({ preheader: `Quedan ${data.daysRemaining} dias de tu prueba del plan ${data.planName}. Activa tu suscripcion.`, content }),
    text: `Tu prueba esta por terminar\n\nHola ${data.userName}, quedan ${data.daysRemaining} dias de tu prueba del plan ${data.planName}.\n\nActivar: ${data.upgradeLink}\nComparar planes: ${APP_URL}/billing\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Plan Upgrade Confirmation
// ================================================================

export interface PlanUpgradeTemplateData {
  userName: string;
  previousPlan: string;
  newPlan: string;
  amount: string;
  billingCycle: string;
  nextBillingDate: string;
}

export function planUpgradeTemplate(data: PlanUpgradeTemplateData): { html: string; text: string; subject: string } {
  const content = [
    heading('Plan actualizado'),
    subheading(`Cambiaste a ${data.newPlan}. Ya tienes acceso a todas las nuevas funcionalidades.`),
    paragraph(`Hola ${data.userName}, tu suscripcion fue actualizada exitosamente.`),
    infoTable([
      { label: 'Plan anterior', value: data.previousPlan },
      { label: 'Nuevo plan', value: `${data.newPlan} ${badge(data.newPlan)}` },
      { label: 'Monto', value: data.amount },
      { label: 'Ciclo', value: data.billingCycle },
      { label: 'Proximo cobro', value: data.nextBillingDate },
    ]),
    ctaButton('Ir a mi tienda', APP_URL),
    divider(),
    smallText('Puedes gestionar tu suscripcion en cualquier momento desde Configuracion > Facturacion.'),
  ].join('');

  return {
    subject: `Plan actualizado a ${data.newPlan}`,
    html: baseLayout({ preheader: `Tu plan fue actualizado a ${data.newPlan}. Accede a todas las nuevas funcionalidades.`, content }),
    text: `Plan actualizado\n\nHola ${data.userName}, tu plan fue actualizado de ${data.previousPlan} a ${data.newPlan}.\nMonto: ${data.amount} (${data.billingCycle})\nProximo cobro: ${data.nextBillingDate}\n\n${APP_URL}\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Plan Downgrade / Cancellation
// ================================================================

export interface PlanCancellationTemplateData {
  userName: string;
  currentPlan: string;
  effectiveDate: string;
  reason?: string;
}

export function planCancellationTemplate(data: PlanCancellationTemplateData): { html: string; text: string; subject: string } {
  const content = [
    heading('Suscripcion cancelada'),
    subheading('Tu plan permanece activo hasta el final del periodo facturado.'),
    paragraph(`Hola ${data.userName}, confirmamos la cancelacion de tu plan <strong>${data.currentPlan}</strong>.`),
    infoTable([
      { label: 'Plan', value: data.currentPlan },
      { label: 'Activo hasta', value: data.effectiveDate },
    ]),
    paragraph('Tu cuenta y datos se mantienen disponibles. Puedes reactivar tu plan en cualquier momento desde la seccion de facturacion.'),
    ctaButton('Reactivar plan', `${APP_URL}/billing`),
    divider(),
    smallText('Si tienes preguntas o comentarios, escribe a soporte@ordefy.io. Valoramos tu feedback.'),
  ].join('');

  return {
    subject: 'Confirmacion de cancelacion de plan',
    html: baseLayout({ preheader: `Tu plan ${data.currentPlan} fue cancelado. Permanece activo hasta ${data.effectiveDate}.`, content }),
    text: `Suscripcion cancelada\n\nHola ${data.userName}, tu plan ${data.currentPlan} fue cancelado.\nActivo hasta: ${data.effectiveDate}\n\nReactivar: ${APP_URL}/billing\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Order Confirmation (for store customers)
// ================================================================

export interface OrderConfirmationTemplateData {
  customerName: string;
  storeName: string;
  orderNumber: string;
  orderDate: string;
  items: Array<{ name: string; quantity: number; price: string }>;
  subtotal: string;
  shipping: string;
  total: string;
  trackingUrl?: string;
  storeLogoUrl?: string;
}

export function orderConfirmationTemplate(data: OrderConfirmationTemplateData): { html: string; text: string; subject: string } {
  const itemRows = data.items.map((item) =>
    `<tr>
      <td style="padding: 10px 0; font-size: 14px; color: ${BRAND.text}; border-bottom: 1px solid ${BRAND.divider};">${item.name}</td>
      <td style="padding: 10px 8px; font-size: 14px; color: ${BRAND.textSecondary}; text-align: center; border-bottom: 1px solid ${BRAND.divider};">${item.quantity}</td>
      <td style="padding: 10px 0; font-size: 14px; color: ${BRAND.text}; text-align: right; font-weight: 500; border-bottom: 1px solid ${BRAND.divider};">${item.price}</td>
    </tr>`
  ).join('');

  const itemsTable = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0;">
    <tr>
      <td style="padding: 8px 0; font-size: 11px; color: ${BRAND.textMuted}; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid ${BRAND.divider};">Producto</td>
      <td style="padding: 8px 8px; font-size: 11px; color: ${BRAND.textMuted}; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; border-bottom: 1px solid ${BRAND.divider};">Cant.</td>
      <td style="padding: 8px 0; font-size: 11px; color: ${BRAND.textMuted}; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; border-bottom: 1px solid ${BRAND.divider};">Precio</td>
    </tr>
    ${itemRows}
    <tr>
      <td colspan="2" style="padding: 8px 0; font-size: 13px; color: ${BRAND.textSecondary}; text-align: right;">Subtotal</td>
      <td style="padding: 8px 0; font-size: 14px; color: ${BRAND.text}; text-align: right;">${data.subtotal}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding: 4px 0; font-size: 13px; color: ${BRAND.textSecondary}; text-align: right;">Envio</td>
      <td style="padding: 4px 0; font-size: 14px; color: ${BRAND.text}; text-align: right;">${data.shipping}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding: 12px 0 0; font-size: 15px; color: ${BRAND.white}; text-align: right; font-weight: 700;">Total</td>
      <td style="padding: 12px 0 0; font-size: 16px; color: ${BRAND.primary}; text-align: right; font-weight: 700;">${data.total}</td>
    </tr>
  </table>`;

  const trackingSection = data.trackingUrl
    ? ctaButton('Rastrear pedido', data.trackingUrl)
    : paragraph('Te notificaremos cuando tu pedido sea despachado con el numero de seguimiento.');

  const content = [
    heading(`Pedido #${data.orderNumber} confirmado`),
    subheading(`Gracias por tu compra en ${data.storeName}.`),
    paragraph(`Hola ${data.customerName}, tu pedido fue recibido y esta siendo procesado.`),
    infoTable([
      { label: 'Pedido', value: `#${data.orderNumber}` },
      { label: 'Fecha', value: data.orderDate },
      { label: 'Tienda', value: data.storeName },
    ]),
    itemsTable,
    trackingSection,
    divider(),
    smallText(`Este correo fue enviado por ${data.storeName} a traves de Ordefy.`),
  ].join('');

  const itemsText = data.items.map((i) => `  ${i.name} x${i.quantity}: ${i.price}`).join('\n');

  return {
    subject: `Pedido #${data.orderNumber} confirmado`,
    html: baseLayout({ preheader: `Tu pedido #${data.orderNumber} en ${data.storeName} fue confirmado. Total: ${data.total}`, content }),
    text: `Pedido #${data.orderNumber} confirmado\n\nHola ${data.customerName}, tu pedido en ${data.storeName} fue recibido.\n\nProductos:\n${itemsText}\n\nSubtotal: ${data.subtotal}\nEnvio: ${data.shipping}\nTotal: ${data.total}\n\n${data.trackingUrl ? `Rastrear: ${data.trackingUrl}` : 'Te notificaremos cuando sea despachado.'}\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}

// ================================================================
// TEMPLATE: Generic Transactional Wrapper
// ================================================================

export interface GenericEmailTemplateData {
  title: string;
  subtitle?: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
  preheader?: string;
}

export function genericTemplate(data: GenericEmailTemplateData): { html: string; text: string; subject: string } {
  const sections: string[] = [heading(data.title)];

  if (data.subtitle) {
    sections.push(subheading(data.subtitle));
  }

  sections.push(paragraph(data.body));

  if (data.ctaText && data.ctaUrl) {
    sections.push(ctaButton(data.ctaText, data.ctaUrl));
  }

  if (data.footerNote) {
    sections.push(divider());
    sections.push(smallText(data.footerNote));
  }

  const content = sections.join('');

  return {
    subject: data.title,
    html: baseLayout({ preheader: data.preheader || data.subtitle || data.title, content }),
    text: `${data.title}\n\n${data.subtitle ? data.subtitle + '\n\n' : ''}${data.body}\n\n${data.ctaUrl ? `${data.ctaText}: ${data.ctaUrl}\n\n` : ''}${data.footerNote || ''}\n\n(c) ${CURRENT_YEAR} Ordefy by Bright Idea`,
  };
}
