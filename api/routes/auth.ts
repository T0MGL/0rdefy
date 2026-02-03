import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, AuthRequest } from '../middleware/auth';
import {
    createSession,
    terminateSessionByToken,
    logLogin,
    logLogout,
    logPasswordChange,
    logAccountDeleted
} from '../services/security.service';
import { logger } from '../utils/logger';

export const authRouter = Router();

// ================================================================
// Rate Limiting Configuration for Auth Endpoints
// ================================================================
const isDevelopment = process.env.NODE_ENV === 'development';

// Helper to calculate remaining time in minutes
const getRemainingMinutes = (windowMs: number): number => {
    const minutes = Math.ceil(windowMs / 60000);
    return Math.max(1, minutes);
};

// Shared rate limit configuration factory
const createRateLimiter = (config: {
    windowMs: number;
    max: number;
    devMax?: number;
    message: string;
}) => {
    return rateLimit({
        windowMs: config.windowMs,
        max: isDevelopment ? (config.devMax ?? 100) : config.max,
        standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
        legacyHeaders: true, // Return `X-RateLimit-*` headers for backwards compatibility
        skipFailedRequests: false, // Count failed requests
        // Use default keyGenerator which properly handles IPv6 via req.ip
        // Express 5 and trust proxy settings handle X-Forwarded-For automatically
        handler: (req, res) => {
            const minutes = getRemainingMinutes(config.windowMs);
            res.status(429).json({
                success: false,
                error: `${config.message} Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`,
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: minutes
            });
        },
        // Disable the keyGenerator IPv6 validation since we're using the default
        validate: { xForwardedForHeader: false }
    });
};

// Login: 5 attempts per 15 minutes per IP
const loginRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Too many login attempts.'
});

// Register: 10 attempts per hour per IP
const registerRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: 'Too many registration attempts.'
});

// Change Password: 3 attempts per 15 minutes per IP
const changePasswordRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3,
    message: 'Too many password change attempts.'
});

// Forgot Password: 3 attempts per hour per IP (for future use)
export const forgotPasswordRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: 'Too many password reset attempts.'
});

// Create child logger for auth module
const log = logger.child('AUTH');

// JWT Configuration Constants (must match middleware/auth.ts)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required');
}
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'ordefy-api';
const JWT_AUDIENCE = 'ordefy-app';
const TOKEN_EXPIRY = '7d';
const SALT_ROUNDS = 10;

