export interface UnifiedOrder {
    id: string;
    order_number: string;
    customer_name: string;
    store_id: string;
    store_name: string;
    created_at: string;
    total_items: number;
}

export interface UnifiedSession {
    id: string;
    code: string;
    status: 'picking' | 'packing';
    created_at: string;
    store_id: string;
    store_name: string;
}

export interface UnifiedDispatchOrder {
    id: string;
    order_number: string;
    customer: string;
    address?: string;
    carrier: string;
    cod_amount: number;
    store_id: string;
    store_name: string;
}

export interface UnifiedOrderListItem {
    id: string;
    order_number: string;
    customer: string;
    total: number;
    status: string;
    payment_status: string;
    date: string;
    store_id: string;
    store_name: string;
}
