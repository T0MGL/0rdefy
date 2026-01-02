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

export const authRouter = Router();

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

        console.log('📝 [REGISTER] Request received:', { email, name, hasPassword: !!password, referralCode: referralCode || 'none' });

        if (!email || !password || !name) {
            console.warn('⚠️ [REGISTER] Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'Email, password, and name are required',
                details: {
                    email: !!email,
                    password: !!password,
                    name: !!name
                }
            });
        }

        console.log('🔍 [REGISTER] Checking for existing user...');
        const { data: existingUser, error: checkError } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error('❌ [REGISTER] Error checking existing user:', checkError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Database error checking user',
                details: process.env.NODE_ENV === 'production' ? undefined : checkError.message
            });
        }

        if (existingUser) {
            console.warn('⚠️ [REGISTER] Email already registered:', email);
            return res.status(400).json({
                success: false,
                error: 'Este email ya está registrado'
            });
        }

        // Validate referral code if provided
        let referrerUserId: string | null = null;
        if (referralCode) {
            console.log('🎁 [REGISTER] Validating referral code:', referralCode);
            const { data: referralData, error: referralError } = await supabaseAdmin
                .from('referral_codes')
                .select('user_id, is_active')
                .eq('code', referralCode.toUpperCase())
                .single();

            if (referralError || !referralData) {
                console.warn('⚠️ [REGISTER] Invalid referral code:', referralCode);
                // Don't block registration, just ignore invalid code
            } else if (!referralData.is_active) {
                console.warn('⚠️ [REGISTER] Referral code is inactive:', referralCode);
            } else {
                referrerUserId = referralData.user_id;
                console.log('✅ [REGISTER] Valid referral code from user:', referrerUserId);
            }
        }

        console.log('🔒 [REGISTER] Hashing password...');
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        console.log('📝 [REGISTER] Creating user...');
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
            console.error('❌ [REGISTER] Error creating user:', userError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to create user',
                details: process.env.NODE_ENV === 'production' ? undefined : userError?.message
            });
        }

        console.log('✅ [REGISTER] User created successfully:', newUser.id);

        // Track referral if valid code was provided
        if (referrerUserId) {
            console.log('🎁 [REGISTER] Creating referral record...');
            const { error: referralInsertError } = await supabaseAdmin
                .from('referrals')
                .insert({
                    referrer_user_id: referrerUserId,
                    referred_user_id: newUser.id,
                    referral_code: referralCode.toUpperCase(),
                    signed_up_at: new Date().toISOString()
                });

            if (referralInsertError) {
                console.error('⚠️ [REGISTER] Error creating referral record:', referralInsertError);
                // Don't fail registration
            } else {
                console.log('✅ [REGISTER] Referral tracked successfully');
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

        console.log('🎫 [REGISTER] JWT token generated');

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
        console.error('💥 [REGISTER] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Registration failed',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

// ================================================================
// POST /api/auth/logout - Logout user (terminate session)
// ================================================================
authRouter.post('/logout', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        console.log('🚪 [LOGOUT] Request received for user:', req.userId);

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            // Terminate the session
            try {
                await terminateSessionByToken(token);
                console.log('✅ [LOGOUT] Session terminated');
            } catch (err) {
                console.error('⚠️ [LOGOUT] Failed to terminate session:', err);
            }

            // Log logout activity
            try {
                const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
                const userAgent = req.headers['user-agent'] || 'unknown';
                await logLogout(req.userId!, ipAddress, userAgent);
            } catch (err) {
                console.error('⚠️ [LOGOUT] Failed to log logout:', err);
            }
        }

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error: any) {
        console.error('💥 [LOGOUT] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

authRouter.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        console.log('🔐 [LOGIN] Request received:', email);

        if (!email || !password) {
            console.warn('⚠️ [LOGIN] Missing credentials');
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        console.log('🔍 [LOGIN] Looking up user...');
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (userError || !user) {
            console.warn('⚠️ [LOGIN] User not found:', email);
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        if (!user.is_active) {
            console.warn('⚠️ [LOGIN] User account is inactive:', email);
            return res.status(401).json({
                success: false,
                error: 'Account is inactive'
            });
        }

        console.log('🔒 [LOGIN] Verifying password...');
        const passwordValid = await bcrypt.compare(password, user.password_hash);

        if (!passwordValid) {
            console.warn('⚠️ [LOGIN] Invalid password for:', email);

            // Log failed login attempt
            try {
                const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
                const userAgent = req.headers['user-agent'] || 'unknown';
                await logLogin(user.id, ipAddress, userAgent, false);
            } catch (err) {
                console.error('⚠️ [LOGIN] Failed to log failed login:', err);
            }

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        console.log('🏪 [LOGIN] Fetching user stores...');
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
                    timezone
                )
            `)
            .eq('user_id', user.id);

        if (storesError) {
            console.error('❌ [LOGIN] Error fetching stores:', storesError);
        }

        const stores = userStoresData?.map((us: any) => ({
            id: us.stores.id,
            name: us.stores.name,
            country: us.stores.country,
            currency: us.stores.currency,
            timezone: us.stores.timezone,
            role: us.role
        })) || [];

        console.log(`🏪 [LOGIN] Found ${stores.length} store(s) for user`);

        // User completed onboarding if they have at least one store and a name
        // Phone is optional as older users might not have it
        let onboardingCompleted = false;
        if (stores.length > 0 && user.name) {
            onboardingCompleted = true;
            console.log('✅ [LOGIN] User has completed onboarding');
        } else {
            console.log('⚠️ [LOGIN] User needs to complete onboarding - stores:', stores.length, 'name:', !!user.name);
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
            console.log('✅ [LOGIN] Session created and login logged');
        } catch (sessionError) {
            // Don't fail login if session creation fails
            console.error('⚠️ [LOGIN] Failed to create session:', sessionError);
        }

        console.log('✅ [LOGIN] Login successful');

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
        console.error('💥 [LOGIN] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Login failed',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

authRouter.post('/onboarding', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { userName, userPhone, storeName, storeCountry, storeCurrency, taxRate, adminFee } = req.body;

        console.log('📝 [ONBOARDING] Request received:', {
            userId: req.userId,
            userName,
            userPhone,
            storeName,
            storeCountry,
            storeCurrency,
            taxRate,
            adminFee
        });

        if (!userName || !userPhone || !storeName || !storeCountry || !storeCurrency) {
            console.warn('⚠️ [ONBOARDING] Missing required fields:', {
                userName: !!userName,
                userPhone: !!userPhone,
                storeName: !!storeName,
                storeCountry: !!storeCountry,
                storeCurrency: !!storeCurrency
            });
            return res.status(400).json({
                success: false,
                error: 'Todos los campos son requeridos',
                details: {
                    userName: !!userName,
                    userPhone: !!userPhone,
                    storeName: !!storeName,
                    storeCountry: !!storeCountry,
                    storeCurrency: !!storeCurrency
                }
            });
        }

        console.log('📝 [ONBOARDING] Updating user profile...');
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
            console.error('❌ [ONBOARDING] Error updating user:', userError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to update user profile',
                details: process.env.NODE_ENV === 'production' ? undefined : userError.message
            });
        }

        console.log('🏪 [ONBOARDING] Creating store...');
        const { data: store, error: storeError } = await supabaseAdmin
            .from('stores')
            .insert({
                name: storeName,
                country: storeCountry,
                currency: storeCurrency,
                tax_rate: taxRate || 0,
                admin_fee: adminFee || 0,
                subscription_plan: 'free'
            })
            .select()
            .single();

        if (storeError || !store) {
            console.error('❌ [ONBOARDING] Error creating store:', storeError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to create store',
                details: process.env.NODE_ENV === 'production' ? undefined : storeError?.message
            });
        }

        console.log('🔗 [ONBOARDING] Linking user to store...');
        const { error: linkError } = await supabaseAdmin
            .from('user_stores')
            .insert({
                user_id: req.userId,
                store_id: store.id,
                role: 'owner'
            });

        if (linkError) {
            console.error('❌ [ONBOARDING] Error linking user to store:', linkError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to link user to store',
                details: process.env.NODE_ENV === 'production' ? undefined : linkError.message
            });
        }

        console.log('✅ [ONBOARDING] Onboarding completed successfully');

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
        console.error('💥 [ONBOARDING] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Onboarding failed',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

// Profile update handler (shared by POST and PUT)
const handleProfileUpdate = async (req: AuthRequest, res: Response) => {
    try {
        const { userName, userPhone, storeName, storeId } = req.body;

        console.log('📝 [PROFILE] Update request:', {
            userName,
            userPhone,
            storeName,
            storeId
        });

        if (userName || userPhone) {
            console.log('👤 [PROFILE] Updating user profile...');
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
                console.error('❌ [PROFILE] Error updating user:', userError);
                throw new Error('Failed to update user profile');
            }
        }

        if (storeName && storeId) {
            console.log('🏪 [PROFILE] Updating store name...');

            const { data: hasAccess, error: accessError } = await supabaseAdmin
                .from('user_stores')
                .select('role')
                .eq('user_id', req.userId)
                .eq('store_id', storeId)
                .single();

            if (accessError || !hasAccess) {
                console.warn('⚠️ [PROFILE] User does not have access to this store');
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
                console.error('❌ [PROFILE] Error updating store:', storeError);
                throw new Error('Failed to update store name');
            }
        }

        console.log('✅ [PROFILE] Profile updated successfully');

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
        console.error('💥 [PROFILE] Error:', error);
        res.status(500).json({ error: 'Profile update failed', message: error.message });
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

        console.log('🔐 [CHANGE-PASSWORD] Request received for user:', req.userId);

        if (!currentPassword || !newPassword) {
            console.warn('⚠️ [CHANGE-PASSWORD] Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 6) {
            console.warn('⚠️ [CHANGE-PASSWORD] New password too short');
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 6 characters'
            });
        }

        // Get user with current password
        console.log('🔍 [CHANGE-PASSWORD] Looking up user...');
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('password_hash')
            .eq('id', req.userId)
            .single();

        if (userError || !user) {
            console.error('❌ [CHANGE-PASSWORD] User not found:', userError);
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify current password
        console.log('🔒 [CHANGE-PASSWORD] Verifying current password...');
        const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);

        if (!passwordValid) {
            console.warn('⚠️ [CHANGE-PASSWORD] Current password incorrect');
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        console.log('🔒 [CHANGE-PASSWORD] Hashing new password...');
        const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update password
        console.log('📝 [CHANGE-PASSWORD] Updating password...');
        const { error: updateError } = await supabaseAdmin
            .from('users')
            .update({
                password_hash: newPasswordHash,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.userId);

        if (updateError) {
            console.error('❌ [CHANGE-PASSWORD] Error updating password:', updateError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to update password',
                details: process.env.NODE_ENV === 'production' ? undefined : updateError.message
            });
        }

        // Log password change
        try {
            const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            await logPasswordChange(req.userId!, ipAddress, userAgent);
        } catch (logError) {
            console.error('⚠️ [CHANGE-PASSWORD] Failed to log activity:', logError);
        }

        console.log('✅ [CHANGE-PASSWORD] Password changed successfully');

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error: any) {
        console.error('💥 [CHANGE-PASSWORD] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to change password',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

// ================================================================
// POST /api/auth/delete-account - Delete user account (requires password)
// ================================================================
authRouter.post('/delete-account', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        const { password } = req.body;

        console.log('🗑️ [DELETE-ACCOUNT] Request received for user:', req.userId);

        if (!password) {
            console.warn('⚠️ [DELETE-ACCOUNT] Missing password');
            return res.status(400).json({
                success: false,
                error: 'Password is required to delete account'
            });
        }

        // Get user with password
        console.log('🔍 [DELETE-ACCOUNT] Looking up user...');
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('password_hash, email')
            .eq('id', req.userId)
            .single();

        if (userError || !user) {
            console.error('❌ [DELETE-ACCOUNT] User not found:', userError);
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify password
        console.log('🔒 [DELETE-ACCOUNT] Verifying password...');
        const passwordValid = await bcrypt.compare(password, user.password_hash);

        if (!passwordValid) {
            console.warn('⚠️ [DELETE-ACCOUNT] Password incorrect');
            return res.status(401).json({
                success: false,
                error: 'Password is incorrect'
            });
        }

        // Log account deletion BEFORE deleting (activity_log has CASCADE DELETE)
        try {
            const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            await logAccountDeleted(req.userId!, ipAddress, userAgent);
        } catch (logError) {
            console.error('⚠️ [DELETE-ACCOUNT] Failed to log activity:', logError);
        }

        // Delete user (cascade will delete user_stores relationships)
        console.log('🗑️ [DELETE-ACCOUNT] Deleting user account...');
        const { error: deleteError } = await supabaseAdmin
            .from('users')
            .delete()
            .eq('id', req.userId);

        if (deleteError) {
            console.error('❌ [DELETE-ACCOUNT] Error deleting account:', deleteError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to delete account',
                details: process.env.NODE_ENV === 'production' ? undefined : deleteError.message
            });
        }

        console.log('✅ [DELETE-ACCOUNT] Account deleted successfully:', user.email);

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });
    } catch (error: any) {
        console.error('💥 [DELETE-ACCOUNT] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to delete account',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});

/**
 * GET /api/auth/stores
 * Fetch all stores associated with the authenticated user
 */
authRouter.get('/stores', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        console.log('🏪 [GET-STORES] Fetching stores for user:', req.userId);

        if (!req.userId) {
            console.error('❌ [GET-STORES] No userId in request');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
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
            console.error('❌ [GET-STORES] Error fetching stores:', storesError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to fetch stores',
                details: process.env.NODE_ENV === 'production' ? undefined : storesError.message
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

        console.log(`✅ [GET-STORES] Found ${stores.length} store(s) for user`);

        res.json({
            success: true,
            stores
        });
    } catch (error: any) {
        console.error('💥 [GET-STORES] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to fetch stores',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
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

        console.log('🌍 [UPDATE-TIMEZONE] Updating timezone for store:', storeId);

        if (!timezone) {
            console.error('❌ [UPDATE-TIMEZONE] Missing timezone');
            return res.status(400).json({
                success: false,
                error: 'Timezone is required'
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
            console.error('❌ [UPDATE-TIMEZONE] User does not have access to store');
            return res.status(403).json({
                success: false,
                error: 'Access denied'
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
            console.error('❌ [UPDATE-TIMEZONE] Error updating timezone:', updateError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to update timezone',
                details: process.env.NODE_ENV === 'production' ? undefined : updateError?.message
            });
        }

        console.log('✅ [UPDATE-TIMEZONE] Timezone updated successfully:', timezone);

        res.json({
            success: true,
            timezone: updatedStore.timezone
        });
    } catch (error: any) {
        console.error('💥 [UPDATE-TIMEZONE] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to update timezone',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
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

        console.log('💰 [UPDATE-CURRENCY] Updating currency for store:', storeId);

        if (!currency) {
            console.error('❌ [UPDATE-CURRENCY] Missing currency');
            return res.status(400).json({
                success: false,
                error: 'Currency is required'
            });
        }

        // Validate currency code (should be 3 characters)
        if (currency.length !== 3) {
            console.error('❌ [UPDATE-CURRENCY] Invalid currency code');
            return res.status(400).json({
                success: false,
                error: 'Currency code must be 3 characters (e.g., PYG, USD, ARS)'
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
            console.error('❌ [UPDATE-CURRENCY] User does not have access to store');
            return res.status(403).json({
                success: false,
                error: 'Access denied'
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
            console.error('❌ [UPDATE-CURRENCY] Error updating currency:', updateError);
            return res.status(500).json({
                success: false,
                error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to update currency',
                details: process.env.NODE_ENV === 'production' ? undefined : updateError?.message
            });
        }

        console.log('✅ [UPDATE-CURRENCY] Currency updated successfully:', currency);

        res.json({
            success: true,
            currency: updatedStore.currency
        });
    } catch (error: any) {
        console.error('💥 [UPDATE-CURRENCY] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'An error occurred' : 'Failed to update currency',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message
        });
    }
});
