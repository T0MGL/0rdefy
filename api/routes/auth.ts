import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
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

authRouter.post('/register', async (req: Request, res: Response) => {
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
            log.error('Failed to create user', userError);
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
                    log.warn('Failed to create referral record', referralInsertError);
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
                log.warn('Failed to terminate session', err);
            }

            // Log logout activity
            try {
                const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
                const userAgent = req.headers['user-agent'] || 'unknown';
                await logLogout(req.userId!, ipAddress, userAgent);
            } catch (err) {
                log.warn('Failed to log logout activity', err);
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

authRouter.post('/login', async (req: Request, res: Response) => {
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
                log.warn('Failed to log failed login', err);
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
                    timezone
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
            log.warn('Failed to create session', sessionError);
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

        // Create default subscription for the store (free plan)
        log.debug('Creating default subscription');
        const { error: subscriptionError } = await supabaseAdmin
            .from('subscriptions')
            .insert({
                store_id: store.id,
                plan: 'free',
                status: 'active'
            });

        if (subscriptionError) {
            // Log but don't fail - subscription can be created later
            log.warn('Could not create subscription', subscriptionError);
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
                throw new Error('Failed to update user profile');
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
                throw new Error('Failed to update store name');
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
                    currency
                )
            `)
            .eq('user_id', req.userId);

        const stores = userStoresData?.map((us: any) => ({
            id: us.stores.id,
            name: us.stores.name,
            country: us.stores.country,
            currency: us.stores.currency,
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
authRouter.post('/change-password', verifyToken, async (req: AuthRequest, res: Response) => {
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
            log.warn('Failed to log password change activity', logError);
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
            log.warn('Failed to log account deletion activity', logError);
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
