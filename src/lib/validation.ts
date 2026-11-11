export function normalizeFullName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

export function isFullName(value: unknown): boolean {
  const name = normalizeFullName(value);
  const parts = name.split(" ");
  return parts.length >= 2 && parts.every((part) => /^\p{L}[\p{L}\p{M}'’.\-]*$/u.test(part));
}