authRouter.post('/register', registerRateLimiter, async (req: Request, res: Response) => {
    try {
        const { email, password, name, referralCode } = req.body;

        // Log without exposing email - logger auto-sanitizes PII
        log.info('Register request received', { hasEmail: !!email, name, hasPassword: !!password, hasReferral: !!referralCode });

        if (!email || !password || !name) {
            log.warn('Missing required fields for registration');
            return res.status(400).json({
                success: false,
                error: 'Email, password, and name are required',
                code: 'MISSING_FIELDS',
                details: {
                    email: !!email,
                    password: !!password,
                    name: !!name
                }
            });
        }

        // Validate password length
        if (password.length < 8) {
            log.warn('Password too short');
            return res.status(400).json({
                success: false,
                error: 'La contraseña debe tener al menos 8 caracteres',
                code: 'PASSWORD_TOO_SHORT'
            });
        }

        log.debug('Checking for existing user');
        const { data: existingUser, error: checkError } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            log.error('Database error checking existing user', checkError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'DATABASE_ERROR'
            });
        }

        if (existingUser) {
            // Security: Don't reveal if email exists in production (prevents enumeration)
            log.security('Registration attempt with existing email', { userId: existingUser.id });
            return res.status(400).json({
                success: false,
                error: 'Este email ya está registrado',
                code: 'EMAIL_EXISTS'
            });
        }

        // Validate referral code if provided
        let referrerUserId: string | null = null;
        if (referralCode) {
            log.debug('Validating referral code');
            const { data: referralData, error: referralError } = await supabaseAdmin
                .from('referral_codes')
                .select('user_id, is_active')
                .eq('code', referralCode.toUpperCase())
                .single();

            if (referralError || !referralData) {
                log.warn('Invalid referral code provided');
                // Don't block registration, just ignore invalid code
            } else if (!referralData.is_active) {
                log.warn('Inactive referral code provided');
            } else {
                referrerUserId = referralData.user_id;
                log.info('Valid referral code', { referrerUserId });
            }
        }

        log.debug('Hashing password');
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        log.debug('Creating user');
        const { data: newUser, error: userError } = await supabaseAdmin
            .from('users')
            .insert({
                email,
                password_hash,
                name,
                is_active: true
            })
            .select()
            .single();

        if (userError || !newUser) {
            log.error('Error al crear usuario', userError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'USER_CREATION_FAILED'
            });
        }

        log.info('User created successfully', { userId: newUser.id });

        // Track referral if valid code was provided
        if (referrerUserId) {
            // SECURITY: Prevent self-referrals
            if (referrerUserId === newUser.id) {
                log.security('Self-referral attempt detected', { userId: newUser.id });
            } else {
                log.debug('Creating referral record');
                const { error: referralInsertError } = await supabaseAdmin
                    .from('referrals')
                    .insert({
                        referrer_user_id: referrerUserId,
                        referred_user_id: newUser.id,
                        referral_code: referralCode.toUpperCase(),
                        signed_up_at: new Date().toISOString()
                    });

                if (referralInsertError) {
                    log.warn('Error al crear registro de referido', referralInsertError);
                    // Don't fail registration
                } else {
                    log.info('Referral tracked successfully', { referrerUserId, newUserId: newUser.id });
                }
            }
        }

        const token = jwt.sign({
            userId: newUser.id,
            email: newUser.email
        }, JWT_SECRET, {
            algorithm: JWT_ALGORITHM,
            expiresIn: TOKEN_EXPIRY,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        });

        log.info('Registration completed', { userId: newUser.id });

        res.status(201).json({
            success: true,
            token,
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                phone: newUser.phone,
                stores: []
            },
            onboardingCompleted: false,
            referralApplied: !!referrerUserId
        });
    } catch (error: any) {
        log.error('Unexpected error during registration', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ================================================================
// POST /api/auth/logout - Logout user (terminate session)
// ================================================================
authRouter.post('/logout', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        log.info('Logout request', { userId: req.userId });

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            // Terminate the session
            try {
                await terminateSessionByToken(token);
                log.debug('Session terminated');
            } catch (err) {
                log.warn('Error al terminar sesión', err);
            }

            // Log logout activity
            try {
                const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
                const userAgent = req.headers['user-agent'] || 'unknown';
                await logLogout(req.userId!, ipAddress, userAgent);
            } catch (err) {
                log.warn('Error al registrar actividad de cierre de sesión', err);
            }
        }

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error: any) {
        log.error('Unexpected error during logout', error);
        return res.status(500).json({
            success: false,
            error: 'Logout failed',
            code: 'LOGOUT_FAILED'
        });
    }
});

authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        // Don't log email directly - just log that we received a request
        log.info('Login request received');

        if (!email || !password) {
            log.warn('Missing credentials');
            return res.status(400).json({
                success: false,
                error: 'Email and password are required',
                code: 'MISSING_CREDENTIALS'
            });
        }

        log.debug('Looking up user');
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            // Security: Log failed login attempt without exposing email
            log.security('Login failed - user not found');
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        if (!user.is_active) {
            log.security('Login attempt on inactive account', { userId: user.id });
            return res.status(401).json({
                success: false,
                error: 'Account is inactive',
                code: 'ACCOUNT_INACTIVE'
            });
        }

        log.debug('Verifying password');
        const passwordValid = await bcrypt.compare(password, user.password_hash);

        if (!passwordValid) {
            log.security('Login failed - invalid password', { userId: user.id });

            // Log failed login attempt
            try {
                const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
                const userAgent = req.headers['user-agent'] || 'unknown';
                await logLogin(user.id, ipAddress, userAgent, false);
            } catch (err) {
                log.warn('Error al registrar inicio de sesión fallido', err);
            }

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        log.debug('Fetching user stores');
        const { data: userStoresData, error: storesError } = await supabaseAdmin
            .from('user_stores')
            .select(`
                store_id,
                role,
                is_active,
                stores (
                    id,
                    name,
                    country,
                    currency,
                    timezone,
                    separate_confirmation_flow
                )
            `)
            .eq('user_id', user.id)
            .eq('is_active', true); // Only fetch active store memberships

        if (storesError) {
            log.error('Error fetching stores', storesError);
        }

        const stores = userStoresData?.map((us: any) => ({
            id: us.stores.id,
            name: us.stores.name,
            country: us.stores.country,
            currency: us.stores.currency,
            timezone: us.stores.timezone,
            separate_confirmation_flow: us.stores.separate_confirmation_flow ?? false,
            role: us.role
        })) || [];

        log.debug('Found stores for user', { storeCount: stores.length });

        // Check if user was removed from all stores
        if (stores.length === 0) {
            // Check if user was ever part of any store
            const { data: allStores } = await supabaseAdmin
                .from('user_stores')
                .select('id')
                .eq('user_id', user.id);

            if (allStores && allStores.length > 0) {
                log.security('Login attempt by user with revoked access', { userId: user.id });
                return res.status(403).json({
                    success: false,
                    error: 'Tu acceso ha sido revocado. Contacta al administrador de tu tienda para más información.',
                    code: 'ACCESS_REVOKED'
                });
            }
        }

        // User completed onboarding if they have at least one store and a name
        let onboardingCompleted = false;
        if (stores.length > 0 && user.name) {
            onboardingCompleted = true;
            log.debug('User has completed onboarding');
        } else {
            log.debug('User needs to complete onboarding', { hasStores: stores.length > 0, hasName: !!user.name });
        }

        const token = jwt.sign({
            userId: user.id,
            email: user.email
        }, JWT_SECRET, {
            algorithm: JWT_ALGORITHM,
            expiresIn: TOKEN_EXPIRY,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        });

        // Get IP and User Agent for security tracking
        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        // Create session for security tracking
        try {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days (matches TOKEN_EXPIRY)

            await createSession({
                userId: user.id,
                token,
                ipAddress,
                userAgent,
                expiresAt
            });

            // Log successful login
            await logLogin(user.id, ipAddress, userAgent, true);
            log.info('Login successful', { userId: user.id, storeCount: stores.length });
        } catch (sessionError) {
            // Don't fail login if session creation fails
            log.warn('Error al crear sesión', sessionError);
        }

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                phone: user.phone,
                stores
            },
            onboardingCompleted
        });
    } catch (error: any) {
        log.error('Unexpected error during login', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

authRouter.post('/onboarding', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { userName, userPhone, storeName, storeCountry, storeCurrency, taxRate, adminFee } = req.body;

        log.info('Onboarding request', {
            userId: req.userId,
            hasUserName: !!userName,
            hasUserPhone: !!userPhone,
            storeName,
            storeCountry,
            storeCurrency
        });

        if (!userName || !userPhone || !storeName || !storeCountry || !storeCurrency) {
            log.warn('Missing required fields for onboarding', {
                userName: !!userName,
                userPhone: !!userPhone,
                storeName: !!storeName,
                storeCountry: !!storeCountry,
                storeCurrency: !!storeCurrency
            });
            return res.status(400).json({
                success: false,
                error: 'Todos los campos son requeridos',
                code: 'MISSING_FIELDS',
                details: {
                    userName: !!userName,
                    userPhone: !!userPhone,
                    storeName: !!storeName,
                    storeCountry: !!storeCountry,
                    storeCurrency: !!storeCurrency
                }
            });
        }

        // Check if phone number is already registered to another user
        log.debug('Checking if phone is already registered');
        const { data: existingPhone, error: phoneCheckError } = await supabaseAdmin
            .from('users')
            .select('id, email')
            .eq('phone', userPhone)
            .neq('id', req.userId)
            .single();

        if (existingPhone) {
            log.security('Phone already registered to another user', { userId: req.userId });
            return res.status(409).json({
                success: false,
                error: 'Este número de teléfono ya está registrado con otra cuenta',
                code: 'PHONE_ALREADY_EXISTS'
            });
        }

        log.debug('Updating user profile');
        const { data: updatedUser, error: userError } = await supabaseAdmin
            .from('users')
            .update({
                name: userName,
                phone: userPhone,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.userId)
            .select()
            .single();

        if (userError) {
            log.error('Error updating user', userError);

            // Handle duplicate phone constraint error
            if (userError.code === '23505' && userError.message?.includes('phone')) {
                return res.status(409).json({
                    success: false,
                    error: 'Este número de teléfono ya está registrado con otra cuenta',
                    code: 'PHONE_ALREADY_EXISTS'
                });
            }

            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'USER_UPDATE_FAILED'
            });
        }

        log.debug('Creating store');
        const { data: store, error: storeError } = await supabaseAdmin
            .from('stores')
            .insert({
                name: storeName,
                country: storeCountry,
                currency: storeCurrency,
                tax_rate: taxRate || 0,
                admin_fee: adminFee || 0
            })
            .select()
            .single();

        if (storeError || !store) {
            log.error('Error creating store', storeError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'STORE_CREATION_FAILED'
            });
        }

        log.debug('Linking user to store');
        const { error: linkError } = await supabaseAdmin
            .from('user_stores')
            .insert({
                user_id: req.userId,
                store_id: store.id,
                role: 'owner'
            });

        if (linkError) {
            log.error('Error linking user to store', linkError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'STORE_LINK_FAILED'
            });
        }

        // Create default subscription for the user (free plan) if they don't have one
        log.debug('Checking/creating default subscription for user');
        const { data: existingSubscription } = await supabaseAdmin
            .from('subscriptions')
            .select('id')
            .eq('user_id', req.userId)
            .eq('is_primary', true)
            .single();

        if (!existingSubscription) {
            const { error: subscriptionError } = await supabaseAdmin
                .from('subscriptions')
                .insert({
                    user_id: req.userId,
                    plan: 'free',
                    status: 'active',
                    is_primary: true
                });

            if (subscriptionError) {
                // Log but don't fail - subscription can be created later
                log.warn('Could not create subscription', subscriptionError);
            }
        } else {
            log.debug('User already has subscription, skipping creation');
        }

        log.info('Onboarding completed', { userId: req.userId, storeId: store.id });

        res.json({
            success: true,
            user: {
                id: updatedUser.id,
                email: updatedUser.email,
                name: updatedUser.name,
                phone: updatedUser.phone,
                stores: [{
                    id: store.id,
                    name: store.name,
                    country: store.country,
                    currency: store.currency,
                    timezone: store.timezone,
                    role: 'owner'
                }]
            },
            store: {
                id: store.id,
                name: store.name,
                country: store.country,
                currency: store.currency
            }
        });
    } catch (error: any) {
        log.error('Unexpected error during onboarding', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

// Profile update handler (shared by POST and PUT)
const handleProfileUpdate = async (req: AuthRequest, res: Response) => {
    try {
        const { userName, userPhone, storeName, storeId } = req.body;

        log.info('Profile update request', {
            userId: req.userId,
            hasUserName: !!userName,
            hasUserPhone: !!userPhone,
            hasStoreName: !!storeName,
            storeId
        });

        if (userName || userPhone) {
            log.debug('Updating user profile');
            const updateData: any = {
                updated_at: new Date().toISOString()
            };

            if (userName) updateData.name = userName;
            if (userPhone) updateData.phone = userPhone;

            const { error: userError } = await supabaseAdmin
                .from('users')
                .update(updateData)
                .eq('id', req.userId);

            if (userError) {
                log.error('Error updating user', userError);
                throw new Error('Error al actualizar perfil de usuario');
            }
        }

        if (storeName && storeId) {
            log.debug('Updating store name', { storeId });

            const { data: hasAccess, error: accessError } = await supabaseAdmin
                .from('user_stores')
                .select('role')
                .eq('user_id', req.userId)
                .eq('store_id', storeId)
                .single();

            if (accessError || !hasAccess) {
                log.security('Unauthorized store access attempt', { userId: req.userId, storeId });
                throw new Error('You do not have access to this store');
            }

            const { error: storeError } = await supabaseAdmin
                .from('stores')
                .update({
                    name: storeName,
                    updated_at: new Date().toISOString()
                })
                .eq('id', storeId);

            if (storeError) {
                log.error('Error updating store', storeError);
                throw new Error('Error al actualizar nombre de tienda');
            }
        }

        log.info('Profile updated successfully', { userId: req.userId });

        const { data: updatedUser } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', req.userId)
            .single();

        const { data: userStoresData } = await supabaseAdmin
            .from('user_stores')
            .select(`
                store_id,
                role,
                stores (
                    id,
                    name,
                    country,
                    currency,
                    timezone,
                    separate_confirmation_flow
                )
            `)
            .eq('user_id', req.userId);

        const stores = userStoresData?.map((us: any) => ({
            id: us.stores.id,
            name: us.stores.name,
            country: us.stores.country,
            currency: us.stores.currency,
            timezone: us.stores.timezone,
            separate_confirmation_flow: us.stores.separate_confirmation_flow ?? false,
            role: us.role
        })) || [];

        // Generate new token with updated info
        const token = jwt.sign({
            userId: updatedUser?.id,
            email: updatedUser?.email
        }, JWT_SECRET, {
            algorithm: JWT_ALGORITHM,
            expiresIn: TOKEN_EXPIRY,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        });

        res.json({
            success: true,
            token,
            user: {
                id: updatedUser?.id,
                email: updatedUser?.email,
                name: updatedUser?.name,
                phone: updatedUser?.phone,
                stores
            }
        });
    } catch (error: any) {
        log.error('Profile update error', error);
        return res.status(500).json({
            success: false,
            error: 'Profile update failed',
            code: 'PROFILE_UPDATE_FAILED',
            message: error.message
        });
    }
};

authRouter.post('/profile', verifyToken, handleProfileUpdate);
authRouter.put('/profile', verifyToken, handleProfileUpdate);

// ================================================================
// POST /api/auth/change-password - Change user password
// ================================================================
authRouter.post('/change-password', changePasswordRateLimiter, verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;

        log.info('Password change request', { userId: req.userId });

        if (!currentPassword || !newPassword) {
            log.warn('Missing password fields');
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required',
                code: 'MISSING_FIELDS'
            });
        }

        if (newPassword.length < 8) {
            log.warn('New password too short');
            return res.status(400).json({
                success: false,
                error: 'La contraseña debe tener al menos 8 caracteres',
                code: 'PASSWORD_TOO_SHORT'
            });
        }

        // Get user with current password
        log.debug('Looking up user');
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('password_hash')
            .eq('id', req.userId)
            .single();

        if (userError || !user) {
            log.error('User not found', userError);
            return res.status(404).json({
                success: false,
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Verify current password
        log.debug('Verifying current password');
        const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);

        if (!passwordValid) {
            log.security('Password change failed - wrong current password', { userId: req.userId });
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect',
                code: 'INVALID_PASSWORD'
            });
        }

        // Hash new password
        log.debug('Hashing new password');
        const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update password
        log.debug('Updating password');
        const { error: updateError } = await supabaseAdmin
            .from('users')
            .update({
                password_hash: newPasswordHash,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.userId);

        if (updateError) {
            log.error('Error updating password', updateError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'PASSWORD_UPDATE_FAILED'
            });
        }

        // Log password change
        try {
            const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            await logPasswordChange(req.userId!, ipAddress, userAgent);
        } catch (logError) {
            log.warn('Error al registrar actividad de cambio de contraseña', logError);
        }

        log.info('Password changed successfully', { userId: req.userId });

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error: any) {
        log.error('Unexpected error during password change', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ================================================================
// POST /api/auth/delete-account - Delete user account (requires password)
// ================================================================
authRouter.post('/delete-account', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { password } = req.body;

        log.info('Account deletion request', { userId: req.userId });

        if (!password) {
            log.warn('Missing password for account deletion');
            return res.status(400).json({
                success: false,
                error: 'Password is required to delete account',
                code: 'MISSING_PASSWORD'
            });
        }

        // Get user with password
        log.debug('Looking up user');
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('password_hash, email')
            .eq('id', req.userId)
            .single();

        if (userError || !user) {
            log.error('User not found', userError);
            return res.status(404).json({
                success: false,
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Verify password
        log.debug('Verifying password');
        const passwordValid = await bcrypt.compare(password, user.password_hash);

        if (!passwordValid) {
            log.security('Account deletion failed - wrong password', { userId: req.userId });
            return res.status(401).json({
                success: false,
                error: 'Password is incorrect',
                code: 'INVALID_PASSWORD'
            });
        }

        // Log account deletion BEFORE deleting (activity_log has CASCADE DELETE)
        try {
            const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            await logAccountDeleted(req.userId!, ipAddress, userAgent);
        } catch (logError) {
            log.warn('Error al registrar actividad de eliminación de cuenta', logError);
        }

        // Delete user (cascade will delete user_stores relationships)
        log.info('Deleting user account', { userId: req.userId });
        const { error: deleteError } = await supabaseAdmin
            .from('users')
            .delete()
            .eq('id', req.userId);

        if (deleteError) {
            log.error('Error deleting account', deleteError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'ACCOUNT_DELETION_FAILED'
            });
        }

        log.info('Account deleted successfully', { userId: req.userId });

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });
    } catch (error: any) {
        log.error('Unexpected error during account deletion', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/auth/stores
 * Fetch all stores associated with the authenticated user
 */
authRouter.get('/stores', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        log.debug('Fetching stores', { userId: req.userId });

        if (!req.userId) {
            log.error('No userId in request');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                code: 'UNAUTHORIZED'
            });
        }

        // Fetch user stores with store details
        const { data: userStoresData, error: storesError } = await supabaseAdmin
            .from('user_stores')
            .select(`
                store_id,
                role,
                stores (
                    id,
                    name,
                    country,
                    currency,
                    timezone,
                    separate_confirmation_flow,
                    tax_rate,
                    admin_fee
                )
            `)
            .eq('user_id', req.userId);

        if (storesError) {
            log.error('Error fetching stores', storesError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'STORES_FETCH_FAILED'
            });
        }

        const stores = userStoresData?.map((us: any) => ({
            id: us.stores.id,
            name: us.stores.name,
            country: us.stores.country,
            currency: us.stores.currency,
            timezone: us.stores.timezone,
            separate_confirmation_flow: us.stores.separate_confirmation_flow ?? false,
            tax_rate: us.stores.tax_rate,
            admin_fee: us.stores.admin_fee,
            role: us.role
        })) || [];

        log.debug('Found stores', { userId: req.userId, storeCount: stores.length });

        res.json({
            success: true,
            stores
        });
    } catch (error: any) {
        log.error('Unexpected error fetching stores', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * PUT /api/auth/stores/:storeId/timezone
 * Update store timezone
 */
authRouter.put('/stores/:storeId/timezone', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { storeId } = req.params;
        const { timezone } = req.body;

        log.info('Timezone update request', { storeId, timezone });

        if (!timezone) {
            log.warn('Missing timezone');
            return res.status(400).json({
                success: false,
                error: 'Timezone is required',
                code: 'MISSING_TIMEZONE'
            });
        }

        // Verify user has access to this store
        const { data: userStore, error: accessError } = await supabaseAdmin
            .from('user_stores')
            .select('role')
            .eq('user_id', req.userId)
            .eq('store_id', storeId)
            .single();

        if (accessError || !userStore) {
            log.security('Unauthorized timezone update attempt', { userId: req.userId, storeId });
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                code: 'ACCESS_DENIED'
            });
        }

        // Update store timezone
        const { data: updatedStore, error: updateError } = await supabaseAdmin
            .from('stores')
            .update({ timezone, updated_at: new Date().toISOString() })
            .eq('id', storeId)
            .select()
            .single();

        if (updateError || !updatedStore) {
            log.error('Error updating timezone', updateError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'TIMEZONE_UPDATE_FAILED'
            });
        }

        log.info('Timezone updated', { storeId, timezone });

        res.json({
            success: true,
            timezone: updatedStore.timezone
        });
    } catch (error: any) {
        log.error('Unexpected error updating timezone', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * PUT /api/auth/stores/:storeId/currency
 * Update store currency
 */
authRouter.put('/stores/:storeId/currency', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { storeId } = req.params;
        const { currency } = req.body;

        log.info('Currency update request', { storeId, currency });

        if (!currency) {
            log.warn('Missing currency');
            return res.status(400).json({
                success: false,
                error: 'Currency is required',
                code: 'MISSING_CURRENCY'
            });
        }

        // Validate currency code (should be 3 characters)
        if (currency.length !== 3) {
            log.warn('Invalid currency code', { currency });
            return res.status(400).json({
                success: false,
                error: 'Currency code must be 3 characters (e.g., PYG, USD, ARS)',
                code: 'INVALID_CURRENCY_FORMAT'
            });
        }

        // Verify user has access to this store
        const { data: userStore, error: accessError } = await supabaseAdmin
            .from('user_stores')
            .select('role')
            .eq('user_id', req.userId)
            .eq('store_id', storeId)
            .single();

        if (accessError || !userStore) {
            log.security('Unauthorized currency update attempt', { userId: req.userId, storeId });
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                code: 'ACCESS_DENIED'
            });
        }

        // Update store currency
        const { data: updatedStore, error: updateError } = await supabaseAdmin
            .from('stores')
            .update({ currency: currency.toUpperCase(), updated_at: new Date().toISOString() })
            .eq('id', storeId)
            .select()
            .single();

        if (updateError || !updatedStore) {
            log.error('Error updating currency', updateError);
            return res.status(500).json({
                success: false,
                error: 'An error occurred',
                code: 'CURRENCY_UPDATE_FAILED'
            });
        }

        log.info('Currency updated', { storeId, currency: currency.toUpperCase() });

        res.json({
            success: true,
            currency: updatedStore.currency
        });
    } catch (error: any) {
        log.error('Unexpected error updating currency', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});


