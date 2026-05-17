/**
 * In-process cache for SIFEN material (decrypted private keys + CSC).
 *
 * Descifrar AES-256-GCM por cada lote despachado o cada poll de SIFEN es
 * costoso en CPU (~1-2 ms por op). Cuando el worker procesa cientos de
 * lotes/dia el costo agregado es significativo, y peor todavia con
 * decenas de identidades porque cada poll de un lote especifico necesita
 * rehidratar el cert + key + CSC.
 *
 * El cache mantiene los PEM en memoria con TTL acotado para que una
 * rotacion de certificado en DB no quede invisible mas que unos minutos.
 * No persiste a disco bajo ninguna circunstancia.
 *
 * Es un LRU minimalista (Map + size cap) porque la complejidad de pg
 * lru-cache (eviction policies, async) no aporta a 100 identidades de
 * cap. Si crecemos a miles de identidades simultaneas en el mismo proceso
 * vale la pena cambiar a `lru-cache` lib.
 */

export interface SifenKeyMaterial {
  certPem: string;
  privateKeyPem: string;
  csc: string | null;
}

interface CacheEntry {
  material: SifenKeyMaterial;
  expiresAt: number;
}

export interface KeyCacheOptions {
  /** Maximo de entries antes de evictar la mas vieja. */
  max?: number;
  /** TTL por entry, en milisegundos. */
  ttlMs?: number;
}

export class SifenKeyCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly max: number;
  private readonly ttlMs: number;

  constructor(options: KeyCacheOptions = {}) {
    this.max = Math.max(1, options.max ?? 100);
    this.ttlMs = Math.max(1_000, options.ttlMs ?? 5 * 60 * 1_000);
  }

  get(identityId: string): SifenKeyMaterial | null {
    const entry = this.entries.get(identityId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(identityId);
      return null;
    }
    // Touch: Map preserva orden de insercion, asi que delete + set lleva
    // la entry al final (mas reciente). LRU eviction abajo borra la
    // primera key que es la mas vieja sin uso.
    this.entries.delete(identityId);
    this.entries.set(identityId, entry);
    return entry.material;
  }

  set(identityId: string, material: SifenKeyMaterial): void {
    if (this.entries.has(identityId)) {
      this.entries.delete(identityId);
    } else if (this.entries.size >= this.max) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(identityId, {
      material,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Forzar invalidacion (ej. rotacion de certificado). */
  invalidate(identityId: string): void {
    this.entries.delete(identityId);
  }

  /** Drop everything. Util en SIGTERM. */
  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
