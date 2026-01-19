/**
 * Phone Verification Routes
 * Endpoints for WhatsApp-based phone number verification
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import whatsappService from '../services/whatsapp.service';
import { verifyToken } from '../middleware/auth';

const router = Router();

/**
 * Request verification code
 * POST /api/phone-verification/request
 * Body: { phone: string }
 * Requires: Authentication
 */
router.post('/request', verifyToken, async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    const userId = (req as any).userId;

    if (!phone) {
      return res.status(400).json({ error: 'Se requiere el número de teléfono' });
    }

    // Validate phone format (simple validation, adjust as needed)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone.replace(/[\s-]/g, ''))) {
      return res.status(400).json({ error: 'Formato de número de teléfono inválido' });
    }

    // Check if phone is already verified by another user
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone_verified')
      .eq('phone', phone)
      .neq('id', userId)
      .single();

    if (existingUser && existingUser.phone_verified) {
      // Send recovery message to existing account
      await whatsappService.sendAccountRecoveryMessage(phone, existingUser.email);
      return res.status(409).json({
        error: 'Este número ya está registrado',
        canRecover: true,
        email: existingUser.email
      });
    }

    // Check rate limiting (60 seconds between requests)
    const { data: canRequest, error: rpcError } = await supabaseAdmin
      .rpc('can_request_verification_code', { p_user_id: userId });

    // SECURITY: If RPC fails, deny the request (fail-closed)
    if (rpcError) {
      logger.error('API', '[PhoneVerification] RPC error checking rate limit:', rpcError);
      return res.status(500).json({
        error: 'Error al verificar límite de solicitudes. Intenta nuevamente.'
      });
    }

    // Explicit check for false (not just falsy) to handle RPC returning null
    if (canRequest !== true) {
      return res.status(429).json({
        error: 'Debes esperar 60 segundos antes de solicitar un nuevo código'
      });
    }

    // Generate 6-digit code
    const { data: codeData, error: codeGenError } = await supabaseAdmin
      .rpc('generate_verification_code');

    if (codeGenError || !codeData) {
      logger.error('API', '[PhoneVerification] Error generating verification code:', codeGenError);
      return res.status(500).json({
        error: 'Error al generar código de verificación. Intenta nuevamente.'
      });
    }

    const code = codeData;

    // Save code to database
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const { error: insertError } = await supabaseAdmin
      .from('phone_verification_codes')
      .insert({
        user_id: userId,
        phone,
        code,
        expires_at: expiresAt.toISOString()
      });

    if (insertError) {
      logger.error('API', 'Error saving verification code:', insertError);
      return res.status(500).json({ error: 'Error al generar código de verificación' });
    }

    // Send code via WhatsApp
    try {
      await whatsappService.sendVerificationCode(phone, code);
    } catch (whatsappError) {
      logger.error('API', 'WhatsApp send error:', whatsappError);
      return res.status(500).json({
        error: 'Error al enviar código por WhatsApp. Intenta nuevamente.'
      });
    }

    // Update user's phone (unverified)
    await supabaseAdmin
      .from('users')
      .update({ phone, phone_verified: false })
      .eq('id', userId);

    res.json({
      success: true,
      message: 'Código enviado por WhatsApp',
      expiresIn: 600, // seconds
      demoMode: !whatsappService.isEnabled(),
      ...(whatsappService.isEnabled() ? {} : { code }) // Only show code in demo mode
    });

  } catch (error) {
    logger.error('API', 'Error requesting verification code:', error);
    res.status(500).json({ error: 'Error al solicitar código de verificación' });
  }
});

/**
 * Verify code
 * POST /api/phone-verification/verify
 * Body: { code: string }
 * Requires: Authentication
 */
router.post('/verify', verifyToken, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    const userId = (req as any).userId;

    if (!code) {
      return res.status(400).json({ error: 'Se requiere el código de verificación' });
    }

    // Find verification code
    const { data: verificationCode, error: findError } = await supabaseAdmin
      .from('phone_verification_codes')
      .select('*')
      .eq('user_id', userId)
      .eq('code', code)
      .eq('verified', false)
      .single();

    if (findError || !verificationCode) {
      // Increment attempts
      await supabaseAdmin
        .from('phone_verification_codes')
        .update({ attempts: supabaseAdmin.raw('attempts + 1') })
        .eq('user_id', userId)
        .eq('code', code);

      return res.status(400).json({ error: 'Código inválido' });
    }

    // Check if expired
    if (new Date(verificationCode.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Código expirado. Solicita uno nuevo.' });
    }

    // Check max attempts
    if (verificationCode.attempts >= 5) {
      return res.status(400).json({
        error: 'Demasiados intentos. Solicita un nuevo código.'
      });
    }

    // Mark code as verified
    await supabaseAdmin
      .from('phone_verification_codes')
      .update({
        verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('id', verificationCode.id);

    // Update user's phone as verified
    await supabaseAdmin
      .from('users')
      .update({
        phone: verificationCode.phone,
        phone_verified: true,
        phone_verified_at: new Date().toISOString()
      })
      .eq('id', userId);

    res.json({
      success: true,
      message: 'Teléfono verificado exitosamente'
    });

  } catch (error) {
    logger.error('API', 'Error verifying code:', error);
    res.status(500).json({ error: 'Error al verificar código' });
  }
});

/**
 * Check verification status
 * GET /api/phone-verification/status
 * Requires: Authentication
 */
router.get('/status', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('phone, phone_verified, phone_verified_at')
      .eq('id', userId)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Error al obtener estado de verificación' });
    }

    res.json({
      phone: user.phone,
      verified: user.phone_verified || false,
      verifiedAt: user.phone_verified_at,
      demoMode: !whatsappService.isEnabled()
    });

  } catch (error) {
    logger.error('API', 'Error getting verification status:', error);
    res.status(500).json({ error: 'Error al obtener estado de verificación' });
  }
});

/**
 * Resend verification code
 * POST /api/phone-verification/resend
 * Requires: Authentication
 */
router.post('/resend', verifyToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Get user's phone
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();

    if (userError || !user.phone) {
      return res.status(400).json({ error: 'No se encontró número de teléfono' });
    }

    // Reuse the request endpoint logic
    req.body = { phone: user.phone };
    return router.handle(req, res);

  } catch (error) {
    logger.error('API', 'Error resending verification code:', error);
    res.status(500).json({ error: 'Error al reenviar código' });
  }
});

export default router;
