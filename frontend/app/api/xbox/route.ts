/*
 * Looks up an Xbox Live profile by gamertag using the OpenXBL API.
 * Also checks whether the player has the Forza "Road Explorer" achievement.
 *
 * Security:
 *  - Rate limited: 20 req/min per IP
 *  - Input validated (gamertag regex)
 *  - API key never exposed to client
 *  - All external errors normalised (no upstream stack traces leaked)
 */

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, validateGamertag, getCorsHeaders, errorResponse } from "@/lib/security";
import type { XboxProfileResponse } from "@/types";

const FH6_TITLE_ID = "2144864829";
const ROAD_EXPLORER_ACHIEVEMENT_ID = "1";

const OPENXBL_BASE = "https://xbl.io/api/v2";

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
    const searchRes = await fetch(
      `${OPENXBL_BASE}/profile/gamertag/${encodeURIComponent(gamertag)}`,
      {
        headers: openxblHeaders(),
        signal: AbortSignal.timeout(5000),
      }
    );

    let searchData: Record<string, unknown> | null = null;

    if (searchRes.ok) {
      searchData = await searchRes.json();
    } else {
      const fallbackRes = await fetch(
        `${OPENXBL_BASE}/friends/search?gt=${encodeURIComponent(gamertag)}`,
        {
          headers: openxblHeaders(),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!fallbackRes.ok) {
        if (fallbackRes.status === 404 || searchRes.status === 404) {
          return errorResponse("Gamertag not found. Check spelling and try again.", 404);
        }
        if (fallbackRes.status === 401 || searchRes.status === 401) {
          console.error("OpenXBL auth failure — check OPENXBL_API_KEY");
          return errorResponse("Service temporarily unavailable.", 503);
        }
        return errorResponse("Failed to look up Xbox profile. Please try again.", 502);
      }

      searchData = await fallbackRes.json();
    }

    const profileData = (searchData?.profileUsers as unknown[])?.[0] as Record<string, unknown> | undefined;

    if (!profileData) {
      return errorResponse("Gamertag not found. Check spelling and try again.", 404);
    }

    const settings: Record<string, string> = {};
    for (const s of (profileData.settings as { id: string; value: string }[]) ?? []) {
      settings[s.id] = s.value;
    }

    const profile = {
      gamertag: settings["Gamertag"] ?? gamertag,
      gamerscore: parseInt(settings["Gamerscore"] ?? "0", 10),
      accountTier: settings["AccountTier"] ?? "Silver",
      xuid: profileData.id as string,
      displayPicRaw: settings["GameDisplayPicRaw"] ?? "",
      tenure: settings["TenureLevel"] ?? "0",
    };

    let forzaAchievement = null;
    try {
      const achRes = await fetch(
        `${OPENXBL_BASE}/achievements/player/${profile.xuid}/title/${FH6_TITLE_ID}`,
        {
          headers: openxblHeaders(),
          signal: AbortSignal.timeout(4000),
        }
      );

      if (achRes.ok) {
        const achData = await achRes.json();
        const achievements: unknown[] = achData?.achievements ?? [];
        const roadAch = achievements.find(
          (a: unknown) => (a as { id: string }).id === ROAD_EXPLORER_ACHIEVEMENT_ID
        ) as {
          id: string;
          name: string;
          lockedDescription: string;
          progressState: string;
          progression?: { current: number; target: number };
        } | undefined;

        if (roadAch) {
          forzaAchievement = {
            id: roadAch.id,
            name: roadAch.name,
            description: roadAch.lockedDescription,
            isUnlocked: roadAch.progressState === "Achieved",
            progressPercentage:
              roadAch.progression
                ? Math.round((roadAch.progression.current / roadAch.progression.target) * 100)
                : roadAch.progressState === "Achieved"
                ? 100
                : 0,
          };
        }
      }
    } catch (achErr) {
      console.warn("Achievement lookup failed:", achErr);
    }

    const response: XboxProfileResponse = {
      success: true,
      profile,
      forzaAchievement,
    };

    return NextResponse.json(response, {
      headers: {
        ...getCorsHeaders(origin),
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error("Xbox API route error:", err);

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
