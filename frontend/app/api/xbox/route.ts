import { NextRequest, NextResponse } from "next/server";
import { rateLimit, validateGamertag, getCorsHeaders, errorResponse } from "@/lib/security";
import type { XboxProfileResponse } from "@/types";

const FH6_TITLE_ID = "2144864829";
const ROAD_EXPLORER_ACHIEVEMENT_ID = "1";
const OPENXBL_BASE = "https://xbl.io/api/v2";

interface CacheEntry {
  data: XboxProfileResponse;
  expiresAt: number;
}
const profileCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

function getCached(gamertag: string): XboxProfileResponse | null {
  const entry = profileCache.get(gamertag.toLowerCase());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    profileCache.delete(gamertag.toLowerCase());
    return null;
  }
  return entry.data;
}

function setCache(gamertag: string, data: XboxProfileResponse): void {
  profileCache.set(gamertag.toLowerCase(), {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of profileCache.entries()) {
    if (now > entry.expiresAt) profileCache.delete(key);
  }
}, 60_000);

function openxblHeaders() {
  const key = process.env.OPENXBL_API_KEY;
  if (!key) throw new Error("OPENXBL_API_KEY is not configured");
  return {
    "X-Authorization": key,
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  const limited = rateLimit(req, "/api/xbox");
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("gamertag");
  const gamertag = validateGamertag(raw);
  if (!gamertag) {
    return errorResponse("Invalid gamertag. Must be 1–52 characters, letters/digits/spaces only.");
  }

  try {
    const cached = getCached(gamertag);
    if (cached) {
      console.log("[xbox] Cache hit for:", gamertag);
      return NextResponse.json(cached, {
        headers: {
          ...getCorsHeaders(origin),
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "HIT",
        },
      });
    }
    let profileData: Record<string, unknown> | null = null;

    const url = `${OPENXBL_BASE}/friends/search?gt=${encodeURIComponent(gamertag)}`;
    console.log("[xbox] Fetching:", url);
    const res = await fetch(url, {
      headers: openxblHeaders(),
      signal: AbortSignal.timeout(6000),
    });

    const body = await res.json();
    console.log("[xbox] status:", res.status, "body:", JSON.stringify(body).slice(0, 300));

    if (body?.code === 429) {
      return errorResponse("Xbox API rate limit reached. Please wait a few minutes and try again.", 429);
    }

    if (!res.ok) {
      if (res.status === 401) {
        console.error("OpenXBL auth failure");
        return errorResponse("Service temporarily unavailable.", 503);
      }
      return errorResponse("Failed to look up Xbox profile. Please try again.", 502);
    }

    const env = body?.content ?? body;
    profileData =
      (env?.profileUsers as unknown[])?.[0] as Record<string, unknown> ??
      (env?.people as unknown[])?.[0] as Record<string, unknown> ??
      null;

    if (!profileData) {
      return errorResponse("Gamertag not found. Check spelling and try again.", 404);
    }

        console.log("[xbox] profileData keys:", Object.keys(profileData));

    const settings: Record<string, string> = {};
    for (const s of (profileData.settings as { id: string; value: string }[]) ?? []) {
      settings[s.id] = s.value;
    }

    const profile = {
      gamertag: settings["Gamertag"] ?? (profileData.gamertag as string) ?? gamertag,
      gamerscore: parseInt(settings["Gamerscore"] ?? String(profileData.gamerscore ?? "0"), 10),
      accountTier: settings["AccountTier"] ?? (profileData.accountTier as string) ?? "Silver",
      xuid: (profileData.id ?? profileData.xuid) as string,
      displayPicRaw: settings["GameDisplayPicRaw"] ?? (profileData.displayPicRaw as string) ?? "",
      tenure: settings["TenureLevel"] ?? String(profileData.tenure ?? "0"),
    };

    console.log("[xbox] Resolved profile:", profile.gamertag, "xuid:", profile.xuid);
    let forzaAchievement = null;
    try {
      const achRes = await fetch(
        `${OPENXBL_BASE}/achievements/player/${profile.xuid}/title/${FH6_TITLE_ID}`,
        { headers: openxblHeaders(), signal: AbortSignal.timeout(4000) }
      );
      if (achRes.ok) {
        const achData = await achRes.json();
        const achievements: unknown[] = achData?.achievements ?? [];
        const roadAch = achievements.find(
          (a: unknown) => (a as { id: string }).id === ROAD_EXPLORER_ACHIEVEMENT_ID
        ) as { id: string; name: string; lockedDescription: string; progressState: string; progression?: { current: number; target: number } } | undefined;

        if (roadAch) {
          forzaAchievement = {
            id: roadAch.id,
            name: roadAch.name,
            description: roadAch.lockedDescription,
            isUnlocked: roadAch.progressState === "Achieved",
            progressPercentage: roadAch.progression
              ? Math.round((roadAch.progression.current / roadAch.progression.target) * 100)
              : roadAch.progressState === "Achieved" ? 100 : 0,
          };
        }
      }
    } catch (achErr) {
      console.warn("[xbox] Achievement lookup failed:", achErr);
    }

    const response: XboxProfileResponse = { success: true, profile, forzaAchievement };
    setCache(gamertag, response);

    return NextResponse.json(response, {
      headers: {
        ...getCorsHeaders(origin),
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error("[xbox] Route error:", err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return errorResponse("Xbox Live API timed out. Please try again.", 504);
    }
    return errorResponse("An unexpected error occurred. Please try again.", 500);
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
}
