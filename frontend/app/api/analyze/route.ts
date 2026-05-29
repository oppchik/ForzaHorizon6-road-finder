/**
 * POST /api/analyze
 *
 * Accepts a multipart/form-data upload with a map screenshot,
 * validates it thoroughly, then forwards to the Python CV microservice.
 *
 * Security:
 *  - Rate limited: 10 req/min per IP (heavier — CV is expensive)
 *  - Magic-byte file type validation (not just Content-Type)
 *  - Hard file size cap (10 MB)
 *  - No file is written to disk here — processed in memory
 *  - CV service URL is env-only, never exposed to client
 *  - Upstream CV errors are normalised before returning to client
 *  - Request to CV service uses a shared secret (INTERNAL_SECRET)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  rateLimit,
  validateImageBuffer,
  getCorsHeaders,
  errorResponse,
} from "@/lib/security";
import type { AnalysisResult } from "@/types";

const CV_SERVICE_URL = process.env.CV_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");

  // Rate limiting (stricter — CV processing is expensive)
  const limited = rateLimit(req, "/api/analyze", { limit: 10, windowSeconds: 60 });
  if (limited) return limited;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Invalid request: expected multipart/form-data.");
  }

  const file = formData.get("image");
  if (!file || !(file instanceof Blob)) {
    return errorResponse("Missing 'image' field in form data.");
  }

  // Read into buffer (memory only, no disk write)
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Validate: magic bytes, size
  const validation = validateImageBuffer(buffer);
  if (!validation.ok) {
    return errorResponse(validation.error ?? "Invalid image.", 422);
  }

  // Forward to Python CV service
  const cvFormData = new FormData();
  cvFormData.append(
    "image",
    new Blob([buffer], { type: validation.mimeType }),
    "map.png"
  );

  let cvRes: Response;
  try {
    cvRes = await fetch(`${CV_SERVICE_URL}/analyze`, {
      method: "POST",
      headers: {
        // Shared secret so CV service rejects requests not coming from us
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: cvFormData,
      signal: AbortSignal.timeout(30_000), // CV can be slow for large images
    });
  } catch (err) {
    console.error("CV service unreachable:", err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return errorResponse("Analysis timed out. Try with a smaller/cropped screenshot.", 504);
    }
    return errorResponse("Analysis service unavailable. Please try again later.", 503);
  }

  if (!cvRes.ok) {
    // Parse CV service error if possible, but never expose raw upstream errors
    let cvError = "Analysis failed on the server.";
    try {
      const cvBody = await cvRes.json();
      // Only use CV error if it's a safe user-facing message
      if (typeof cvBody?.detail === "string" && cvBody.detail.length < 200) {
        cvError = cvBody.detail;
      }
    } catch {
      // ignore parse error
    }
    console.error(`CV service returned ${cvRes.status}`);
    return errorResponse(cvError, 502);
  }

  let result: AnalysisResult;
  try {
    result = await cvRes.json();
  } catch {
    return errorResponse("Received malformed response from analysis service.", 502);
  }

  return NextResponse.json(result, {
    headers: {
      ...getCorsHeaders(origin),
      // Never cache analysis results
      "Cache-Control": "no-store",
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
}
