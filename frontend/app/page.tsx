"use client";

import { useState } from "react";
import type { XboxProfileResponse, AnalysisResult } from "@/types";

type Step = "input" | "profile" | "upload" | "result";

export default function HomePage() {
  const [step, setStep] = useState<Step>("input");
  const [gamertag, setGamertag] = useState("");
  const [profileData, setProfileData] = useState<XboxProfileResponse | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Step 1: Look up Xbox profile ──────────────────────────────────────────
  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!gamertag.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/xbox?gamertag=${encodeURIComponent(gamertag.trim())}`
      );
      const data: XboxProfileResponse = await res.json();

      if (!data.success || !data.profile) {
        setError(data.error ?? "Gamertag not found.");
        return;
      }

      setProfileData(data);
      setStep("profile");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Analyse uploaded screenshot ───────────────────────────────────
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview
    const previewUrl = URL.createObjectURL(file);
    setUploadedImage(previewUrl);
    setStep("upload");
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const data: AnalysisResult = await res.json();

      if (!data.success) {
        setError(data.error ?? "Analysis failed.");
        setStep("profile");
        return;
      }

      setAnalysisResult(data);
      setStep("result");
    } catch {
      setError("Upload failed. Please try again.");
      setStep("profile");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("input");
    setGamertag("");
    setProfileData(null);
    setAnalysisResult(null);
    setUploadedImage(null);
    setError(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 gap-6">
      <h1 className="text-3xl font-bold text-center">
        🏎️ Forza Road Finder
      </h1>
      <p className="text-sm text-gray-400 text-center max-w-sm">
        Find unexplored road segments on your Forza Horizon map in seconds.
      </p>

      {error && (
        <div className="w-full max-w-sm bg-red-900/40 border border-red-500 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* ── Step: Enter Gamertag ── */}
      {step === "input" && (
        <form onSubmit={handleLookup} className="w-full max-w-sm flex flex-col gap-3">
          <input
            type="text"
            placeholder="Enter Xbox Gamertag"
            value={gamertag}
            onChange={(e) => setGamertag(e.target.value)}
            maxLength={52}
            required
            className="w-full rounded-lg px-4 py-3 bg-[var(--surface)] border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--neon-pink)]"
          />
          <button
            type="submit"
            disabled={loading || !gamertag.trim()}
            className="w-full rounded-lg px-4 py-3 bg-[var(--neon-pink)] text-black font-bold disabled:opacity-50"
          >
            {loading ? "Looking up…" : "Find Roads →"}
          </button>
        </form>
      )}

      {/* ── Step: Profile confirmed, request screenshot ── */}
      {(step === "profile" || step === "upload") && profileData?.profile && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          {/* Profile card */}
          <div className="flex items-center gap-3 bg-[var(--surface)] rounded-xl p-4 border border-gray-800">
            {profileData.profile.displayPicRaw && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profileData.profile.displayPicRaw}
                alt="Avatar"
                width={48}
                height={48}
                className="rounded-full"
              />
            )}
            <div>
              <p className="font-bold">{profileData.profile.gamertag}</p>
              <p className="text-xs text-gray-400">
                Gamerscore: {profileData.profile.gamerscore.toLocaleString()}
              </p>
              {profileData.forzaAchievement && (
                <p className="text-xs text-[var(--neon-green)]">
                  Road Explorer: {profileData.forzaAchievement.progressPercentage}%
                  {profileData.forzaAchievement.isUnlocked ? " ✓" : ""}
                </p>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-[var(--surface)] rounded-xl p-4 border border-gray-800 text-sm text-gray-300 space-y-2">
            <p className="font-semibold text-white">📸 How to get your map screenshot:</p>
            <ol className="list-decimal list-inside space-y-1 text-gray-400">
              <li>Open Forza Horizon 6 on your Xbox</li>
              <li>Open the full map (zoom in to the area you want)</li>
              <li>Press <strong className="text-white">Xbox button</strong> → <strong className="text-white">Share</strong> → Screenshot</li>
              <li>The screenshot auto-syncs to the Xbox app on your phone</li>
              <li>Save it to your camera roll, then upload below</li>
            </ol>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-4">Analysing image…</div>
          ) : (
            <label className="w-full rounded-lg px-4 py-3 bg-[var(--neon-green)] text-black font-bold text-center cursor-pointer">
              📂 Upload Map Screenshot
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleImageUpload}
              />
            </label>
          )}

          <button onClick={reset} className="text-sm text-gray-500 underline">
            ← Use different Gamertag
          </button>
        </div>
      )}

      {/* ── Step: Results ── */}
      {step === "result" && analysisResult && uploadedImage && (
        <ResultView
          result={analysisResult}
          imageUrl={uploadedImage}
          onReset={reset}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// ResultView — overlays bounding boxes on the uploaded image
// ---------------------------------------------------------------------------

function ResultView({
  result,
  imageUrl,
  onReset,
}: {
  result: AnalysisResult;
  imageUrl: string;
  onReset: () => void;
}) {
  return (
    <div className="w-full max-w-lg flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">
          {result.totalUnexplored === 0
            ? "✅ All roads explored!"
            : `🗺️ ${result.totalUnexplored} unexplored segment${result.totalUnexplored !== 1 ? "s" : ""} found`}
        </h2>
        <span className="text-xs text-gray-500">{result.processingTimeMs}ms</span>
      </div>

      {/* Annotated image */}
      <div className="relative w-full rounded-xl overflow-hidden border border-gray-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Map screenshot" className="w-full block" />

        {/* Overlay bounding boxes */}
        {result.unexploredSegments.map((seg, i) => (
          <div
            key={i}
            className="absolute border-2 rounded-sm pointer-events-none"
            style={{
              left: `${seg.bbox.x * 100}%`,
              top: `${seg.bbox.y * 100}%`,
              width: `${seg.bbox.width * 100}%`,
              height: `${seg.bbox.height * 100}%`,
              borderColor: "var(--neon-pink)",
              boxShadow: "0 0 6px var(--neon-pink)",
            }}
          />
        ))}

        {/* Centroid dots for tiny segments */}
        {result.unexploredSegments.map((seg, i) => (
          <div
            key={`dot-${i}`}
            className="absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${seg.centerX * 100}%`,
              top: `${seg.centerY * 100}%`,
              backgroundColor: "var(--neon-green)",
              boxShadow: "0 0 8px var(--neon-green)",
            }}
          />
        ))}
      </div>

      <p className="text-xs text-gray-500 text-center">
        Pink boxes = unexplored road segments · Green dots = exact centres
      </p>

      <button
        onClick={onReset}
        className="w-full rounded-lg px-4 py-3 bg-[var(--surface)] border border-gray-700 text-white font-semibold"
      >
        ← Start Over
      </button>
    </div>
  );
}
