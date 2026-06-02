import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cvUrl = process.env.CV_SERVICE_URL;
  if (!cvUrl) {
    return NextResponse.json({ error: "CV_SERVICE_URL not set" }, { status: 500 });
  }

  try {
    const start = Date.now();
    const res = await fetch(`${cvUrl}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    const elapsed = Date.now() - start;
    const body = await res.json();

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      elapsed,
      service: body,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 });
  }
}
