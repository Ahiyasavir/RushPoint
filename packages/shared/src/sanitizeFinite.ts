// Deep-sanitize a value so it can never carry a non-finite number
// (change: fix-nonfinite-callable-payload). firebase-functions throws
// "Data cannot be encoded in JSON: Infinity" when a callable returns Infinity /
// -Infinity / NaN — a single non-finite leaf crashes the ENTIRE response. This
// helper walks a callable result and replaces every non-finite number with null,
// leaving finite numbers, strings, booleans, null/undefined, and non-plain
// objects (Date, etc.) untouched. Returns fresh arrays/objects (no mutation of
// shared references). Applied as a blanket backstop in loggedCallable.

export function sanitizeFinite<T>(value: T): T {
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : null) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeFinite(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    // Only descend into PLAIN objects/records; leave class instances (Date,
    // Timestamp, etc.) intact so we don't shred them into a bag of nulls.
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = sanitizeFinite(v);
      }
      return out as unknown as T;
    }
  }
  return value;
}
