export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path.startsWith("/api/") ? path : `/api/${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const contentType = response.headers.get("Content-Type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const message = payload && typeof payload.error === "string" ? payload.error : "Não foi possível concluir essa ação.";
    throw new Error(message);
  }
  return payload as T;
}

export const json = (data: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(data),
});

export const patchJson = (data: unknown): RequestInit => ({
  method: "PATCH",
  body: JSON.stringify(data),
});

export function formatDate(value: number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", options ?? { day: "2-digit", month: "short" }).format(new Date(value));
}

export function formatTime(value: number | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function toDateTimeLocal(value?: number | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
