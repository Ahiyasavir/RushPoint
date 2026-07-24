// Total: any unparseable timestamp yields the fallback, never "Invalid Date".
export function formatTxDate(createdAt: string | number | null | undefined): string {
  if (createdAt == null) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}
