"use client";

import { useState, useEffect, useRef } from "react";
import type { XboxProfileResponse, AnalysisResult } from "@/types";
import type { ScreenshotItem } from "@/app/api/screenshots/route";

type Step = "input" | "profile" | "upload" | "result";

const GITHUB_URL = "https://github.com/oppchik/ForzaHorizon6-road-finder";

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
  const [showHelp, setShowHelp] = useState(false);
  const [helpLang, setHelpLang] = useState<"en" | "ru">("en");

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!gamertag.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/xbox?gamertag=${encodeURIComponent(gamertag.trim())}`);
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
          .then((s) => { if (s.success && s.screenshots?.length > 0) setScreenshots(s.screenshots); })
          .catch(() => {})
          .finally(() => setScreenshotsLoading(false));
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function resizeImage(blob: Blob, maxWidth = 960): Promise<Blob> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => resolve(b ?? blob), "image/jpeg", 0.85);
      };
      img.src = url;
    });
  }

  async function handleScreenshotSelect(fullUrl: string) {
    setLoading(true);
    setError(null);
    setStep("upload");
    try {
      const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(fullUrl)}`);
      if (!proxyRes.ok) throw new Error(`Proxy ${proxyRes.status}`);
      const blob = await proxyRes.blob();
      if (blob.size === 0) throw new Error("Empty blob");
      const previewUrl = URL.createObjectURL(blob);
      setUploadedImage(previewUrl);
      const resized = await resizeImage(blob, 960);
      const formData = new FormData();
      formData.append("image", resized, "xbox-screenshot.jpg");
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Analyze ${res.status}`);
      const data: AnalysisResult = await res.json();
      if (!data.success) { setError(data.error ?? "Analysis failed."); setStep("profile"); return; }
      setAnalysisResult(data);
      setStep("result");
    } catch (err) {
      setError(`Failed to load screenshot: ${err instanceof Error ? err.message : String(err)}`);
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
      const resizedFile = await resizeImage(file, 960);
      const formData = new FormData();
      formData.append("image", resizedFile, "map.jpg");
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data: AnalysisResult = await res.json();
      if (!data.success) { setError(data.error ?? "Analysis failed."); setStep("profile"); return; }
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
    setStep("input"); setGamertag(""); setProfileData(null);
    setAnalysisResult(null); setUploadedImage(null); setError(null); setScreenshots([]);
  }

  function goBack() {
    setStep("profile"); setAnalysisResult(null); setUploadedImage(null); setError(null);
  }

  return (
    <div className="bg-gradient-main min-h-screen relative overflow-hidden">
      <div className="scan-line fixed inset-0 z-0 pointer-events-none" />

      <TopBar onGithub={() => window.open(GITHUB_URL, "_blank")} onHelp={() => setShowHelp(true)} />

      {showHelp && <HelpModal lang={helpLang} onLangChange={setHelpLang} onClose={() => setShowHelp(false)} />}

      <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-8">

        {step === "input" && (
          <div className="w-full max-w-md animate-fadeUp">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="text-3xl">🏎️</span>
                <h1 className="font-display text-2xl font-900 text-white tracking-wider">
                  FORZA ROAD FINDER
                </h1>
              </div>
              <p className="text-sm text-green-400/60 font-light tracking-widest uppercase">
                Forza Horizon 6
              </p>
            </div>

            {error && (
              <div className="mb-4 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleLookup} className="flex flex-col gap-3">
              <div className="glow-border rounded-xl overflow-hidden">
                <input
                  type="text"
                  placeholder="Enter Xbox Gamertag"
                  value={gamertag}
                  onChange={(e) => setGamertag(e.target.value)}
                  maxLength={52}
                  required
                  className="w-full bg-transparent px-5 py-4 text-white placeholder-green-900 outline-none font-medium text-lg"
                />
              </div>
              <button type="submit" disabled={loading || !gamertag.trim()} className="btn-primary rounded-xl py-4 text-base tracking-wide font-display">
                {loading ? <LoadingDots /> : "FIND ROADS →"}
              </button>
            </form>
          </div>
        )}

        {(step === "profile" || step === "upload") && profileData?.profile && (
          <div className="w-full max-w-lg flex flex-col items-center gap-8 animate-fadeUp">

            <div className="flex flex-col items-center gap-3 animate-fadeUp-1">
              <div className="avatar-ring">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-green-900/50">
                  {profileData.profile.displayPicRaw ? (
                    <img src={profileData.profile.displayPicRaw} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">👤</div>
                  )}
                </div>
              </div>
              <div className="text-center">
                <p className="font-display text-white text-lg tracking-wide">{profileData.profile.gamertag}</p>
                <p className="text-green-400/70 text-sm mt-0.5">
                  {profileData.profile.gamerscore.toLocaleString()} <span className="text-green-900">GS</span>
                </p>
              </div>
            </div>

            {(screenshotsLoading || screenshots.length > 0) && (
              <div className="w-full animate-fadeUp-2">
                {screenshotsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {screenshots.map((shot) => (
                      <button
                        key={shot.id}
                        onClick={() => handleScreenshotSelect(shot.fullUrl)}
                        disabled={loading}
                        className="screenshot-card rounded-xl overflow-hidden aspect-video"
                      >
                        <img
                          src={`/api/proxy-image?url=${encodeURIComponent(shot.thumbnailUrl)}`}
                          alt={shot.gameName}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                        />
                        {loading && (
                          <div className="absolute inset-0 bg-green-dark/60 flex items-center justify-center z-10">
                            <div className="w-5 h-5 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="w-full px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="w-full animate-fadeUp-3">
              {loading ? (
                <div className="text-center py-4 text-green-400/60 text-sm">
                  <LoadingDots /> Analysing
                </div>
              ) : (
                <label className="btn-primary w-full rounded-xl py-3.5 text-sm tracking-widest font-display flex items-center justify-center gap-2 cursor-pointer">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  UPLOAD MAP SCREENSHOT
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageUpload} />
                </label>
              )}
            </div>

            <button onClick={reset} className="text-xs text-green-900 hover:text-green-600 transition-colors tracking-widest uppercase">
              ← Change Gamertag
            </button>
          </div>
        )}

        {step === "result" && analysisResult && uploadedImage && (
          <ResultView
            result={analysisResult}
            imageUrl={uploadedImage}
            onReset={reset}
            onGoBack={goBack}
          />
        )}
      </main>
    </div>
  );
}

function TopBar({ onGithub, onHelp }: { onGithub: () => void; onHelp: () => void }) {
  return (
    <header className="relative z-20 flex items-center justify-between px-5 h-14 border-b border-green-500/10">
      <div className="flex items-center gap-2">
        <span className="text-lg">🏎️</span>
        <span className="font-display text-xs text-green-400/50 tracking-widest hidden sm:block">FORZA ROAD FINDER</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onHelp}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-green-500/50 hover:text-green-400 hover:bg-green-500/10 transition-all"
          title="Help"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </button>
        <button
          onClick={onGithub}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-green-500/50 hover:text-green-400 hover:bg-green-500/10 transition-all"
          title="GitHub"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
        </button>
      </div>
    </header>
  );
}

function HelpModal({ lang, onLangChange, onClose }: { lang: "en" | "ru"; onLangChange: (l: "en" | "ru") => void; onClose: () => void }) {
  const content = {
    en: {
      title: "How to use",
      steps: [
        "Enter your Xbox Gamertag and press Find Roads",
        "Your recent Forza Horizon 6 screenshots will appear",
        "Tap a map screenshot to analyse it instantly",
        "Or upload a screenshot manually using the button below",
        "Unexplored road segments will be highlighted on the map",
        "Use the map on your phone while playing on Xbox to find missing roads",
      ],
      tip: "For best results, take a screenshot of the zoomed-in map in-game: Xbox button → Share → Screenshot",
    },
    ru: {
      title: "Как пользоваться",
      steps: [
        "Введите Xbox Gamertag и нажмите Find Roads",
        "Появятся ваши последние скриншоты из Forza Horizon 6",
        "Нажмите на скриншот карты — анализ запустится сразу",
        "Или загрузите скриншот вручную кнопкой ниже",
        "Неисследованные участки дорог будут подсвечены на карте",
        "Смотрите в телефон пока играете на Xbox — находите пропущенные дороги",
      ],
      tip: "Для лучшего результата сделайте скриншот приближённой карты в игре: кнопка Xbox → Поделиться → Скриншот",
    },
  };
  const c = content[lang];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md card rounded-2xl p-6 glow-border animate-fadeUp"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-green-400 tracking-wider text-sm">{c.title}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => onLangChange("en")} className={`text-xs px-2 py-1 rounded-md transition-all ${lang === "en" ? "bg-green-500/20 text-green-400" : "text-green-900 hover:text-green-600"}`}>EN</button>
            <button onClick={() => onLangChange("ru")} className={`text-xs px-2 py-1 rounded-md transition-all ${lang === "ru" ? "bg-green-500/20 text-green-400" : "text-green-900 hover:text-green-600"}`}>RU</button>
            <button onClick={onClose} className="ml-2 text-green-900 hover:text-green-400 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <ol className="space-y-3 mb-5">
          {c.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-green-100/70">
              <span className="font-display text-green-500 shrink-0 text-xs mt-0.5">{String(i + 1).padStart(2, "0")}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="bg-green-500/5 border border-green-500/15 rounded-xl p-3 text-xs text-green-400/60">{c.tip}</div>
      </div>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="loading-dots inline-flex gap-0.5">
      <span className="inline-block w-1.5 h-1.5 bg-current rounded-full" />
      <span className="inline-block w-1.5 h-1.5 bg-current rounded-full" />
      <span className="inline-block w-1.5 h-1.5 bg-current rounded-full" />
    </span>
  );
}

function ResultView({
  result, imageUrl, onReset, onGoBack,
}: {
  result: AnalysisResult; imageUrl: string; onReset: () => void; onGoBack: () => void;
}) {
  return (
    <div className="w-full max-w-2xl flex flex-col gap-4 animate-fadeUp">
      <div className="flex items-center justify-between">
        <div>
          {!result.success && result.error ? (
            <p className="font-display text-yellow-400 text-sm tracking-wide">⚠ NOT A MAP</p>
          ) : (
            <p className="font-display text-green-400 text-sm tracking-wide">
              {result.totalUnexplored === 0 ? "✓ ALL ROADS EXPLORED" : `${result.totalUnexplored} SEGMENTS FOUND`}
            </p>
          )}
        </div>
        <span className="text-xs text-green-900 font-mono">{result.processingTimeMs}ms</span>
      </div>

      {!result.success && result.error && (
        <div className="px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 text-yellow-200/80 text-sm">
          {result.error}
        </div>
      )}

      <div className="card rounded-2xl overflow-hidden glow-border">
        <MapCanvas imageUrl={imageUrl} segments={result.unexploredSegments} />
      </div>

      <p className="text-center text-xs text-green-900">
        Pink boxes = unexplored road segments · Green dots = exact centres
      </p>

      <div className="flex gap-3">
        <button
          onClick={onGoBack}
          className="flex-1 py-3 rounded-xl border border-green-500/20 text-green-400/70 text-sm hover:border-green-500/40 hover:text-green-400 transition-all font-display tracking-wide"
        >
          ← TRY ANOTHER
        </button>
        <button
          onClick={onReset}
          className="py-3 px-4 rounded-xl border border-green-900/50 text-green-900 text-sm hover:text-green-700 transition-all text-xs"
        >
          Change gamertag
        </button>
      </div>
    </div>
  );
}

function MapCanvas({ imageUrl, segments }: { imageUrl: string; segments: import("@/types").RoadSegment[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      for (const seg of segments) {
        const x = seg.bbox.x * img.naturalWidth;
        const y = seg.bbox.y * img.naturalHeight;
        const w = Math.max(seg.bbox.width * img.naturalWidth, 8);
        const h = Math.max(seg.bbox.height * img.naturalHeight, 8);
        ctx.strokeStyle = "#ff2d78";
        ctx.lineWidth = Math.max(2, img.naturalWidth / 400);
        ctx.shadowColor = "#ff2d78";
        ctx.shadowBlur = 8;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = "rgba(255,45,120,0.08)";
        ctx.fillRect(x, y, w, h);
        const cx = seg.centerX * img.naturalWidth;
        const cy = seg.centerY * img.naturalHeight;
        const r = Math.max(5, img.naturalWidth / 200);
        ctx.shadowColor = "#39ff14";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#39ff14";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 0;
        ctx.stroke();
      }
    };
    img.src = imageUrl;
  }, [imageUrl, segments]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full block"
      style={{ imageRendering: "crisp-edges" }}
    />
  );
}
