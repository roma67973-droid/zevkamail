/**
 * Generate a 20-character ID for an email row.
 *
 * 20 hex chars from a random UUID: short in URLs, still unguessable.
 */
export function newEmailId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}
