/**
 * Utility function to print a label in a dedicated window
 * This is the most reliable technique for thermal label printing
 *
 * Why this approach?
 * 1. Isolates the label from the main page's CSS
 * 2. Gives full control over print styles
 * 3. Works consistently across browsers (Chrome, Safari, Firefox)
 * 4. Avoids conflicts with Tailwind, shadcn, and other framework CSS
 */

interface LabelData {
  storeName: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  neighborhood?: string;
  city?: string;
  addressReference?: string;
  carrierName?: string;
  codAmount?: number;
  paymentMethod?: string;
  deliveryToken: string;
  items: Array<{
    name: string;
    quantity: number;
  }>;
}

export function printShippingLabel(data: LabelData): Promise<boolean> {
  return new Promise((resolve) => {
    // Generate QR code URL using Google Charts API (reliable, no dependencies)
    const deliveryUrl = `${window.location.origin}/delivery/${data.deliveryToken}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deliveryUrl)}&format=png&margin=0`;

    // Determine if COD
    const isCOD = (data.paymentMethod === 'cash' || data.paymentMethod === 'efectivo') &&
                  data.codAmount && data.codAmount > 0;

    // Build items HTML
    const itemsHtml = data.items.slice(0, 4).map(item => `
      <tr>
        <td class="qty">${item.quantity}</td>
        <td class="item">${escapeHtml(item.name)}</td>
      </tr>
    `).join('');

    const moreItemsHtml = data.items.length > 4
      ? `<tr><td class="qty">+</td><td class="item">...y ${data.items.length - 4} items más</td></tr>`
      : '';

    // Payment box HTML
    const paymentBoxHtml = isCOD
      ? `<div class="cod-box">
           <div class="cod-label">COBRAR</div>
           <div class="cod-amount">Gs. ${data.codAmount?.toLocaleString()}</div>
         </div>`
      : `<div class="paid-box">
           <div class="paid-text">PAGADO</div>
           <div class="paid-sub">STANDARD</div>
         </div>`;

    // Create the complete HTML document
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Etiqueta ${data.orderNumber}</title>
  <style>
    /* === CRITICAL PRINT SETUP === */
    @page {
      size: 4in 6in;
      margin: 0;
    }

    @media print {
      html, body {
        width: 4in !important;
        height: 6in !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      .label {
        width: 4in !important;
        height: 6in !important;
        page-break-after: always;
        page-break-inside: avoid;
      }

      .no-print {
        display: none !important;
      }
    }

    /* === BASE STYLES === */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    html, body {
      width: 4in;
      height: 6in;
      background: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .label {
      width: 4in;
      height: 6in;
      background: white;
      color: black;
      display: flex;
      flex-direction: column;
      border: 4px solid black;
      overflow: hidden;
    }

    /* === HEADER ZONE (10%) === */
    .header {
      height: 10%;
      display: flex;
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

    /* === ADDRESS ZONE (35%) === */
    .address-zone {
      height: 35%;
      padding: 8px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      border-bottom: 4px solid black;
    }

    .zone-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .customer-name {
      font-size: 22px;
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
      font-size: 16px;
      font-weight: 600;
      line-height: 1.2;
      margin-bottom: 6px;
    }

    .city-ref {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .ref {
      margin-left: 8px;
      font-style: italic;
    }

    .phone {
      display: inline-block;
      padding: 2px 4px;
      border: 2px solid black;
      font-family: monospace;
      font-size: 14px;
      font-weight: 700;
    }

    /* === ACTION ZONE (30%) === */
    .action-zone {
      height: 30%;
      display: flex;
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
      max-width: 140px;
      height: auto;
      image-rendering: pixelated;
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

    .cod-box {
      width: 100%;
      background: black;
      color: white;
      padding: 8px 4px;
      margin-bottom: 8px;
    }

    .cod-label {
      font-size: 16px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .cod-amount {
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
    }

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

    /* === PACKING ZONE (25%) === */
    .packing-zone {
      height: 25%;
      padding: 4px;
    }

    .packing-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
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

    .qty {
      width: 15%;
      text-align: center;
      font-weight: 700;
    }

    .item {
      width: 85%;
    }

    /* === PREVIEW CONTROLS (screen only) === */
    .controls {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      padding: 12px 24px;
      border-radius: 8px;
      display: flex;
      gap: 12px;
      z-index: 1000;
    }

    .controls button {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-print {
      background: #22c55e;
      color: white;
    }

    .btn-print:hover {
      background: #16a34a;
    }

    .btn-close {
      background: #ef4444;
      color: white;
    }

    .btn-close:hover {
      background: #dc2626;
    }
  </style>
</head>
<body>
  <div class="label">
    <!-- HEADER -->
    <div class="header">
      <div class="store-name">${escapeHtml(data.storeName)}</div>
      <div class="order-number">#${escapeHtml(data.orderNumber)}</div>
    </div>

    <!-- ADDRESS -->
    <div class="address-zone">
      <div class="zone-label">ENTREGAR A / SHIP TO:</div>
      <div class="customer-name">${escapeHtml(data.customerName)}</div>
      <div class="customer-address">
        ${escapeHtml(data.customerAddress || '')}${data.neighborhood ? `, ${escapeHtml(data.neighborhood)}` : ''}
      </div>
      ${(data.city || data.addressReference) ? `
        <div class="city-ref">
          ${data.city ? `<span>${escapeHtml(data.city)}</span>` : ''}
          ${data.addressReference ? `<span class="ref">REF: ${escapeHtml(data.addressReference)}</span>` : ''}
        </div>
      ` : ''}
      <div class="phone">TEL: ${escapeHtml(data.customerPhone)}</div>
    </div>

    <!-- ACTION -->
    <div class="action-zone">
      <div class="qr-container">
        <img src="${qrCodeUrl}" alt="QR" class="qr-img" crossorigin="anonymous" />
      </div>
      <div class="action-details">
        ${paymentBoxHtml}
        <div class="carrier-info">SERVICIOS: ${escapeHtml(data.carrierName || 'PROPIO')}</div>
      </div>
    </div>

    <!-- PACKING LIST -->
    <div class="packing-zone">
      <table class="packing-table">
        <thead>
          <tr>
            <th class="qty">QTY</th>
            <th class="item">ITEM</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          ${moreItemsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <div class="controls no-print">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir</button>
    <button class="btn-close" onclick="window.close()">✕ Cerrar</button>
  </div>

  <script>
    // Wait for QR code to load before allowing print
    const qrImg = document.querySelector('.qr-img');

    qrImg.onload = function() {
      // Auto-print after short delay
      setTimeout(function() {
        window.print();
      }, 500);
    };

    qrImg.onerror = function() {
      // If QR fails to load, still allow printing
      console.warn('QR code failed to load, printing anyway');
      setTimeout(function() {
        window.print();
      }, 500);
    };

    // Notify parent window after print dialog closes
    window.onafterprint = function() {
      if (window.opener) {
        window.opener.postMessage({ type: 'LABEL_PRINTED', orderId: '${data.orderNumber}' }, '*');
      }
    };
  </script>
</body>
</html>
    `;

    // Open in new window
    const printWindow = window.open('', '_blank', 'width=450,height=700,scrollbars=no,menubar=no,toolbar=no,location=no,status=no');

    if (!printWindow) {
      console.error('Failed to open print window. Check popup blocker settings.');
      resolve(false);
      return;
    }

    printWindow.document.write(html);
    printWindow.document.close();

    // Listen for print completion message
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'LABEL_PRINTED') {
        window.removeEventListener('message', handleMessage);
        resolve(true);
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup listener after timeout
    setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      resolve(true); // Assume printed after timeout
    }, 30000);
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
