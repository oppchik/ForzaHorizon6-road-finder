"use client";

import { useState } from "react";
import type { XboxProfileResponse, AnalysisResult } from "@/types";
import type { ScreenshotItem } from "@/app/api/screenshots/route";

type Step = "input" | "profile" | "upload" | "result";

export default function HomePage() {
  const [step, setStep] = useState<Step>("input");
  const [gamertag, setGamertag] = useState("");
  const [profileData, setProfileData] = useState<XboxProfileResponse | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);

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

      if (data.profile?.xuid) {
        setScreenshotsLoading(true);
        fetch(`/api/screenshots?xuid=${data.profile.xuid}`)
          .then((r) => r.json())
          .then((s) => {
            if (s.success && s.screenshots?.length > 0) {
              setScreenshots(s.screenshots);
            }
          })
          .catch(() => {})
          .finally(() => setScreenshotsLoading(false));
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleScreenshotSelect(fullUrl: string) {
    setLoading(true);
    setError(null);
    setStep("upload");

    try {
      const proxyRes = await fetch(
        `/api/proxy-image?url=${encodeURIComponent(fullUrl)}`
      );

      if (!proxyRes.ok) {
        throw new Error("Failed to fetch screenshot");
      }

      const blob = await proxyRes.blob();
      const previewUrl = URL.createObjectURL(blob);
      setUploadedImage(previewUrl);
      const formData = new FormData();
      formData.append("image", blob, "xbox-screenshot.jpg");

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
      setError("Failed to load screenshot. Please upload manually.");
      setStep("profile");
    } finally {
      setLoading(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

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

      {(step === "profile" || step === "upload") && profileData?.profile && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <div className="flex items-center gap-3 bg-[var(--surface)] rounded-xl p-4 border border-gray-800">
            {profileData.profile.displayPicRaw && (
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

          {(screenshotsLoading || screenshots.length > 0) && (
            <div className="bg-[var(--surface)] rounded-xl p-4 border border-gray-800 space-y-3">
              <p className="text-sm font-semibold text-white">
                📷 Your recent Xbox screenshots
              </p>

              {screenshotsLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-xs">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  Loading your screenshots…
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {screenshots.map((shot) => (
                    <button
                      key={shot.id}
                      onClick={() => handleScreenshotSelect(shot.fullUrl)}
                      className="relative group rounded-lg overflow-hidden border-2 border-transparent hover:border-[var(--neon-pink)] transition-all"
                      title={shot.gameName}
                    >
                      <img
                        src={shot.thumbnailUrl}
                        alt={shot.gameName}
                        className="w-full aspect-video object-cover"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs font-bold">Use this</span>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
                        <p className="text-[10px] text-gray-300 truncate">{shot.gameName}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!screenshotsLoading && screenshots.length > 0 && (
                <p className="text-xs text-gray-600 text-center">
                  Tap a screenshot to analyse it instantly
                </p>
              )}
            </div>
          )}

          <div className="bg-[var(--surface)] rounded-xl p-4 border border-gray-800 text-sm space-y-3">
            <p className="font-semibold text-white">
              <span className="text-[var(--neon-pink)] mr-2">①</span>
              Take a map screenshot on your Xbox
            </p>
            <p className="text-gray-400 leading-relaxed">
              Open Forza Horizon 6 → open the map → press{" "}
              <strong className="text-white">Xbox button</strong> →{" "}
              <strong className="text-white">Share</strong> → Screenshot
            </p>
          </div>

          <div className="bg-[var(--surface)] rounded-xl p-4 border border-gray-800 text-sm space-y-3">
            <p className="font-semibold text-white">
              <span className="text-[var(--neon-pink)] mr-2">②</span>
              Open Xbox app and save the screenshot
            </p>
            <p className="text-gray-400 text-xs leading-relaxed">
              Screenshots auto-sync to the Xbox app. Tap below to go straight
              to Captures — find your screenshot and save it to your camera roll.
            </p>
            <a
              href="xbox:///?page=captures"
              className="flex items-center justify-center gap-2 w-full rounded-lg px-4 py-3 bg-[#107C10] text-white font-bold"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 14.5c-2.49-1.96-4-4.14-4-6 0-.96.5-1.85 1.28-2.4C8.95 9.66 10.9 11.3 12 13c1.1-1.7 3.05-3.34 4.22-4.9.78.55 1.28 1.44 1.28 2.4 0 1.86-1.51 4.04-4 6L12 16.92l-1.5-.42z"/>
              </svg>
              Open Xbox App → Captures
            </a>
            <p className="text-xs text-gray-600 text-center">
              iOS &amp; Android — requires Xbox app installed
            </p>
          </div>

          <div className="bg-[var(--surface)] rounded-xl p-4 border border-gray-800 text-sm space-y-3">
            <p className="font-semibold text-white">
              <span className="text-[var(--neon-pink)] mr-2">③</span>
              Upload the screenshot here
            </p>
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-gray-400 py-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                Analysing image…
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 w-full rounded-lg px-4 py-3 bg-[var(--neon-green)] text-black font-bold cursor-pointer">
                📂 Choose Screenshot
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </label>
            )}
          </div>

          <button onClick={reset} className="text-sm text-gray-500 underline">
            ← Use different Gamertag
          </button>
        </div>
      )}

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

     
      <div className="relative w-full rounded-xl overflow-hidden border border-gray-800">
        <img src={imageUrl} alt="Map screenshot" className="w-full block" />
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
