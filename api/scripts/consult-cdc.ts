/**
 * consult-cdc.ts
 *
 * READ-ONLY. Consulta un DE en SIFEN por su CDC para confirmar si SET lo tiene
 * registrado y en que estado. NO firma, NO envia lote, NO toca la tabla
 * invoices. Util cuando un envio de lote dio timeout (DSP_FAIL) y no sabemos si
 * el documento llego a aprobarse del lado de SET antes de cortarse la respuesta.
 *
 * Uso (correr donde exista SIFEN_ENCRYPTION_KEY, ej. Railway):
 *   railway run --service <api> npx tsx api/scripts/consult-cdc.ts <CDC> [identityId] [env]
 *
 * Defaults: identityId = Bright Commerce Group, env = prod.
 *
 * Interpretacion del dCodRes:
 *   0420 / banda aprobado  -> el documento existe y esta aprobado. NO reintentar.
 *   rechazado              -> SET lo registro y rechazo. Reintentar (CDC nuevo).
 *   inexistente / no hallado-> el timeout no llego a registrar nada. Reintentar seguro.
 */

import 'dotenv/config';
import { loadCertificateMaterial } from '../services/invoicing.service';
import { consultDE } from '../services/sifen/sifen-client';

const DEFAULT_IDENTITY = '3d3f8c42-88a2-4b30-9e11-b9d44fd13460'; // Bright Commerce Group E.A.S.

async function main() {
  const cdc = process.argv[2];
  const identityId = process.argv[3] || DEFAULT_IDENTITY;
  const env = (process.argv[4] || 'prod') as 'prod' | 'test';

  if (!cdc || !/^[0-9]{44}$/.test(cdc)) {
    console.error('Uso: npx tsx api/scripts/consult-cdc.ts <CDC de 44 digitos> [identityId] [env]');
    process.exit(1);
  }

  if (!process.env.SIFEN_ENCRYPTION_KEY) {
    console.error('[FAIL] Falta SIFEN_ENCRYPTION_KEY en el entorno. Corré con: railway run ...');
    process.exit(1);
  }

  console.log('\n=== SIFEN CONSULTA CDC (read-only) ===');
  console.log(`CDC:      ${cdc}`);
  console.log(`Identity: ${identityId}`);
  console.log(`Env:      ${env}\n`);

  let mtls: { certPem: string; privateKeyPem: string };
  try {
    const material = await loadCertificateMaterial(identityId);
    mtls = { certPem: material.certPem, privateKeyPem: material.privateKeyPem };
    console.log('[OK] Credenciales descifradas.\n');
  } catch (err) {
    console.error('[FAIL] No se pudo cargar el certificado:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  try {
    console.log('[STEP] Consultando a SIFEN...');
    const res = await consultDE(cdc, env, mtls);
    console.log('\n--- RESPUESTA SIFEN ---');
    console.log(JSON.stringify(res, null, 2));
    console.log('--- FIN RESPUESTA ---\n');
    console.log('Leé dCodRes/dMsgRes arriba:');
    console.log('  aprobado    -> NO reintentar, marcar approved a mano.');
    console.log('  rechazado   -> reintentar (genera CDC nuevo).');
    console.log('  inexistente -> reintentar seguro (SET nunca lo registró).');
  } catch (err) {
    console.error('[FAIL] Error en la consulta:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
