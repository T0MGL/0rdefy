// ================================================================
// NEONFLOW API - SUPPLIERS ROUTES
// ================================================================
// Supplier management with product relationships tracking
// Future-proof design for supplier-product assignments
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const suppliersRouter = Router();

suppliersRouter.use(verifyToken, extractStoreId);

// Using req.storeId from middleware

// ================================================================
// GET /api/suppliers - List all suppliers
// ================================================================
suppliersRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit = '50',
            offset = '0',
            search,
            min_rating,
            sort_by = 'name',
            sort_order = 'ASC'
        } = req.query;

        // Build base query
        let query = supabaseAdmin
            .from('suppliers')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        // Apply search filter
        if (search) {
            query = query.or(`name.ilike.%${search}%,contact_person.ilike.%${search}%,email.ilike.%${search}%`);
        }

        // Apply min_rating filter
        if (min_rating) {
            query = query.gte('rating', parseFloat(min_rating as string));
        }

        // Apply sorting
        const validSortFields = ['name', 'rating', 'created_at', 'contact_person'];
        const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'name';
        const sortDirection = sort_order === 'DESC';

        query = query
            .order(sortField, { ascending: sortDirection })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

        // Count products supplied by each supplier (future-proof for when we add this relationship)
        const suppliersWithCounts = await Promise.all((data || []).map(async (supplier) => {
            // This will be useful when we add supplier_id to products table
            const { count: productsCount } = await supabaseAdmin
                .from('products')
                .select('*', { count: 'exact', head: true })
                .eq('supplier_id', supplier.id);

            return {
                ...supplier,
                products_supplied: productsCount || 0
            };
        }));

        res.json({
            data: suppliersWithCounts || [],
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
                hasMore: parseInt(offset as string) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        console.error('[GET /api/suppliers] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch suppliers',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/suppliers/:id - Get single supplier
// ================================================================
suppliersRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('suppliers')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Supplier not found'
            });
        }

        // Get products supplied (future feature)
        const { count: productsCount } = await supabaseAdmin
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('supplier_id', id);

        res.json({
            ...data,
            products_supplied: productsCount || 0
        });
    } catch (error: any) {
        console.error(`[GET /api/suppliers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch supplier',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/suppliers - Create new supplier
// ================================================================
suppliersRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            name,
            contact_person,
            email,
            phone,
            rating = 0
        } = req.body;

        // Validation
        if (!name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Supplier name is required'
            });
        }

        // Validate rating if provided
        if (rating !== undefined && (rating < 0 || rating > 5)) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Rating must be between 0 and 5'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('suppliers')
            .insert([{
                store_id: req.storeId,
                name,
                contact_person,
                email,
                phone,
                rating: rating || 0
            }])
            .select()
            .single();

        if (error) {
            // Handle duplicate supplier name
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Duplicate supplier',
                    message: 'A supplier with this name already exists in this store'
                });
            }
            throw error;
        }

        res.status(201).json({
            message: 'Supplier created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/suppliers] Error:', error);
        res.status(500).json({
            error: 'Failed to create supplier',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/suppliers/:id - Update supplier
// ================================================================
suppliersRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name,
            contact_person,
            email,
            phone,
            rating
        } = req.body;

        // Build update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (name !== undefined) updateData.name = name;
        if (contact_person !== undefined) updateData.contact_person = contact_person;
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;

        // Validate rating if provided
        if (rating !== undefined) {
            if (rating < 0 || rating > 5) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Rating must be between 0 and 5'
                });
            }
            updateData.rating = rating;
        }

        const { data, error } = await supabaseAdmin
            .from('suppliers')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Supplier not found'
            });
        }

        res.json({
            message: 'Supplier updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/suppliers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update supplier',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/suppliers/:id - Delete supplier
// ================================================================
suppliersRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Check if supplier has products assigned (future feature)
        const { count, error: countError } = await supabaseAdmin
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('supplier_id', id);

        if (countError) {
            throw countError;
        }

        if (count && count > 0) {
            return res.status(409).json({
                error: 'Cannot delete supplier',
                message: `Supplier has ${count} product(s) assigned. Please reassign products before deleting.`
            });
        }

        const { data, error } = await supabaseAdmin
            .from('suppliers')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Supplier not found'
            });
        }

        res.json({
            message: 'Supplier deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/suppliers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete supplier',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/suppliers/:id/products - Get products from supplier
// ================================================================
suppliersRouter.get('/:id/products', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { limit = '20', offset = '0' } = req.query;

        // Verify supplier exists
        const { data: supplier, error: supplierError } = await supabaseAdmin
            .from('suppliers')
            .select('id, name')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (supplierError || !supplier) {
            return res.status(404).json({
                error: 'Supplier not found'
            });
        }

        // Get products from this supplier (future feature when we add supplier_id to products)
        const { data, error, count } = await supabaseAdmin
            .from('products')
            .select('*', { count: 'exact' })
            .eq('supplier_id', id)
            .eq('store_id', req.storeId)
            .order('name', { ascending: true })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        if (error) {
            throw error;
        }

        res.json({
            supplier: {
                id: supplier.id,
                name: supplier.name
            },
            data: data || [],
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
                hasMore: parseInt(offset as string) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        console.error(`[GET /api/suppliers/${req.params.id}/products] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch supplier products',
            message: error.message
        });
    }
});
