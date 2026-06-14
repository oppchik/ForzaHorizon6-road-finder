"use client";

import { useState, useEffect, useRef } from "react";
import type { XboxProfileResponse, AnalysisResult } from "@/types";
import type { ScreenshotItem } from "@/app/api/screenshots/route";

type Step = "input" | "profile" | "result";
const GITHUB = "https://github.com/oppchik/ForzaHorizon6-road-finder";

export default function Home() {
  const [step, setStep] = useState<Step>("input");
  const [gamertag, setGamertag] = useState("");
  const [profile, setProfile] = useState<XboxProfileResponse | null>(null);
  const [shots, setShots] = useState<ScreenshotItem[]>([]);
  const [shotsLoading, setShotsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpLang, setHelpLang] = useState<"en"|"ru">("en");

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!gamertag.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/xbox?gamertag=${encodeURIComponent(gamertag.trim())}`);
      const data: XboxProfileResponse = await res.json();
      if (!data.success || !data.profile) { setError(data.error ?? "Not found."); return; }
      setProfile(data);
      setStep("profile");
      if (data.profile.xuid) {
        setShotsLoading(true);
        fetch(`/api/screenshots?xuid=${data.profile.xuid}`)
          .then(r => r.json())
          .then(s => { if (s.success && s.screenshots?.length) setShots(s.screenshots); })
          .catch(() => {})
          .finally(() => setShotsLoading(false));
      }
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }

  async function resize(blob: Blob, w = 960): Promise<Blob> {
    return new Promise(res => {
      const img = new Image();
      const u = URL.createObjectURL(blob);
      img.onload = () => {
        const sc = Math.min(1, w / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(b => res(b ?? blob), "image/jpeg", 0.85);
      };
      img.src = u;
    });
  }

  async function analyse(blob: Blob) {
    setLoading(true); setError(null);
    try {
      const small = await resize(blob, 960);
      const fd = new FormData();
      fd.append("image", small, "map.jpg");
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: AnalysisResult = await res.json();
      if (!data.success) { setError(data.error ?? "Analysis failed."); return; }
      setResult(data);
      setStep("result");
    } catch (err) {
      setError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setLoading(false); }
  }

  async function selectShot(fullUrl: string) {
    try {
      const r = await fetch(`/api/proxy-image?url=${encodeURIComponent(fullUrl)}`);
      if (!r.ok) throw new Error(`Proxy ${r.status}`);
      const blob = await r.blob();
      if (!blob.size) throw new Error("Empty");
      await analyse(blob);
    } catch (err) {
      setError(`Could not load screenshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function reset() {
    setStep("input"); setGamertag(""); setProfile(null);
    setShots([]); setResult(null); setError(null);
  }

  return (
    <div className="page-bg" style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <div />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="icon-btn" onClick={() => setHelpOpen(true)} title="Help">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <path d="M12 17h.01"/>
            </svg>
          </button>
          <button className="icon-btn" onClick={() => window.open(GITHUB, "_blank")} title="GitHub">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </button>
        </div>
      </header>

      {helpOpen && <HelpModal lang={helpLang} onLang={setHelpLang} onClose={() => setHelpOpen(false)} />}

      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 52px)", padding: "32px 16px" }}>

        {step === "input" && (
          <div className="anim-0" style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", alignItems: "center", gap: 0, boxSizing: "border-box" }}>
            <RaceTrackBorder>
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <h1 className="font-display" style={{ fontSize: "3rem", fontWeight: 700, color: "#fff", lineHeight: 1.1, marginBottom: 10 }}>
                  FORZA ROAD<br />
                  <span style={{ color: "var(--g1)" }}>FINDER</span>
                </h1>
                <p style={{ fontSize: "0.75rem", color: "rgba(0,200,90,0.45)", letterSpacing: "0.22em" }}>FORZA HORIZON 6</p>
              </div>

              {error && (
                <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,80,80,0.3)", background: "rgba(255,50,50,0.08)", color: "#ff9999", fontSize: "0.85rem", width: "100%" }}>
                  {error}
                </div>
              )}

              <form onSubmit={lookup} style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
                <div className="input-wrap">
                  <input
                    type="text"
                    placeholder="Enter Xbox Gamertag"
                    value={gamertag}
                    onChange={e => setGamertag(e.target.value)}
                    maxLength={52}
                    required
                    style={{ width: "100%", background: "transparent", border: "none", outline: "none", padding: "14px 18px", fontSize: "1rem", color: "#fff", fontFamily: "Inter, sans-serif" }}
                  />
                </div>
                <button type="submit" disabled={loading || !gamertag.trim()} className="btn">
                  {loading ? <Spinner /> : "FIND ROADS →"}
                </button>
              </form>
            </RaceTrackBorder>
          </div>
        )}

        {step === "profile" && profile?.profile && (
          <div className="anim-0" style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>

            <div className="anim-1" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 8 }}>
              <div className="avatar-frame">
                <div style={{ width: 130, height: 130, borderRadius: "50%", overflow: "hidden", background: "var(--g3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 }}>
                  {profile.profile.displayPicRaw
                    ? <img src={profile.profile.displayPicRaw} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : "👤"}
                </div>
              </div>
              <p className="font-display" style={{ fontSize: "2.2rem", fontWeight: 700, color: "#fff", marginTop: 6 }}>{profile.profile.gamertag}</p>
              <p style={{ fontSize: "1.1rem", color: "rgba(0,200,90,0.6)" }}>{profile.profile.gamerscore.toLocaleString()} GS</p>
            </div>

            <div className="anim-2" style={{ width: "100%" }}>
              {shotsLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
              ) : shots.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18, width: "100%" }}>
                  {shots.map(shot => (
                    <button
                      key={shot.id}
                      className="shot-card"
                      onClick={() => selectShot(shot.fullUrl)}
                      disabled={loading}
                      style={{ cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
                    >
                      <img
                        src={`/api/proxy-image?url=${encodeURIComponent(shot.thumbnailUrl)}`}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        onError={e => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                      />
                      <div className="use-label">USE THIS</div>
                      {loading && (
                        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3 }}>
                          <Spinner />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{ textAlign: "center", color: "rgba(0,200,90,0.35)", fontSize: "0.85rem" }}>No public screenshots found</p>
              )}
            </div>

            {error && (
              <div style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,80,80,0.3)", background: "rgba(255,50,50,0.08)", color: "#ff9999", fontSize: "0.85rem" }}>
                {error}
              </div>
            )}

            <button onClick={reset} style={{ padding: "10px 28px", borderRadius: 10, border: "1px solid rgba(0,200,90,0.25)", background: "transparent", cursor: "pointer", color: "rgba(0,200,90,0.5)", fontSize: "0.75rem", letterSpacing: "0.15em", fontFamily: "Rajdhani, sans-serif", fontWeight: 600, transition: "border-color .2s, color .2s" }}>
              ← CHANGE GAMERTAG
            </button>
          </div>
        )}

        {step === "result" && result && (
          <ResultView
            result={result}
            onBack={() => { setStep("profile"); setResult(null); setError(null); }}
            onReset={reset}
          />
        )}
      </main>
    </div>
  );
}

