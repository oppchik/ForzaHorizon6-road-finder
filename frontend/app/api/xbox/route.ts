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
    let profileData: Record<string, unknown> | null = null;
    const url1 = `${OPENXBL_BASE}/profile/gamertag/${encodeURIComponent(gamertag)}`;
    console.log("[xbox] Trying:", url1);
    const res1 = await fetch(url1, {
      headers: openxblHeaders(),
      signal: AbortSignal.timeout(6000),
    });

    const body1 = await res1.json();
    console.log("[xbox] /profile/gamertag status:", res1.status, "body:", JSON.stringify(body1).slice(0, 300));

    if (res1.ok) {
      profileData =
        (body1?.profileUsers as unknown[])?.[0] as Record<string, unknown> ??
        (body1?.people as unknown[])?.[0] as Record<string, unknown> ??
        null;
    }

    if (!profileData) {
      const url2 = `${OPENXBL_BASE}/friends/search?gt=${encodeURIComponent(gamertag)}`;
      console.log("[xbox] Trying:", url2);
      const res2 = await fetch(url2, {
        headers: openxblHeaders(),
        signal: AbortSignal.timeout(6000),
      });

      const body2 = await res2.json();
      console.log("[xbox] /friends/search status:", res2.status, "body:", JSON.stringify(body2).slice(0, 300));

      if (res2.ok) {
        profileData =
          (body2?.profileUsers as unknown[])?.[0] as Record<string, unknown> ??
          (body2?.people as unknown[])?.[0] as Record<string, unknown> ??
          null;
      }
    }

    if (!profileData) {
      const url3 = `${OPENXBL_BASE}/people/search?q=${encodeURIComponent(gamertag)}`;
      console.log("[xbox] Trying:", url3);
      const res3 = await fetch(url3, {
        headers: openxblHeaders(),
        signal: AbortSignal.timeout(6000),
      });

      const body3 = await res3.json();
      console.log("[xbox] /people/search status:", res3.status, "body:", JSON.stringify(body3).slice(0, 300));

      if (res3.ok) {
        profileData =
          (body3?.people as unknown[])?.[0] as Record<string, unknown> ??
          (body3?.profileUsers as unknown[])?.[0] as Record<string, unknown> ??
          null;
      }
    }

    if (!profileData) {
      console.log("[xbox] All endpoints failed to find gamertag:", gamertag);
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
