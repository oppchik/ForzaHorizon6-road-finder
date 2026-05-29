/**
 * Security utilities for Forza Road Finder
 *
 * Covers:
 * - In-memory rate limiting (IP-based, per endpoint)
 * - Input sanitization and validation
 * - File upload validation
 * - CORS helpers
 */

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Single in-memory store per serverless instance.
// For multi-instance production use, swap this for an Upstash Redis client.
const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  "/api/xbox": { limit: 20, windowSeconds: 60 },
  "/api/analyze": { limit: 10, windowSeconds: 60 },
};

/**
 * Returns null if the request is allowed, or a 429 NextResponse if rate-limited.
 */
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

// Periodically purge expired entries (runs on every cold start)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Gamertag Validation
// ---------------------------------------------------------------------------

/**
 * Xbox Gamertag rules:
 * - 1–15 characters (classic) or up to 52 with suffix (#1234)
 * - Letters, digits, spaces (classic) or Unicode letters (modern)
 * - We allow the modern format but sanitise aggressively.
 */
const GAMERTAG_RE = /^[\p{L}\p{N} '_-]{1,52}$/u;
const GAMERTAG_MAX_LEN = 52;

export function validateGamertag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > GAMERTAG_MAX_LEN) return null;
  if (!GAMERTAG_RE.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Image Upload Validation
// ---------------------------------------------------------------------------

export const IMAGE_CONFIG = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  minDimension: 100,
  maxDimension: 7680, // 8K
} as const;

export type AllowedMimeType = (typeof IMAGE_CONFIG.allowedMimeTypes)[number];

export interface ImageValidationResult {
  ok: boolean;
  error?: string;
  mimeType?: AllowedMimeType;
  sizeBytes?: number;
}

/**
 * Validates a raw Buffer/Uint8Array from a file upload.
 * Checks magic bytes (not just Content-Type) to prevent MIME spoofing.
 */
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
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: 52 49 46 46 __ __ __ __ 57 45 42 50
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Generic error response helper
// ---------------------------------------------------------------------------

export function errorResponse(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
