/**
 * Notification id helpers.
 *
 * Kept in its own module (no Vite/`import.meta.env` dependencies) so the pure
 * id logic is unit-testable under the Node test runner without pulling in the
 * notification engine's runtime-only imports (logger, services).
 */

/**
 * Stable, order-independent hash of a set of ids. Used to suffix notification
 * ids so that a notification whose affected set changes (a new order arrives,
 * an old one is resolved) becomes a DISTINCT notification and does not inherit
 * the read state of the previous set. Sorting first makes the hash invariant to
 * the order rows come back from the API. djb2 (xor variant), base36 encoded.
 *
 * This is a content fingerprint, not a security hash: collisions only risk an
 * unread badge being reused across two unrelated sets, which the live-condition
 * badge corrects on the next pass anyway.
 *
 * @param ids affected item ids (orders, products, carriers, ...). Order does
 *   not matter; an empty/undefined set hashes to "0".
 */
export function hashItemIds(ids: string[]): string {
  if (!ids || ids.length === 0) return '0';
  const sorted = [...ids].sort();
  let hash = 5381;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
    }
    // separator so ["ab","c"] and ["a","bc"] do not collide
    hash = ((hash << 5) + hash) ^ 0x7c;
  }
  // >>> 0 forces unsigned 32-bit before base36 so the suffix is compact and
  // never carries a leading minus sign.
  return (hash >>> 0).toString(36);
}
