/**
 * Carrier adapter contract.
 *
 * One concrete adapter per provider behind a minimal interface. v1 ships
 * Punto a Punto only; the registry exists so country gating and provider
 * dispatch stay data-driven (a future carrier in another country is added
 * here without touching the routes or the push service).
 */

export interface CarrierCredentials {
  username: string;
  password: string;
  tenantId: string;
  baseUrl: string;
}

export interface CarrierOrderInput {
  storeId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerDocument: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  description: string | null;
  codAmount: number;
}

export interface CarrierShipmentResult {
  externalId: string;
  nroGuia: string;
}

export interface CarrierAdapter {
  validateCredentials(creds: CarrierCredentials): Promise<{ ok: boolean; error?: string }>;
  createShipment(creds: CarrierCredentials, order: CarrierOrderInput): Promise<CarrierShipmentResult>;
  /**
   * Read-only existence check used as a secondary idempotency guard before a
   * write. Returns the external id if the carrier already has a package for
   * this reference, null otherwise.
   */
  findExistingByReference(creds: CarrierCredentials, reference: string): Promise<{ externalId: string; nroGuia: string } | null>;
}

export interface CarrierRegistryEntry {
  adapter: CarrierAdapter;
  availableCountries: string[];
}

const registry = new Map<string, CarrierRegistryEntry>();

export function registerCarrier(provider: string, entry: CarrierRegistryEntry): void {
  registry.set(provider, entry);
}

export function getCarrier(provider: string): CarrierRegistryEntry | null {
  return registry.get(provider) ?? null;
}

export function isProviderAvailableInCountry(provider: string, country: string): boolean {
  const entry = registry.get(provider);
  if (!entry) return false;
  return entry.availableCountries.includes(country.toUpperCase());
}

export function listProvidersForCountry(country: string): string[] {
  const upper = country.toUpperCase();
  return Array.from(registry.entries())
    .filter(([, entry]) => entry.availableCountries.includes(upper))
    .map(([provider]) => provider);
}
