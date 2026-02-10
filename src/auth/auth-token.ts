type JwtPayload = {
  exp?: number;
};

const base64UrlToBase64 = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4;
  const padding = padLength ? "=".repeat(4 - padLength) : "";
  return normalized + padding;
};

const decodeBase64 = (value: string) => {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(value);
  }

  type BufferLike = {
    from: (input: string, encoding: string) => { toString: (encoding: string) => string };
  };
  const buffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (buffer) {
    return buffer.from(value, "base64").toString("utf8");
  }

  throw new Error("Base64 decoding is not supported in this environment");
};

export const getJwtExpiry = (token: string | null): number | null => {
  if (!token) return null;
  const segments = token.split(".");
  if (segments.length !== 3) return null;

  try {
    const payload = decodeBase64(base64UrlToBase64(segments[1]));
    const parsed = JSON.parse(payload) as JwtPayload;
    if (typeof parsed.exp === "number") {
      return parsed.exp * 1000;
    }
  } catch (_error) {
    return null;
  }

  return null;
};

export const isTokenExpired = (
  expiresAt: number | null,
  skewMs = 60 * 1000
) => {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - skewMs;
};
