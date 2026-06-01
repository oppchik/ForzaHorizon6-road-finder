export const maxDuration = 60;

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
  const limited = rateLimit(req, "/api/analyze", { limit: 10, windowSeconds: 60 });
  if (limited) return limited;
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
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const validation = validateImageBuffer(buffer);
  if (!validation.ok) {
    return errorResponse(validation.error ?? "Invalid image.", 422);
  }

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
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: cvFormData,
      signal: AbortSignal.timeout(9_000), 
    });
  } catch (err) {
    console.error("CV service unreachable:", err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return errorResponse("Analysis timed out. Try with a smaller/cropped screenshot.", 504);
    }
    return errorResponse("Analysis service unavailable. Please try again later.", 503);
  }

  if (!cvRes.ok) {
    let cvError = "Analysis failed on the server.";
    try {
      const cvBody = await cvRes.json();
      if (typeof cvBody?.detail === "string" && cvBody.detail.length < 200) {
        cvError = cvBody.detail;
      }
    } catch {
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
