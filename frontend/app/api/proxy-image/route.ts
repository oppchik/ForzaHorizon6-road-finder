import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getCorsHeaders, errorResponse } from "@/lib/security";

const ALLOWED_HOSTS = [
  "gameclipscontent-d2009.xboxlive.com",
  "screenshotscontent.xboxlive.com",
  "images-eds-ssl.xboxlive.com",
  "xboxlive.com",
  "xboxunits.com",
  "gameclips-interest.xboxlive.com",
  "screenshotscontent-d2009.xboxlive.com",
  "xblobstorage.blob.core.windows.net",
  "ugc.xboxlive.com",
  "compass-ssl.xbox.com",
];

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function isAllowedUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith("." + host)
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");

  const limited = rateLimit(req, "/api/proxy-image", { limit: 30, windowSeconds: 60 });
  if (limited) return limited;

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) return errorResponse("Missing url parameter.", 400);

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    return errorResponse("Invalid URL encoding.", 400);
  }

  if (!isAllowedUrl(decodedUrl)) {
    console.log("[proxy-image] BLOCKED domain:", new URL(decodedUrl).hostname, "full url:", decodedUrl.slice(0, 100));
    return errorResponse("URL not allowed. Only Xbox CDN domains are supported.", 403);
  }
  console.log("[proxy-image] Fetching:", decodedUrl.slice(0, 100));

  try {
    const upstream = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "ForzaRoadFinder/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      return errorResponse(`CDN returned ${upstream.status}`, 502);
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return errorResponse("Remote resource is not an image.", 422);
    }
    const reader = upstream.body?.getReader();
    if (!reader) return errorResponse("Empty response from CDN.", 502);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BYTES) {
        reader.cancel();
        return errorResponse("Screenshot too large (max 15 MB).", 413);
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": contentType,
        "Content-Length": String(totalBytes),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[proxy-image] Error:", err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return errorResponse("CDN request timed out.", 504);
    }
    return errorResponse("Failed to fetch image.", 500);
  }
}
