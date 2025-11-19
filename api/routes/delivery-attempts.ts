import { Router, Response } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { uploadDeliveryPhoto } from '../services/delivery-photo-cleanup.service';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  },
});

export const deliveryAttemptsRouter = Router();

// All routes require authentication and store context
deliveryAttemptsRouter.use(verifyToken);
deliveryAttemptsRouter.use(extractStoreId);

// ================================================================
// POST /api/delivery-attempts/upload-photo - Upload delivery photo
// ================================================================
deliveryAttemptsRouter.post('/upload-photo', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    console.log('📤 [DELIVERY-PHOTO] Uploading photo for order:', order_id);

    // Upload photo to Supabase Storage
    const photoUrl = await uploadDeliveryPhoto(
      req.file.buffer,
      req.storeId!,
      order_id,
      req.file.mimetype
    );

    console.log('✅ [DELIVERY-PHOTO] Photo uploaded successfully:', photoUrl);

    res.json({
      message: 'Photo uploaded successfully',
      url: photoUrl,
    });
  } catch (error: any) {
    console.error('💥 [DELIVERY-PHOTO] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload photo' });
  }
});

// ================================================================
// GET /api/delivery-attempts - List all delivery attempts
// Query params: order_id, status, limit, offset
// ================================================================
deliveryAttemptsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { order_id, status, limit = '50', offset = '0' } = req.query;

    console.log('📋 [DELIVERY-ATTEMPTS] Fetching attempts:', {
      store_id: req.storeId,
      order_id,
      status,
      limit,
      offset
    });

    let query = supabaseAdmin
      .from('delivery_attempts')
      .select('*, orders!inner(shopify_order_number, customer_first_name, customer_last_name, customer_phone)', { count: 'exact' })
      .eq('store_id', req.storeId)
      .order('created_at', { ascending: false });

    if (order_id) {
      query = query.eq('order_id', order_id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(
      parseInt(offset as string),
      parseInt(offset as string) + parseInt(limit as string) - 1
    );

    const { data, error, count } = await query;

    if (error) {
      console.error('❌ [DELIVERY-ATTEMPTS] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch delivery attempts' });
    }

    res.json({
      data,
      pagination: {
        total: count || 0,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: count ? count > parseInt(offset as string) + parseInt(limit as string) : false
      }
    });
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// GET /api/delivery-attempts/:id - Get single attempt
// ================================================================
deliveryAttemptsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .select('*, orders!inner(shopify_order_number, customer_first_name, customer_last_name, customer_phone)')
      .eq('id', id)
      .eq('store_id', req.storeId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Delivery attempt not found' });
    }

    res.json(data);
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// POST /api/delivery-attempts - Create new attempt
// ================================================================
deliveryAttemptsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      order_id,
      scheduled_date,
      status = 'scheduled',
      notes,
      carrier_id
    } = req.body;

    if (!order_id || !scheduled_date) {
      return res.status(400).json({ error: 'order_id and scheduled_date are required' });
    }

    console.log('📝 [DELIVERY-ATTEMPTS] Creating attempt for order:', order_id);

    // Get current attempt count for this order
    const { data: existingAttempts } = await supabaseAdmin
      .from('delivery_attempts')
      .select('attempt_number')
      .eq('order_id', order_id)
      .order('attempt_number', { ascending: false })
      .limit(1);

    const attempt_number = existingAttempts && existingAttempts.length > 0
      ? existingAttempts[0].attempt_number + 1
      : 1;

    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .insert({
        order_id,
        store_id: req.storeId,
        attempt_number,
        scheduled_date,
        status,
        notes,
        carrier_id,
        created_by: req.userId
      })
      .select()
      .single();

    if (error) {
      console.error('❌ [DELIVERY-ATTEMPTS] Error creating:', error);
      return res.status(500).json({ error: 'Failed to create delivery attempt' });
    }

    // Update order delivery_attempts count
    await supabaseAdmin
      .from('orders')
      .update({ delivery_attempts: attempt_number })
      .eq('id', order_id);

    console.log('✅ [DELIVERY-ATTEMPTS] Created:', data.id);

    res.status(201).json({
      message: 'Delivery attempt created',
      data
    });
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// PUT /api/delivery-attempts/:id - Update attempt
// ================================================================
deliveryAttemptsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.order_id;
    delete updates.store_id;
    delete updates.attempt_number;
    delete updates.created_at;

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .update(updates)
      .eq('id', id)
      .eq('store_id', req.storeId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Delivery attempt not found' });
    }

    console.log('✅ [DELIVERY-ATTEMPTS] Updated:', id);

    res.json({
      message: 'Delivery attempt updated',
      data
    });
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// POST /api/delivery-attempts/:id/mark-delivered - Mark as delivered
// ================================================================
deliveryAttemptsRouter.post('/:id/mark-delivered', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { photo_url, notes, payment_method } = req.body;

    console.log('✅ [DELIVERY-ATTEMPTS] Marking as delivered:', id);

    // Validate payment_method if provided
    const validPaymentMethods = ['efectivo', 'tarjeta', 'transferencia', 'yape', 'plin', 'otro'];
    if (payment_method && !validPaymentMethods.includes(payment_method.toLowerCase())) {
      return res.status(400).json({
        error: 'Invalid payment method',
        valid_methods: validPaymentMethods
      });
    }

    // Update delivery attempt
    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from('delivery_attempts')
      .update({
        status: 'delivered',
        actual_date: new Date().toISOString().split('T')[0],
        photo_url,
        notes,
        payment_method: payment_method || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('store_id', req.storeId)
      .select()
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({ error: 'Delivery attempt not found' });
    }

    // Update order status and payment_status
    const { error: orderError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'delivered',
        payment_status: 'collected',
        updated_at: new Date().toISOString()
      })
      .eq('id', attempt.order_id);

    if (orderError) {
      console.error('⚠️ [DELIVERY-ATTEMPTS] Could not update order:', orderError);
    }

    res.json({
      message: 'Delivery marked as successful',
      data: attempt
    });
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// POST /api/delivery-attempts/:id/mark-failed - Mark as failed
// ================================================================
deliveryAttemptsRouter.post('/:id/mark-failed', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { failed_reason, notes, failure_notes, status = 'failed' } = req.body;

    if (!failed_reason) {
      return res.status(400).json({ error: 'failed_reason is required' });
    }

    console.log('❌ [DELIVERY-ATTEMPTS] Marking as failed:', id);

    // Update delivery attempt
    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from('delivery_attempts')
      .update({
        status,
        actual_date: new Date().toISOString().split('T')[0],
        failed_reason,
        notes,
        failure_notes: failure_notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('store_id', req.storeId)
      .select()
      .single();

    if (attemptError || !attempt) {
      return res.status(404).json({ error: 'Delivery attempt not found' });
    }

    // Update order with failed reason and status
    const { error: orderError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'delivery_failed',
        failed_reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', attempt.order_id);

    if (orderError) {
      console.error('⚠️ [DELIVERY-ATTEMPTS] Could not update order:', orderError);
    }

    res.json({
      message: 'Delivery marked as failed',
      data: attempt
    });
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// DELETE /api/delivery-attempts/:id - Delete attempt
// ================================================================
deliveryAttemptsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('delivery_attempts')
      .delete()
      .eq('id', id)
      .eq('store_id', req.storeId);

    if (error) {
      console.error('❌ [DELIVERY-ATTEMPTS] Error deleting:', error);
      return res.status(500).json({ error: 'Failed to delete delivery attempt' });
    }

    console.log('🗑️ [DELIVERY-ATTEMPTS] Deleted:', id);

    res.json({ message: 'Delivery attempt deleted' });
  } catch (error: any) {
    console.error('💥 [DELIVERY-ATTEMPTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
