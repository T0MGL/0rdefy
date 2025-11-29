// ================================================================
// ORDEFY API - MERCHANDISE/INBOUND SHIPMENTS ROUTES
// ================================================================
// Manages supplier purchases and inventory reception
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const merchandiseRouter = Router();

merchandiseRouter.use(verifyToken, extractStoreId);

// ================================================================
// GET /api/merchandise - List all shipments
// ================================================================
merchandiseRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      limit = '50',
      offset = '0',
      status,
      supplier_id,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    // Use the summary view for enriched data
    let query = supabaseAdmin
      .from('inbound_shipments_summary')
      .select('*', { count: 'exact' })
      .eq('store_id', req.storeId);

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (supplier_id) {
      query = query.eq('supplier_id', supplier_id);
    }

    // Apply sorting
    const validSortFields = ['created_at', 'estimated_arrival_date', 'total_cost', 'status', 'internal_reference'];
    const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'created_at';
    const sortDirection = sort_order === 'DESC';

    query = query
      .order(sortField, { ascending: !sortDirection })
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    res.json({
      data: data || [],
      pagination: {
        total: count || 0,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: parseInt(offset as string) + (data?.length || 0) < (count || 0)
      }
    });
  } catch (error: any) {
    console.error('[GET /api/merchandise] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch shipments',
      message: error.message
    });
  }
});

// ================================================================
// GET /api/merchandise/:id - Get single shipment with items
// ================================================================
merchandiseRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get shipment header
    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from('inbound_shipments_summary')
      .select('*')
      .eq('id', id)
      .eq('store_id', req.storeId)
      .single();

    if (shipmentError || !shipment) {
      return res.status(404).json({
        error: 'Shipment not found'
      });
    }

    // Get shipment items with product details
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('inbound_shipment_items')
      .select(`
        *,
        products:product_id (
          id,
          name,
          image,
          stock
        )
      `)
      .eq('shipment_id', id);

    if (itemsError) {
      throw itemsError;
    }

    // Flatten product data
    const enrichedItems = items?.map(item => ({
      ...item,
      product_name: item.products?.name,
      product_image: item.products?.image,
      product_stock: item.products?.stock
    })) || [];

    res.json({
      ...shipment,
      items: enrichedItems
    });
  } catch (error: any) {
    console.error(`[GET /api/merchandise/${req.params.id}] Error:`, error);
    res.status(500).json({
      error: 'Failed to fetch shipment',
      message: error.message
    });
  }
});

// ================================================================
// POST /api/merchandise - Create new shipment
// ================================================================
merchandiseRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      supplier_id,
      carrier_id,
      tracking_code,
      estimated_arrival_date,
      shipping_cost = 0,
      evidence_photo_url,
      notes,
      items
    } = req.body;

    // Validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'At least one item is required'
      });
    }

    // Validate items
    for (const item of items) {
      if (!item.product_id || !item.qty_ordered || !item.unit_cost) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Each item must have product_id, qty_ordered, and unit_cost'
        });
      }

      if (item.qty_ordered <= 0 || item.unit_cost < 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Quantity must be positive and cost cannot be negative'
        });
      }
    }

    // Generate internal reference
    const { data: referenceData, error: refError } = await supabaseAdmin
      .rpc('generate_inbound_reference', { p_store_id: req.storeId });

    if (refError) {
      throw refError;
    }

    const internal_reference = referenceData;

    // Create shipment
    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from('inbound_shipments')
      .insert([{
        store_id: req.storeId,
        internal_reference,
        supplier_id: supplier_id || null,
        carrier_id: carrier_id || null,
        tracking_code: tracking_code || null,
        estimated_arrival_date: estimated_arrival_date || null,
        shipping_cost: Number(shipping_cost) || 0,
        evidence_photo_url: evidence_photo_url || null,
        notes: notes || null,
        created_by: req.userId,
        status: 'pending'
      }])
      .select()
      .single();

    if (shipmentError) {
      throw shipmentError;
    }

    // Create shipment items
    const itemsToInsert = items.map(item => ({
      shipment_id: shipment.id,
      product_id: item.product_id,
      qty_ordered: Number(item.qty_ordered),
      unit_cost: Number(item.unit_cost)
    }));

    const { data: createdItems, error: itemsError } = await supabaseAdmin
      .from('inbound_shipment_items')
      .insert(itemsToInsert)
      .select();

    if (itemsError) {
      // Rollback shipment if items fail
      await supabaseAdmin
        .from('inbound_shipments')
        .delete()
        .eq('id', shipment.id);

      throw itemsError;
    }

    // Return complete shipment
    res.status(201).json({
      ...shipment,
      items: createdItems
    });
  } catch (error: any) {
    console.error('[POST /api/merchandise] Error:', error);
    res.status(500).json({
      error: 'Failed to create shipment',
      message: error.message
    });
  }
});

