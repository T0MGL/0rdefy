import { useRef, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '@/contexts/AuthContext';

export interface ShippingLabelProps {
    order: {
        id: string;
        order_number: string;
        customer_name: string;
        customer_phone: string;
        customer_address?: string;
        address_reference?: string;
        neighborhood?: string;
        delivery_notes?: string;
        carrier_name?: string;
        cod_amount?: number;
        delivery_link_token: string;
        items: Array<{
            product_name: string;
            quantity_needed: number;
        }>;
    };
    className?: string;
}

export function ShippingLabelTemplate({ order, className = '' }: ShippingLabelProps) {
    const { currentStore } = useAuth();
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
    const deliveryUrl = `${window.location.origin}/delivery/${order.delivery_link_token}`;

    useEffect(() => {
        QRCode.toDataURL(deliveryUrl, {
            width: 300,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' },
        })
            .then(setQrCodeUrl)
            .catch((err) => console.error('Error generating QR code:', err));
    }, [deliveryUrl]);

    return (
        <div className={`shipping-label-container ${className}`}>
            <div className="shipping-label">
                {/* Left Column: QR Code & Header */}
                <div className="label-left">
                    {/* Store Name & Header - Prominent */}
                    <div className="store-header">
                        <h1 className="store-name">{currentStore?.name}</h1>
                        <div className="order-tag">
                            <span className="label-type">ENTREGA</span>
                            <span className="order-id">#{order.order_number}</span>
                        </div>
                    </div>

                    <div className="qr-wrapper">
                        {qrCodeUrl ? (
                            <img src={qrCodeUrl} alt="QR Code" className="qr-code" />
                        ) : (
                            <div className="qr-placeholder">Generando...</div>
                        )}
                        <p className="qr-instruction">ESCANEAR PARA GESTIONAR</p>
                    </div>
                </div>

                {/* Right Column: Details */}
                <div className="label-right">
                    {/* Customer */}
                    <div className="section customer-section">
                        <div className="section-header">CLIENTE</div>
                        <div className="customer-details">
                            <p className="customer-name">{order.customer_name}</p>
                            <p className="customer-phone">{order.customer_phone}</p>
                            {order.customer_address && <p className="address">{order.customer_address}</p>}
                            {order.neighborhood && <p className="detail">Barrio: {order.neighborhood}</p>}
                            {order.address_reference && <p className="detail">Ref: {order.address_reference}</p>}
                            {order.delivery_notes && <p className="notes">Nota: {order.delivery_notes}</p>}
                        </div>
                    </div>

                    {/* Courier & COD */}
                    {(order.carrier_name || (order.cod_amount && order.cod_amount > 0)) && (
                        <div className="section courier-section">
                            <div className="flex-row">
                                {order.carrier_name && (
                                    <div className="courier-info">
                                        <span className="label">Repartidor:</span>
                                        <span className="value">{order.carrier_name}</span>
                                    </div>
                                )}
                                {order.cod_amount && order.cod_amount > 0 && (
                                    <div className="cod-info">
                                        <span className="label">COBRAR:</span>
                                        <span className="value money">Gs. {order.cod_amount.toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Products */}
                    <div className="section products-section">
                        <div className="section-header">PRODUCTOS</div>
                        <ul className="product-list">
                            {order.items.map((item, i) => (
                                <li key={i}>
                                    <span className="qty">{item.quantity_needed}x</span>
                                    <span className="name">{item.product_name}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            <style>{`
        .shipping-label-container {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            background: white;
            box-sizing: border-box;
            overflow: hidden;
        }

        .shipping-label {
            width: 100%;
            height: 100%;
            /* Aspect ratio target: 6/4 (1.5) */
            display: flex;
            flex-direction: row;
            border: 2px solid black;
            box-sizing: border-box;
            padding: 2%;
            gap: 2%;
            font-family: sans-serif;
            color: black;
            background: white;
        }

        /* LEFT COLUMN */
        .label-left {
            width: 35%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            border-right: 2px solid #ccc;
            padding-right: 2%;
        }

        .store-header {
            width: 100%;
            text-align: center;
            margin-bottom: auto;
        }

        .store-name {
            font-size: 1.4em; /* Relative unit */
            font-weight: 800;
            line-height: 1.1;
            margin: 0 0 5px 0;
            word-break: break-word;
        }

        .order-tag {
            border: 2px solid black;
            border-radius: 4px;
            padding: 2px 4px;
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            width: 90%;
        }

        .label-type {
            font-size: 0.6em;
            font-weight: 700;
            text-transform: uppercase;
        }

        .order-id {
            font-size: 0.9em;
            font-weight: 700;
            font-family: monospace;
        }

        .qr-wrapper {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-top: 10px;
        }

        .qr-code {
            width: 100%;
            height: auto;
            max-width: 140px; /* Limit max size */
            aspect-ratio: 1/1;
            border: 1px solid #000;
        }
        
        .qr-placeholder {
            width: 100%;
            aspect-ratio: 1/1;
            background: #eee;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.7em;
        }

        .qr-instruction {
            font-size: 0.6em;
            font-weight: 700;
            text-align: center;
            margin-top: 4px;
            line-height: 1.2;
        }

        /* RIGHT COLUMN */
        .label-right {
            width: 63%;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .section {
            border-bottom: 1px solid #ddd;
            padding-bottom: 4px;
        }
        
        .section:last-child {
            border-bottom: none;
        }

        .section-header {
            font-size: 0.65em;
            font-weight: 700;
            color: #555;
            text-transform: uppercase;
            margin-bottom: 2px;
        }

        .customer-name {
            font-size: 1.1em;
            font-weight: 700;
            margin: 0;
            line-height: 1.2;
        }

        .customer-phone {
            font-size: 0.9em;
            margin: 0;
        }

        .address {
            font-size: 0.8em;
            margin: 2px 0 0 0;
            line-height: 1.2;
        }

        .detail, .notes {
            font-size: 0.7em;
            margin: 1px 0 0 0;
            color: #444;
        }
        
        .notes {
            font-style: italic;
        }
        
        /* Courier Section */
        .flex-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
        }
        
        .courier-info, .cod-info {
            display: flex;
            flex-direction: column;
        }
        
        .label {
            font-size: 0.6em;
            color: #666;
        }
        
        .value {
            font-size: 0.9em;
            font-weight: 600;
        }
        
        .value.money {
            color: #b91c1c;
            font-weight: 800;
            font-size: 1.1em;
        }

        /* Product List */
        .product-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .product-list li {
            font-size: 0.75em;
            margin-bottom: 2px;
            display: flex;
            gap: 4px;
            line-height: 1.2;
        }

        .qty {
            font-weight: 700;
            min-width: 20px;
        }
        
        /* Responsive scaling base font size */
        .shipping-label {
            font-size: 12px; /* Default baseline */
        }
        
        /* Large container scaling */
        @container (min-width: 500px) {
            .shipping-label { font-size: 14px; }
        }

        @media print {
            @page {
                size: 6in 4in; /* 4x6 landscape = 6 wide x 4 tall */
                margin: 0;
            }

            html, body {
                margin: 0 !important;
                padding: 0 !important;
                width: 6in !important;
                height: 4in !important;
                overflow: hidden !important;
            }

            body * {
                visibility: hidden;
            }

            .shipping-label-container,
            .shipping-label-container * {
                visibility: visible;
            }

            .shipping-label-container {
                position: fixed;
                left: 0;
                top: 0;
                width: 6in !important;
                height: 4in !important;
                margin: 0;
                padding: 0;
                border: none;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .shipping-label {
                width: 6in !important;
                height: 4in !important;
                max-width: 6in !important;
                max-height: 4in !important;
                border: none;
                padding: 0.1in;
                box-sizing: border-box;
                font-size: 11px;
            }

            .qr-code {
                max-width: 1.2in !important;
            }
        }
      `}</style>
        </div>
    );
}
