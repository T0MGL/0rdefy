/**
 * Upload Routes - Image Upload Endpoints
 *
 * Handles file uploads for avatars, products, and merchandise images.
 * Supports both file upload and base64 data.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { verifyToken, extractStoreId } from '../middleware/auth';
import storageService from '../services/storage.service';

const router = Router();

// Configure multer for memory storage (we'll upload to Supabase)
// @ts-ignore - multer types issue
const upload = (multer as any)({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  }
});

// Middleware to handle multer errors
const handleMulterError = (err: any, req: Request, res: Response, next: Function) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

/**
 * POST /api/upload/avatar
 * Upload user avatar
 */
router.post(
  '/avatar',
  verifyToken,
  extractStoreId,
  upload.single('file'),
  handleMulterError,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const storeId = (req as any).storeId;

      if (!req.file && !req.body.base64) {
        return res.status(400).json({ error: 'No file or base64 data provided' });
      }

      let result;

      if (req.file) {
        // File upload
        result = await storageService.uploadAvatar(
          req.file.buffer,
          req.file.mimetype,
          storeId,
          userId,
          req.file.originalname
        );
      } else if (req.body.base64) {
        // Base64 upload
        result = await storageService.uploadFromBase64(
          'avatars',
          req.body.base64,
          storeId,
          userId
        );
      }

      if (!result?.success) {
        return res.status(400).json({ error: result?.error || 'Upload failed' });
      }

      // Update user's avatar_url in database
      const { supabaseAdmin } = await import('../db/connection');
      await supabaseAdmin
        .from('users')
        .update({ avatar_url: result.url })
        .eq('id', userId);

      res.json({
        success: true,
        url: result.url,
        path: result.path
      });
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      res.status(500).json({ error: 'Failed to upload avatar' });
    }
  }
);

/**
 * POST /api/upload/product/:productId
 * Upload product image
 */
router.post(
  '/product/:productId',
  verifyToken,
  extractStoreId,
  upload.single('file'),
  handleMulterError,
  async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const storeId = (req as any).storeId;

      if (!req.file && !req.body.base64) {
        return res.status(400).json({ error: 'No file or base64 data provided' });
      }

      let result;

      if (req.file) {
        result = await storageService.uploadProductImage(
          req.file.buffer,
          req.file.mimetype,
          storeId,
          productId,
          req.file.originalname
        );
      } else if (req.body.base64) {
        result = await storageService.uploadFromBase64(
          'products',
          req.body.base64,
          storeId,
          productId
        );
      }

      if (!result?.success) {
        return res.status(400).json({ error: result?.error || 'Upload failed' });
      }

      // Update product's image_url in database
      const { supabaseAdmin } = await import('../db/connection');
      await supabaseAdmin
        .from('products')
        .update({ image_url: result.url })
        .eq('id', productId)
        .eq('store_id', storeId);

      res.json({
        success: true,
        url: result.url,
        path: result.path
      });
    } catch (err: any) {
      console.error('Product image upload error:', err);
      res.status(500).json({ error: 'Failed to upload product image' });
    }
  }
);

/**
 * POST /api/upload/merchandise/:shipmentId
 * Upload merchandise/shipment image
 */
router.post(
  '/merchandise/:shipmentId',
  verifyToken,
  extractStoreId,
  upload.single('file'),
  handleMulterError,
  async (req: Request, res: Response) => {
    try {
      const { shipmentId } = req.params;
      const storeId = (req as any).storeId;

      if (!req.file && !req.body.base64) {
        return res.status(400).json({ error: 'No file or base64 data provided' });
      }

      let result;

      if (req.file) {
        result = await storageService.uploadMerchandiseImage(
          req.file.buffer,
          req.file.mimetype,
          storeId,
          shipmentId,
          req.file.originalname
        );
      } else if (req.body.base64) {
        result = await storageService.uploadFromBase64(
          'merchandise',
          req.body.base64,
          storeId,
          shipmentId
        );
      }

      if (!result?.success) {
        return res.status(400).json({ error: result?.error || 'Upload failed' });
      }

      res.json({
        success: true,
        url: result.url,
        path: result.path
      });
    } catch (err: any) {
      console.error('Merchandise image upload error:', err);
      res.status(500).json({ error: 'Failed to upload merchandise image' });
    }
  }
);

/**
 * POST /api/upload/base64
 * Generic base64 upload endpoint
 * Body: { bucket: 'avatars'|'products'|'merchandise', base64: 'data:image/...', entityId: 'uuid' }
 */
router.post(
  '/base64',
  verifyToken,
  extractStoreId,
  async (req: Request, res: Response) => {
    try {
      const { bucket, base64, entityId, filename } = req.body;
      const storeId = (req as any).storeId;
      const userId = (req as any).userId;

      if (!bucket || !base64 || !entityId) {
        return res.status(400).json({
          error: 'Missing required fields: bucket, base64, entityId'
        });
      }

      const validBuckets = ['avatars', 'products', 'merchandise'];
      if (!validBuckets.includes(bucket)) {
        return res.status(400).json({
          error: `Invalid bucket. Valid options: ${validBuckets.join(', ')}`
        });
      }

      // For avatars, use the current user ID
      const targetEntityId = bucket === 'avatars' ? userId : entityId;

      const result = await storageService.uploadFromBase64(
        bucket,
        base64,
        storeId,
        targetEntityId,
        filename
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        url: result.url,
        path: result.path
      });
    } catch (err: any) {
      console.error('Base64 upload error:', err);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  }
);

/**
 * DELETE /api/upload/product/:productId
 * Delete all images for a product
 */
router.delete(
  '/product/:productId',
  verifyToken,
  extractStoreId,
  async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const storeId = (req as any).storeId;

      await storageService.deleteProductImages(storeId, productId);

      // Clear image_url in database
      const { supabaseAdmin } = await import('../db/connection');
      await supabaseAdmin
        .from('products')
        .update({ image_url: null })
        .eq('id', productId)
        .eq('store_id', storeId);

      res.json({ success: true });
    } catch (err: any) {
      console.error('Product image delete error:', err);
      res.status(500).json({ error: 'Failed to delete product images' });
    }
  }
);

export default router;
