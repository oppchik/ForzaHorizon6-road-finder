/**
 * GET /api/xbox?gamertag=<gamertag>
 *
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

// Forza Horizon 6 title ID on Xbox (placeholder — update when game ships)
const FH6_TITLE_ID = "2144864829";
// Achievement ID for road exploration (placeholder — update from game data)
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
  // CORS preflight
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  // Rate limiting
  const limited = rateLimit(req, "/api/xbox");
  if (limited) return limited;

  // Input validation
  const raw = req.nextUrl.searchParams.get("gamertag");
  const gamertag = validateGamertag(raw);
  if (!gamertag) {
    return errorResponse("Invalid gamertag. Must be 1–52 characters, letters/digits/spaces only.");
  }

  try {
    // Step 1: Resolve gamertag → XUID
    const searchRes = await fetch(
      `${OPENXBL_BASE}/friends/search?gt=${encodeURIComponent(gamertag)}`,
      {
        headers: openxblHeaders(),
        // Respect a 5-second timeout so we don't hang Vercel functions
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!searchRes.ok) {
      if (searchRes.status === 404) {
        return errorResponse("Gamertag not found. Check spelling and try again.", 404);
      }
      if (searchRes.status === 401) {
        // Don't reveal the key problem to users
        console.error("OpenXBL auth failure — check OPENXBL_API_KEY");
        return errorResponse("Service temporarily unavailable.", 503);
      }
      return errorResponse("Failed to look up Xbox profile. Please try again.", 502);
    }

    const searchData = await searchRes.json();
    const profileData = searchData?.profileUsers?.[0];

    if (!profileData) {
      return errorResponse("Gamertag not found. Check spelling and try again.", 404);
    }

    // Extract profile fields
    const settings: Record<string, string> = {};
    for (const s of profileData.settings ?? []) {
      settings[s.id] = s.value;
    }

    const profile = {
      gamertag: settings["Gamertag"] ?? gamertag,
      gamerscore: parseInt(settings["Gamerscore"] ?? "0", 10),
      accountTier: settings["AccountTier"] ?? "Silver",
      xuid: profileData.id,
      displayPicRaw: settings["GameDisplayPicRaw"] ?? "",
      tenure: settings["TenureLevel"] ?? "0",
    };

    // Step 2: Check Forza achievement (best-effort — don't fail the whole request)
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
      // Achievement lookup failing is non-fatal — log and continue
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
        // Cache for 30 seconds — profile data doesn't change that fast
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
