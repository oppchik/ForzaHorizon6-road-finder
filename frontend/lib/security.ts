import { NextRequest, NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  "/api/xbox": { limit: 20, windowSeconds: 60 },
  "/api/analyze": { limit: 10, windowSeconds: 60 },
};

export function rateLimit(
  req: NextRequest,
  endpoint: string,
  config?: RateLimitConfig
): NextResponse | null {
  const cfg = config ?? DEFAULT_CONFIGS[endpoint] ?? { limit: 30, windowSeconds: 60 };

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const key = `${endpoint}:${ip}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + cfg.windowSeconds * 1000 };
    rateLimitStore.set(key, entry);
    return null;
  }

  if (entry.count >= cfg.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(cfg.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      }
    );
  }

  entry.count++;
  return null;
}

setInterval(() => {
  const now = Date.now();
  Array.from(rateLimitStore.entries()).forEach(([key, entry]) => {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  });
}, 60_000);

const GAMERTAG_RE = /^[\w '\-]{1,52}$/;
const GAMERTAG_MAX_LEN = 52;

export function validateGamertag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > GAMERTAG_MAX_LEN) return null;
  if (!GAMERTAG_RE.test(trimmed)) return null;
  return trimmed;
}

export const IMAGE_CONFIG = {
  maxFileSizeBytes: 10 * 1024 * 1024, 
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  minDimension: 100,
  maxDimension: 7680, 
} as const;

export type AllowedMimeType = (typeof IMAGE_CONFIG.allowedMimeTypes)[number];

export interface ImageValidationResult {
  ok: boolean;
  error?: string;
  mimeType?: AllowedMimeType;
  sizeBytes?: number;
}

export function validateImageBuffer(buf: Uint8Array): ImageValidationResult {
  if (buf.byteLength > IMAGE_CONFIG.maxFileSizeBytes) {
    return { ok: false, error: "File too large. Maximum size is 10 MB." };
  }

  const mimeType = detectMimeType(buf);
  if (!mimeType) {
    return { ok: false, error: "Unsupported file type. Use PNG, JPEG, or WebP." };
  }

  return { ok: true, mimeType, sizeBytes: buf.byteLength };
}

function detectMimeType(buf: Uint8Array): AllowedMimeType | null {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function errorResponse(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