function RaceTrackBorder({ children }: { children: React.ReactNode }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let raf: number;
    let pos = 0;

    function tick() {
      if (!svg) { raf = requestAnimationFrame(tick); return; }
      const pathEl = svg.querySelector<SVGPathElement>("#track-path");
      const trail  = svg.querySelector<SVGPathElement>("#trail");
      const car    = svg.querySelector<SVGCircleElement>("#car");
      if (!pathEl || !trail || !car) { raf = requestAnimationFrame(tick); return; }

      const totalLen = pathEl.getTotalLength();
      const SPEED = totalLen / 220;
      const trailLen = totalLen * 0.18;

      pos = (pos + SPEED) % totalLen;
      const headPt = pathEl.getPointAtLength(pos);
      car.setAttribute("cx", String(headPt.x));
      car.setAttribute("cy", String(headPt.y));

      const steps = 60;
      let d = `M ${headPt.x} ${headPt.y}`;
      for (let i = 1; i <= steps; i++) {
        const p = (pos - (trailLen * i / steps) + totalLen) % totalLen;
        const pt = pathEl.getPointAtLength(p);
        d += ` L ${pt.x} ${pt.y}`;
      }
      trail.setAttribute("d", d);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const W = 480, H = 340, R = 18;
  const rectPath = `M ${W-R},${R} L ${R},${R} A ${R},${R} 0 0 0 0,${R+R} L 0,${H-R} A ${R},${R} 0 0 0 ${R},${H} L ${W-R},${H} A ${R},${R} 0 0 0 ${W},${H-R} L ${W},${R+R} A ${R},${R} 0 0 0 ${W-R},${R} Z`;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", maxWidth: W }}>
      <style>{`
        @media (max-width: 768px) {
          .track-svg { display: none !important; }
          .track-container { padding-top: 0 !important; height: auto !important; }
          .track-content { position: relative !important; padding: 0 !important; }
        }
      `}</style>
      <svg
        className="track-svg"
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        <path id="track-path" d={rectPath} fill="none" stroke="transparent" strokeWidth="0" />
        <path d={rectPath} fill="none" stroke="rgba(0,200,90,0.15)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path id="trail" d="" fill="none" stroke="url(#trailGrad)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle id="car" cx="0" cy="0" r="5" fill="#00ff55" style={{ filter: "drop-shadow(0 0 6px #00ff55)" }} />
        <defs>
          <linearGradient id="trailGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00ff55" stopOpacity="0" />
            <stop offset="100%" stopColor="#00ff55" stopOpacity="0.9" />
          </linearGradient>
        </defs>
      </svg>
      <div className="track-container" style={{
        paddingTop: `${(H/W)*100}%`,
        position: "relative",
      }}>
        <div className="track-content" style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 28px",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
      <path d="M12 2a10 10 0 0 1 10 10"/>
    </svg>
  );
}

function HelpModal({ lang, onLang, onClose }: { lang: "en"|"ru"; onLang: (l: "en"|"ru") => void; onClose: () => void }) {
  const t = {
    en: {
      title: "HOW TO USE",
      steps: [
        ["01", "Enter your Xbox Gamertag and press FIND ROADS"],
        ["02", "Your last 3 Forza Horizon 6 screenshots appear automatically"],
        ["03", "Tap a map screenshot — analysis starts instantly"],
        ["04", "Unexplored roads are highlighted in green"],
        ["05", "Use your phone next to your TV to navigate to missing roads"],
      ],
      tip: "For best results, take a screenshot of a zoomed-in map in-game without race markers or other activities, and make sure the screenshot is on the XBOX network.",
    },
    ru: {
      title: "КАК ИСПОЛЬЗОВАТЬ",
      steps: [
        ["01", "Введите Xbox Gamertag и нажмите FIND ROADS"],
        ["02", "Автоматически появятся ваши последние 3 скриншота FH6"],
        ["03", "Нажмите на скриншот карты — анализ запустится сразу"],
        ["04", "Неисследованные дороги подсветятся зелёным"],
        ["05", "Смотрите в телефон рядом с телевизором — едьте к нужным дорогам"],
      ],
      tip: "Для лучшего результата: сделайте скриншот приближённой карты в игре без маркеров гонок или прочих активностей и убедитесь, что скриншот находится в сети XBOX.",
    },
  };
  const c = t[lang];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <span className="font-display" style={{ fontSize: "0.8rem", color: "var(--g1)", letterSpacing: "0.15em" }}>{c.title}</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["en","ru"] as const).map(l => (
              <button key={l} onClick={() => onLang(l)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: lang===l ? "rgba(0,200,90,0.5)" : "transparent", background: lang===l ? "rgba(0,200,90,0.1)" : "transparent", color: lang===l ? "var(--g1)" : "rgba(0,200,90,0.3)", fontSize: "0.7rem", cursor: "pointer", fontFamily: "Inter" }}>
                {l.toUpperCase()}
              </button>
            ))}
            <button onClick={onClose} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "rgba(0,200,90,0.3)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
          {c.steps.map(([n, s]) => (
            <div key={n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span className="font-display" style={{ color: "var(--g1)", fontSize: "0.75rem", fontWeight: 700, minWidth: 22, marginTop: 1 }}>{n}</span>
              <span style={{ fontSize: "0.875rem", color: "rgba(212,240,223,0.75)", lineHeight: 1.5 }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(0,200,90,0.12)", background: "rgba(0,200,90,0.04)", fontSize: "0.78rem", color: "rgba(0,200,90,0.5)", lineHeight: 1.6 }}>
          {c.tip}
        </div>
      </div>
    </div>
  );
}

function ResultView({ result, onBack, onReset }: { result: AnalysisResult; onBack: () => void; onReset: () => void }) {
  return (
    <div className="anim-0" style={{ width: "100%", maxWidth: 960, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="font-display" style={{ color: "#fff", fontSize: "1.2rem" }}>
          UNEXPLORED ROADS <span style={{ color: "var(--g1)" }}>HIGHLIGHTED</span>
        </span>
        <span style={{ fontSize: "0.7rem", color: "rgba(0,200,90,0.35)", fontFamily: "monospace" }}>{result.processingTimeMs}ms</span>
      </div>

      {result.imageBase64 && (
        <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid rgba(0,200,90,0.2)", boxShadow: "0 0 40px rgba(0,200,90,0.08)" }}>
          <img
            src={`data:image/jpeg;base64,${result.imageBase64}`}
            alt="Map with highlighted roads"
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}

      <p style={{ textAlign: "center", fontSize: "0.82rem", color: "rgba(0,200,90,0.55)" }}>
        Green = unexplored roads
      </p>

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onBack} style={{ flex: 1, padding: "14px", borderRadius: 12, border: "1px solid rgba(0,200,90,0.25)", background: "transparent", color: "rgba(0,200,90,0.8)", cursor: "pointer", fontFamily: "Rajdhani, sans-serif", fontWeight: 700, fontSize: "1rem", letterSpacing: "0.08em" }}>
          ← TRY ANOTHER
        </button>
        <button onClick={onReset} style={{ padding: "14px 22px", borderRadius: 12, border: "1px solid rgba(0,200,90,0.2)", background: "transparent", color: "rgba(0,200,90,0.55)", cursor: "pointer", fontSize: "0.9rem", fontFamily: "Inter, sans-serif" }}>
          Change gamertag
        </button>
      </div>
    </div>
  );
}