/**
 * PUT /api/auth/stores/:storeId/preferences
 * Update store workflow preferences (separate_confirmation_flow, etc.)
 */
authRouter.put('/stores/:storeId/preferences', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { storeId } = req.params;
        const { separate_confirmation_flow } = req.body;

        log.info('Store preferences update request', { storeId, separate_confirmation_flow });

        // Validate input type
        if (separate_confirmation_flow !== undefined && typeof separate_confirmation_flow !== 'boolean') {
            log.warn('Invalid separate_confirmation_flow type');
            return res.status(400).json({
                success: false,
                error: 'separate_confirmation_flow debe ser booleano',
                code: 'INVALID_TYPE'
            });
        }

        // Verify user has access to this store AND is owner
        const { data: userStore, error: accessError } = await supabaseAdmin
            .from('user_stores')
            .select('role')
            .eq('user_id', req.userId)
            .eq('store_id', storeId)
            .single();

        if (accessError || !userStore) {
            log.security('Unauthorized preferences update attempt', { userId: req.userId, storeId });
            return res.status(403).json({
                success: false,
                error: 'No tienes acceso a esta tienda',
                code: 'STORE_ACCESS_DENIED'
            });
        }

        // Only owners can change workflow preferences
        if (userStore.role !== 'owner') {
            log.security('Non-owner tried to update preferences', { userId: req.userId, storeId, role: userStore.role });
            return res.status(403).json({
                success: false,
                error: 'Solo el dueño puede cambiar las preferencias de flujo de trabajo',
                code: 'OWNER_ONLY'
            });
        }

        // If enabling separate_confirmation_flow, verify plan allows multiple users
        if (separate_confirmation_flow === true) {
            // Get store's subscription plan via owner (subscriptions are user-level now)
            const { data: planData, error: planError } = await supabaseAdmin
                .rpc('get_store_plan_via_owner', { p_store_id: storeId });

            const plan = planData?.[0]?.plan || 'free';
            const maxUsers = planData?.[0]?.max_users || 1;

            log.info('Plan check for separate_confirmation_flow', { storeId, plan, maxUsers, planError: planError?.message });

            if (maxUsers <= 1) {
                log.warn('Tried to enable separate flow on single-user plan', { storeId, plan, maxUsers });
                return res.status(400).json({
                    success: false,
                    error: 'Esta funcionalidad requiere un plan con múltiples usuarios (Starter o superior)',
                    code: 'PLAN_UPGRADE_REQUIRED'
                });
            }
        }

        // Update store preference
        const { data: updatedStore, error: updateError } = await supabaseAdmin
            .from('stores')
            .update({
                separate_confirmation_flow: separate_confirmation_flow ?? false,
                updated_at: new Date().toISOString()
            })
            .eq('id', storeId)
            .select('id, name, separate_confirmation_flow')
            .single();

        if (updateError) {
            log.error('Error updating store preferences', updateError);
            return res.status(500).json({
                success: false,
                error: 'Error al actualizar preferencias',
                code: 'UPDATE_FAILED'
            });
        }

        log.info('Store preferences updated', { storeId, separate_confirmation_flow: updatedStore.separate_confirmation_flow });

        res.json({
            success: true,
            data: {
                separate_confirmation_flow: updatedStore.separate_confirmation_flow
            }
        });
    } catch (error: any) {
        log.error('Unexpected error updating store preferences', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});


