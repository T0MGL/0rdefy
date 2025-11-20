# Shopify GDPR Endpoints - Configuración

## Endpoints Obligatorios para Apps Públicas de Shopify

Estos tres endpoints son **obligatorios** para cumplir con los requisitos GDPR de Shopify para apps públicas.

### 1. Customer Data Request
**URL:** `https://api.ordefy.io/api/shopify/webhook/customers/data_request`

**Propósito:** Shopify llama a este endpoint cuando un cliente solicita sus datos personales.

**TODO:** Implementar la lógica para:
- Recopilar todos los datos del cliente de la base de datos
- Enviar los datos al email proporcionado en el webhook
- Registrar la solicitud para auditoría

### 2. Customer Data Redaction
**URL:** `https://api.ordefy.io/api/shopify/webhook/customers/redact`

**Propósito:** Shopify llama a este endpoint cuando un cliente solicita la eliminación de sus datos.

**TODO:** Implementar la lógica para:
- Anonimizar o eliminar datos personales del cliente
- Mantener datos necesarios para registros contables (48 meses)
- Registrar la solicitud de redacción

### 3. Shop Data Redaction
**URL:** `https://api.ordefy.io/api/shopify/webhook/shop/redact`

**Propósito:** Shopify llama a este endpoint cuando una tienda desinstala la app.

**TODO:** Implementar la lógica para:
- Eliminar o anonimizar todos los datos de la tienda
- Eliminar productos, clientes, órdenes sincronizados
- Desactivar la integración de Shopify
- Registrar la solicitud de eliminación

## Configuración en Shopify Partner Dashboard

1. Ve a tu app en https://partners.shopify.com/
2. Navega a: **Extensions → Configure → Compliance webhooks**
3. Configura las siguientes URLs:

```
Customer data request endpoint:
https://api.ordefy.io/api/shopify/webhook/customers/data_request

Customer data erasure endpoint:
https://api.ordefy.io/api/shopify/webhook/customers/redact

Shop data erasure endpoint:
https://api.ordefy.io/api/shopify/webhook/shop/redact
```

## Seguridad

✅ **HMAC Verification:** Todos los endpoints verifican la firma HMAC usando `X-Shopify-Hmac-Sha256`
✅ **No Authentication:** No requieren JWT (son webhooks públicos de Shopify)
✅ **Domain Validation:** Verifican que el `X-Shopify-Shop-Domain` corresponda a una integración activa
✅ **Error Handling:** Responden 200 OK si el HMAC es válido, 401 si es inválido

## Testing

### Test HMAC Verification

```bash
# Generar HMAC válido para testing
echo -n '{"shop_domain":"example.myshopify.com","customer_id":123}' | \
  openssl dgst -sha256 -hmac "YOUR_SHOPIFY_API_SECRET" -binary | \
  base64

# Test endpoint
curl -X POST http://localhost:3001/api/shopify/webhook/customers/data_request \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: example.myshopify.com" \
  -H "X-Shopify-Hmac-Sha256: BASE64_HMAC_FROM_ABOVE" \
  -d '{"shop_domain":"example.myshopify.com","customer_id":123}'
```

### Expected Responses

**Success (200):**
```json
{
  "success": true
}
```

**Invalid HMAC (401):**
```json
{
  "error": "Unauthorized - invalid HMAC"
}
```

**Missing Headers (401):**
```json
{
  "error": "Unauthorized - missing headers"
}
```

## Implementation Status

- ✅ Endpoints created with HMAC verification
- ✅ Domain validation
- ✅ Error handling and logging
- ⚠️ **TODO:** Implement actual data handling logic (marked with `// TODO` in code)

## Next Steps

1. **Customer Data Request:** Implement data export to CSV/JSON
2. **Customer Redact:** Implement anonymization logic (keep order history but remove PII)
3. **Shop Redact:** Implement complete data deletion workflow
4. **Testing:** Create automated tests for all three endpoints
5. **Monitoring:** Add metrics to track GDPR requests

## Compliance Notes

- **48-hour response time:** Shopify requires responses within 48 hours
- **Data retention:** Some data (invoices, tax records) must be kept for legal compliance
- **Audit trail:** Log all GDPR requests for compliance auditing
- **Email confirmation:** Send confirmation emails to customers when data is processed