// ================================================================
// PATCH /api/merchandise/:id - Update shipment header
// ================================================================
merchandiseRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      supplier_id,
      carrier_id,
      tracking_code,
      estimated_arrival_date,
      shipping_cost,
      evidence_photo_url,
      notes
    } = req.body;

    // Verify ownership
    const { data: existing } = await supabaseAdmin
      .from('inbound_shipments')
      .select('id')
      .eq('id', id)
      .eq('store_id', req.storeId)
      .single();

    if (!existing) {
      return res.status(404).json({
        error: 'Shipment not found'
      });
    }

    // Build update object (only include provided fields)
    const updates: any = {};
    if (supplier_id !== undefined) updates.supplier_id = supplier_id;
    if (carrier_id !== undefined) updates.carrier_id = carrier_id;
    if (tracking_code !== undefined) updates.tracking_code = tracking_code;
    if (estimated_arrival_date !== undefined) updates.estimated_arrival_date = estimated_arrival_date;
    if (shipping_cost !== undefined) updates.shipping_cost = Number(shipping_cost);
    if (evidence_photo_url !== undefined) updates.evidence_photo_url = evidence_photo_url;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabaseAdmin
      .from('inbound_shipments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error(`[PATCH /api/merchandise/${req.params.id}] Error:`, error);
    res.status(500).json({
      error: 'Failed to update shipment',
      message: error.message
    });
  }
});

// ================================================================
// POST /api/merchandise/:id/receive - Receive shipment
// ================================================================
// This is the critical endpoint that updates inventory
merchandiseRouter.post('/:id/receive', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    // Validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Items array is required'
      });
    }

    // Verify ownership
    const { data: shipment } = await supabaseAdmin
      .from('inbound_shipments')
      .select('id, status')
      .eq('id', id)
      .eq('store_id', req.storeId)
      .single();

    if (!shipment) {
      return res.status(404).json({
        error: 'Shipment not found'
      });
    }

    if (shipment.status === 'received') {
      return res.status(400).json({
        error: 'Shipment already fully received'
      });
    }

    // Validate items
    for (const item of items) {
      if (!item.item_id || item.qty_received === undefined) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Each item must have item_id and qty_received'
        });
      }

      if (item.qty_received < 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Received quantity cannot be negative'
        });
      }
    }

    // Call the database function to process reception
    const { data: result, error } = await supabaseAdmin
      .rpc('receive_shipment_items', {
        p_shipment_id: id,
        p_items: items,
        p_received_by: req.userId
      });

    if (error) {
      throw error;
    }

    // Get updated shipment with items
    const { data: updatedShipment } = await supabaseAdmin
      .from('inbound_shipments_summary')
      .select('*')
      .eq('id', id)
      .single();

    res.json({
      success: true,
      ...result,
      shipment: updatedShipment
    });
  } catch (error: any) {
    console.error(`[POST /api/merchandise/${req.params.id}/receive] Error:`, error);
    res.status(500).json({
      error: 'Failed to receive shipment',
      message: error.message
    });
  }
});

// ================================================================
// DELETE /api/merchandise/:id - Delete shipment
// ================================================================
merchandiseRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verify ownership and status
    const { data: shipment } = await supabaseAdmin
      .from('inbound_shipments')
      .select('id, status')
      .eq('id', id)
      .eq('store_id', req.storeId)
      .single();

    if (!shipment) {
      return res.status(404).json({
        error: 'Shipment not found'
      });
    }

    // Don't allow deletion of received shipments (data integrity)
    if (shipment.status === 'received' || shipment.status === 'partial') {
      return res.status(400).json({
        error: 'Cannot delete shipment that has been received',
        message: 'Received shipments cannot be deleted to maintain inventory accuracy'
      });
    }

    // Delete (cascade will handle items)
    const { error } = await supabaseAdmin
      .from('inbound_shipments')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error(`[DELETE /api/merchandise/${req.params.id}] Error:`, error);
    res.status(500).json({
      error: 'Failed to delete shipment',
      message: error.message
    });
  }
});

// ================================================================
// GET /api/merchandise/stats/summary - Get merchandise statistics
// ================================================================
merchandiseRouter.get('/stats/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('inbound_shipments')
      .select('status, total_cost')
      .eq('store_id', req.storeId);

    if (error) {
      throw error;
    }

    const stats = {
      total_shipments: data.length,
      pending: data.filter(s => s.status === 'pending').length,
      partial: data.filter(s => s.status === 'partial').length,
      received: data.filter(s => s.status === 'received').length,
      total_investment: data.reduce((sum, s) => sum + Number(s.total_cost || 0), 0)
    };

    res.json(stats);
  } catch (error: any) {
    console.error('[GET /api/merchandise/stats/summary] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});