/**
 * GET /api/auth/stores/:storeId/preferences
 * Get store workflow preferences
 */
authRouter.get('/stores/:storeId/preferences', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { storeId } = req.params;

        // Verify user has access to this store
        const { data: userStore, error: accessError } = await supabaseAdmin
            .from('user_stores')
            .select('role')
            .eq('user_id', req.userId)
            .eq('store_id', storeId)
            .single();

        if (accessError || !userStore) {
            return res.status(403).json({
                success: false,
                error: 'No tienes acceso a esta tienda',
                code: 'STORE_ACCESS_DENIED'
            });
        }

        // Get store preferences
        const { data: store, error: storeError } = await supabaseAdmin
            .from('stores')
            .select('id, name, separate_confirmation_flow')
            .eq('id', storeId)
            .single();

        if (storeError || !store) {
            return res.status(404).json({
                success: false,
                error: 'Tienda no encontrada',
                code: 'STORE_NOT_FOUND'
            });
        }

        res.json({
            success: true,
            data: {
                separate_confirmation_flow: store.separate_confirmation_flow ?? false,
                // Include user's role for this store (important for separate confirmation flow detection)
                user_role: userStore.role
            }
        });
    } catch (error: any) {
        log.error('Error getting store preferences', error);
        return res.status(500).json({
            success: false,
            error: 'An error occurred',
            code: 'INTERNAL_ERROR'
        });
    }
});
