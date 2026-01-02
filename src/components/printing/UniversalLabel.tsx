import { useRef, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '@/contexts/AuthContext';

export interface UniversalLabelProps {
    order: {
        id: string;
        order_number: string;
        customer_name: string;
        customer_phone: string;
        customer_address?: string;
        address_reference?: string;
        city?: string;
        neighborhood?: string;
        delivery_notes?: string;
        carrier_name?: string;
        cod_amount?: number;
        payment_method?: string;
        delivery_link_token: string;
        financial_status?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
        items: Array<{
            product_name: string;
            quantity_needed: number;
        }>;
    };
    className?: string; // For testing/preview wrapper customization
}

export function UniversalLabel({ order, className = '' }: UniversalLabelProps) {
    const { currentStore } = useAuth();
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
    const deliveryUrl = `${window.location.origin}/delivery/${order.delivery_link_token}`;

    // Decide payment status box
    // Check both payment_method and cod_amount to ensure correct display
    const isCOD = (order.payment_method === 'cash' || order.payment_method === 'efectivo') &&
                  order.cod_amount &&
                  order.cod_amount > 0;
    // If explicitly paid or no COD amount, treat as standard/paid
    const isPaid = !isCOD;

    // Debug logging (can be removed after verification)
    console.log('🏷️ Label Data:', {
        orderId: order.id,
        payment_method: order.payment_method,
        cod_amount: order.cod_amount,
        isCOD,
        isPaid
    });

    useEffect(() => {
        QRCode.toDataURL(deliveryUrl, {
            width: 400,
            margin: 0,
            color: { dark: '#000000', light: '#FFFFFF' },
            errorCorrectionLevel: 'M',
        })
            .then(setQrCodeUrl)
            .catch((err) => console.error('Error generating QR code:', err));
    }, [deliveryUrl]);

    return (
        <div className={`universal-label-container ${className}`}>
            <div className="label-content">

                {/* ZONE A: Header (10%) */}
                <div className="zone-header">
                    <div className="store-name">{currentStore?.name || 'STORE'}</div>
                    <div className="order-number">#{order.order_number}</div>
                </div>

                {/* ZONE B: Delivery Address (35%) */}
                <div className="zone-address">
                    <div className="zone-label">ENTREGAR A / SHIP TO:</div>
                    <div className="customer-name">{order.customer_name}</div>
                    <div className="customer-address">
                        {order.customer_address}
                        {order.neighborhood && `, ${order.neighborhood}`}
                    </div>
                    <div className="customer-details">
                        {(order.city || order.address_reference) && (
                            <div className="city-ref">
                                {order.city && <span className="city">{order.city}</span>}
                                {order.address_reference && <span className="ref">REF: {order.address_reference}</span>}
                            </div>
                        )}
                        <span className="phone">TEL: {order.customer_phone}</span>
                    </div>
                </div>

                {/* ZONE C: Action & Scan (30%) */}
                <div className="zone-action">
                    <div className="qr-container">
                        {qrCodeUrl && <img src={qrCodeUrl} alt="QR Code" className="qr-img" />}
                    </div>
                    <div className="action-details">
                        {isCOD ? (
                            <div className="cod-box">
                                <div className="cod-label">COBRAR</div>
                                <div className="cod-amount">Gs. {order.cod_amount?.toLocaleString()}</div>
                            </div>
                        ) : (
                            <div className="paid-box">
                                <div className="paid-text">PAGADO</div>
                                <div className="paid-sub">STANDARD</div>
                            </div>
                        )}

                        <div className="carrier-info">
                            SERVICIOS: {order.carrier_name || 'PROPIO'}
                        </div>
                    </div>
                </div>

                {/* ZONE D: Packing List (25%) */}
                <div className="zone-packing">
                    <table className="packing-table">
                        <thead>
                            <tr>
                                <th className="th-qty">QTY</th>
                                <th className="th-item">ITEM</th>
                            </tr>
                        </thead>
                        <tbody>
                            {order.items.slice(0, 4).map((item, i) => (
                                <tr key={i}>
                                    <td className="td-qty">{item.quantity_needed}</td>
                                    <td className="td-item">{item.product_name}</td>
                                </tr>
                            ))}
                            {order.items.length > 4 && (
                                <tr>
                                    <td className="td-qty">+</td>
                                    <td className="td-item">...y {order.items.length - 4} items más</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

            </div>

            <style>{`
            /* Thermal Label 4x6 CSS Grid/Flex System */
            .universal-label-container {
                width: 384px; /* 4 inches at 96 DPI */
                height: 576px; /* 6 inches at 96 DPI */
                background: white;
                color: black;
                box-sizing: border-box;
                overflow: hidden;
                font-family: 'Courier New', Courier, monospace, sans-serif; /* Fallback to monospace for brutalist feel if system font fails */
                font-family: system-ui, -apple-system, sans-serif;
            }

            .label-content {
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                border: 4px solid black; /* Outer Frame */
                background: white;
            }

            /* --- ZONES --- */

            /* ZONE A: Header */
            .zone-header {
                height: 10%;
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                align-items: center;
                padding: 4px 8px;
                border-bottom: 4px solid black;
            }
            .store-name {
                font-size: 14px;
                font-weight: 800;
                text-transform: uppercase;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                max-width: 60%;
            }
            .order-number {
                font-size: 24px;
                font-weight: 900;
                letter-spacing: -1px;
            }

            /* ZONE B: Address */
            .zone-address {
                height: 35%;
                padding: 8px;
                display: flex;
                flex-direction: column;
                border-bottom: 4px solid black;
                justify-content: center;
            }
            .zone-label {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                margin-bottom: 4px;
                color: #000;
            }
            .customer-name {
                font-size: 22px; /* Huge */
                font-weight: 900;
                line-height: 1.1;
                margin-bottom: 4px;
                text-transform: uppercase;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }
            .customer-address {
                font-size: 16px; /* Large */
                font-weight: 600;
                line-height: 1.2;
                margin-bottom: 6px;
                flex-grow: 1; /* Allow consistent spacing */
            }
            .customer-details {
                margin-top: auto;
            }
            .city-ref {
                font-size: 12px;
                font-weight: 600;
                margin-bottom: 4px;
            }
            .ref { margin-left: 8px; font-style: italic; }
            .phone {
                display: inline-block;
                padding: 2px 4px;
                border: 2px solid black;
                font-family: monospace;
                font-size: 14px;
                font-weight: 700;
            }

            /* ZONE C: Action */
            .zone-action {
                height: 30%;
                display: flex;
                flex-direction: row;
                border-bottom: 4px solid black;
            }
            .qr-container {
                width: 45%;
                border-right: 4px solid black;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 8px;
            }
            .qr-img {
                width: 100%;
                height: auto;
                max-width: 1.8in;
                object-fit: contain;
                image-rendering: pixelated; /* Crisp QR */
            }
            .action-details {
                width: 55%;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 8px;
                align-items: center;
                text-align: center;
            }
            /* COD Box */
            .cod-box {
                width: 100%;
                background: black;
                color: white;
                padding: 8px 4px;
                margin-bottom: 8px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
            }
            .cod-label {
                font-size: 16px;
                font-weight: 900;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .cod-amount {
                font-size: 18px; /* Fit 1.000.000 */
                font-weight: 700;
                line-height: 1;
            }

            /* PAID Box */
            .paid-box {
                width: 100%;
                border: 4px solid black;
                padding: 8px 4px;
                margin-bottom: 8px;
            }
            .paid-text {
                font-size: 20px;
                font-weight: 900;
            }
            .paid-sub {
                font-size: 12px;
                font-weight: 600;
            }

            .carrier-info {
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
            }

            /* ZONE D: Packing List */
            .zone-packing {
                height: 25%;
                padding: 4px;
                font-size: 11px;
            }
            .packing-table {
                width: 100%;
                border-collapse: collapse;
            }
            .packing-table th {
                text-align: left;
                border-bottom: 2px solid black;
                padding: 2px;
                font-weight: 800;
            }
            .packing-table td {
                padding: 2px;
                border-bottom: 1px solid #ccc;
                vertical-align: top;
            }
            .th-qty, .td-qty { width: 15%; text-align: center; font-weight: 700; }
            .th-item, .td-item { width: 85%; }


            /* PRINT MEDIA QUERY - CRITICAL */
            @media print {
                @page {
                    size: 4in 6in;
                    margin: 0;
                }

                html, body {
                    margin: 0;
                    padding: 0;
                    width: 4in;
                    height: 6in;
                    background: white;
                }

                .universal-label-container {
                    position: relative; /* Changed from absolute to relative to fix batch stacking */
                    width: 4in !important;
                    height: 6in !important;
                    page-break-after: always;
                    break-after: page;
                    page-break-inside: avoid;
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                    overflow: hidden;
                }

                /* Hide everything else */
                body * {
                    visibility: hidden;
                }
                .universal-label-container, .universal-label-container * {
                    visibility: visible;
                }
            }
        `}</style>
        </div>
    );
}
