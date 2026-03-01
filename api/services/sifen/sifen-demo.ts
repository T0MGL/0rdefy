/**
 * SIFEN Demo Mode Service
 *
 * Returns mock responses without sending anything to SIFEN.
 * Generates real CDC and XML (using xmlgen) for full end-to-end testing.
 * Invoices are stored with sifen_status = 'demo'.
 */

import { SifenResponse } from './sifen-client';

/**
 * Simulate sending a DE. Returns a mock "approved" response.
 */
export function mockSendDE(id: string, cdc: string): SifenResponse {
  return {
    success: true,
    responseCode: '0260',
    responseMessage: 'Documento electrónico aprobado (DEMO)',
    cdc,
  };
}

/**
 * Simulate consulting a DE.
 */
export function mockConsultDE(cdc: string): SifenResponse {
  return {
    success: true,
    responseCode: '0260',
    responseMessage: 'Documento encontrado (DEMO)',
    cdc,
  };
}

/**
 * Simulate sending a SIFEN event (cancellation, etc.).
 */
export function mockSendEvent(cdc: string, eventType: number): SifenResponse {
  return {
    success: true,
    responseCode: '0260',
    responseMessage: `Evento tipo ${eventType} procesado (DEMO)`,
    cdc,
  };
}
