import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getCorsHeaders, errorResponse } from "@/lib/security";

const OPENXBL_BASE = "https://xbl.io/api/v2";
const MAX_SCREENSHOTS = 3;

function openxblHeaders() {
  const key = process.env.OPENXBL_API_KEY;
  if (!key) throw new Error("OPENXBL_API_KEY is not configured");
  return {
    "X-Authorization": key,
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
  };
}

function validateXuid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^\d{15,16}$/.test(raw.trim())) return null;
  return raw.trim();
}

export interface ScreenshotItem {
  id: string;
  thumbnailUrl: string;
  fullUrl: string;
  takenAt: string;
  gameName: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");

  const limited = rateLimit(req, "/api/screenshots", { limit: 20, windowSeconds: 60 });
  if (limited) return limited;

  const xuid = validateXuid(req.nextUrl.searchParams.get("xuid"));
  if (!xuid) {
    return errorResponse("Invalid XUID.", 400);
  }

  try {
    let screenshots: ScreenshotItem[] = [];
    const res1 = await fetch(
      `${OPENXBL_BASE}/dvr/screenshots/${xuid}?maxItems=10`,
      {
        headers: openxblHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );

    if (res1.ok) {
      const data = await res1.json();
      const items = (data?.screenshots ?? data?.content?.screenshots ?? []) as RawScreenshot[];
      screenshots = parseScreenshots(items);
    }
    if (screenshots.length === 0) {
      const res2 = await fetch(
        `${OPENXBL_BASE}/activity/history/${xuid}?contentTypes=Screenshot`,
        {
          headers: openxblHeaders(),
          signal: AbortSignal.timeout(6000),
        }
      );

      if (res2.ok) {
        const data = await res2.json();
        const items = extractScreenshotsFromActivity(data);
        screenshots = parseScreenshots(items);
      }
    }

    const result = screenshots.slice(0, MAX_SCREENSHOTS);

    return NextResponse.json(
      {
        success: true,
        screenshots: result,
        total: result.length,
        empty: result.length === 0,
        emptyReason:
          result.length === 0
            ? "No public screenshots found. Make sure you've shared screenshots on Xbox Live."
            : null,
      },
      {
        headers: {
          ...getCorsHeaders(origin),
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("[screenshots] Error:", err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return errorResponse("Xbox Live API timed out.", 504);
    }
    return errorResponse("Failed to fetch screenshots.", 500);
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
}

interface RawScreenshot {
  screenshotId?: string;
  contentId?: string;
  thumbnails?: { uri: string; thumbnailType: string }[];
  screenshotUris?: { uri: string; uriType: string; expiration?: string }[];
  contentLocators?: { uri: string; locatorType: string; expiration?: string }[];
  dateTaken?: string;
  recordDate?: string;
  titleName?: string;
  gameName?: string;
}

function parseScreenshots(items: RawScreenshot[]): ScreenshotItem[] {
  const result: ScreenshotItem[] = [];

  for (const item of items) {
    try {
      const id = item.screenshotId ?? item.contentId ?? "";
      if (!id) continue;
      const thumb =
        item.thumbnails?.find((t) => t.thumbnailType === "Small")?.uri ??
        item.thumbnails?.[0]?.uri ??
        "";

      const full =
        item.screenshotUris?.find((u) => u.uriType === "Download")?.uri ??
        item.contentLocators?.find((l) => l.locatorType === "Download")?.uri ??
        item.contentLocators?.find((l) => l.locatorType === "Thumbnail_Large")?.uri ??
        thumb;

      if (!thumb && !full) continue;

      result.push({
        id,
        thumbnailUrl: thumb || full,
        fullUrl: full || thumb,
        takenAt: item.dateTaken ?? item.recordDate ?? "",
        gameName: item.titleName ?? item.gameName ?? "Unknown Game",
      });
    } catch {
      continue;
    }
  }

  return result;
}

function extractScreenshotsFromActivity(data: unknown): RawScreenshot[] {
  const feed =
    (data as Record<string, unknown>)?.activityItems ??
    (data as Record<string, unknown>)?.content ??
    [];

  if (!Array.isArray(feed)) return [];

  return feed
    .filter(
      (item: unknown) =>
        (item as Record<string, unknown>)?.contentType === "Screenshot" ||
        (item as Record<string, unknown>)?.type === "Screenshot"
    )
    .map((item: unknown) => (item as Record<string, unknown>)?.screenshotItem as RawScreenshot)
    .filter(Boolean);
}
