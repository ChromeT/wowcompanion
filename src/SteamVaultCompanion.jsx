import { useState, useEffect, useRef, useCallback } from "react";

const DAILY_CAP = 30;
const HOURLY_CAP = 5;
const HOUR_MS = 3600 * 1000;
const RESET_SECONDS = 300;

const STEAM_TIPS = [
  "Pastikan buff Heroism/Bloodlust aktif sebelum boss terakhir.",
  "Skip trash dengan stealth jika bisa untuk efisiensi waktu.",
  "Interrupt spell Kalithresh saat dia summon Naga Guardian.",
  "Warlord Kalithresh akan makin kuat jika dia ngedrain vials — fokus DPS dia dulu.",
  "Hydromancer Thespia: interrupt Lung Burst dan hindari cloud-nya.",
  "Mekgineer Steamrigger: bunuh engineer kecil-kecilnya duluan!",
  "Gunakan LOS (line of sight) untuk pull trash lebih aman.",
  "Cek gear drop priority sebelum run — jangan nge-greed yang tidak perlu.",
];

export default function SteamVaultCompanion() {
  const [runs, setRuns] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sv_runs") || "[]"); } catch { return []; }
  });
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(RESET_SECONDS);
  const [timerComplete, setTimerComplete] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alarmRinging, setAlarmRinging] = useState(false);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const alarmLoopRef = useRef(null);
  
  const [showLogModal, setShowLogModal] = useState(false);
  const [showLockoutsDetail, setShowLockoutsDetail] = useState(true);

  const handleWidgetLeftClick = () => {
    setShowLogModal(true);
  };

  const handleWidgetMiddleClick = (e) => {
    if (e) e.preventDefault();
    setShowLockoutsDetail(prev => !prev);
  };

  const handleWidgetShiftRightClick = (e) => {
    if (e) e.preventDefault();
    setSoundEnabled(prev => !prev);
  };

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const ensureAudioCtx = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") {
        ctx.resume();
      }
    } catch (e) {
      console.warn("AudioContext activation error:", e);
    }
  }, []);

  const playAlarm = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      // 3 ascending beeps then a long tone
      const notes = [523, 659, 784, 1047];
      const durations = [0.12, 0.12, 0.12, 0.55];
      const gaps = [0, 0.18, 0.36, 0.60];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = i < 3 ? "square" : "sine";
        osc.frequency.value = freq;
        const start = ctx.currentTime + gaps[i];
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(i < 3 ? 0.25 : 0.35, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + durations[i]);
        osc.start(start);
        osc.stop(start + durations[i] + 0.05);
      });
    } catch (e) {
      console.warn("Audio error:", e);
    }
  }, [soundEnabled]);

  const playAlarmRef = useRef(null);
  useEffect(() => {
    playAlarmRef.current = playAlarm;
  }, [playAlarm]);




  // Tick setiap detik agar countdown jam selalu update
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const DAILY_MS = 24 * 3600 * 1000;
  const hourlyRuns = runs.filter(r => now - r.id < HOUR_MS);
  const dailyRuns = runs.filter(r => now - r.id < DAILY_MS);
  const totalRuns = runs.length;

  // Cap
  const hourlyCapped = hourlyRuns.length >= HOURLY_CAP;
  const dailyCapped = dailyRuns.length >= DAILY_CAP;
  const capReached = hourlyCapped || dailyCapped;

  const remainingHourly = Math.max(0, HOURLY_CAP - hourlyRuns.length);
  const remainingToday = Math.max(0, DAILY_CAP - dailyRuns.length);

  // Sorting runs oldest to newest for cap countdown calculations
  const sortedHourly = [...hourlyRuns].sort((a, b) => a.id - b.id);
  const hourlyCapIndex = Math.max(0, sortedHourly.length - HOURLY_CAP);
  const targetHourlyRun = sortedHourly.length >= HOURLY_CAP ? sortedHourly[hourlyCapIndex] : null;
  const nextSlotMs = targetHourlyRun ? Math.max(0, targetHourlyRun.id + HOUR_MS - now) : 0;
  const nextSlotSec = Math.ceil(nextSlotMs / 1000);
  const fmtSlot = s => s > 0 ? `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` : "Ready";

  const sortedDaily = [...dailyRuns].sort((a, b) => a.id - b.id);
  const dailyCapIndex = Math.max(0, sortedDaily.length - DAILY_CAP);
  const targetDailyRun = sortedDaily.length >= DAILY_CAP ? sortedDaily[dailyCapIndex] : null;
  const nextDailySlotMs = targetDailyRun ? Math.max(0, targetDailyRun.id + DAILY_MS - now) : 0;
  const nextDailySlotSec = Math.ceil(nextDailySlotMs / 1000);
  const fmtDailySlot = s => {
    if (s <= 0) return "Ready";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const fmtDurationText = s => {
    if (s <= 0) return "Now";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h} hours ${m} mins ${sec} secs`;
    }
    if (m > 0) {
      return `${m} mins ${sec} secs`;
    }
    return `${sec} seconds`;
  };



  useEffect(() => {
    try { localStorage.setItem("sv_runs", JSON.stringify(runs)); } catch {}
  }, [runs]);

  useEffect(() => {
    const t = setInterval(() => setTipIndex(i => (i + 1) % STEAM_TIPS.length), 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (timerActive && timerSeconds > 0) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(s => {
          if (s <= 1) {
            clearInterval(timerRef.current);
            setTimerActive(false);
            setTimerComplete(true);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timerActive]);

  // Loop alarm sampai user hentikan
  useEffect(() => {
    if (alarmRinging && soundEnabled) {
      if (playAlarmRef.current) playAlarmRef.current(); // langsung bunyikan pertama kali
      alarmLoopRef.current = setInterval(() => {
        if (playAlarmRef.current) playAlarmRef.current();
      }, 2000);
    } else {
      clearInterval(alarmLoopRef.current);
    }
    return () => clearInterval(alarmLoopRef.current);
  }, [alarmRinging, soundEnabled]);

  useEffect(() => {
    if (timerComplete) {
      setAlarmRinging(true);
    }
  }, [timerComplete]);

  // Purge expired runs (older than 24 hours)
  useEffect(() => {
    const nowTs = Date.now();
    const validRuns = runs.filter(r => nowTs - r.id < 24 * 3600 * 1000);
    if (validRuns.length !== runs.length) {
      setRuns(validRuns);
    }
  }, [tick, runs]);


  const addRun = () => {
    ensureAudioCtx();
    if (capReached) return;
    const ts = Date.now();
    const run = { id: ts, date: new Date().toDateString(), time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) };
    setRuns(prev => [...prev, run]);
  };

  const removeLastRun = () => {
    ensureAudioCtx();
    if (runs.length === 0) return;
    setRuns(prev => prev.slice(0, -1));
  };


  const startTimer = () => {
    ensureAudioCtx();
    setAlarmRinging(false);
    setTimerSeconds(RESET_SECONDS);
    setTimerComplete(false);
    setTimerActive(true);
  };

  const stopTimer = () => {
    ensureAudioCtx();
    clearInterval(timerRef.current);
    setTimerActive(false);
    setTimerSeconds(RESET_SECONDS);
    setTimerComplete(false);
    setAlarmRinging(false);
  };

  const stopAlarm = () => {
    ensureAudioCtx();
    setAlarmRinging(false);
  };






  const fmt = s => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const timerPct = ((RESET_SECONDS - timerSeconds) / RESET_SECONDS) * 100;

  const hourlyBars = Array.from({ length: HOURLY_CAP }, (_, i) => i < hourlyRuns.length);
  const dailyBars = Array.from({ length: DAILY_CAP }, (_, i) => i < dailyRuns.length);

  return (
    <div style={{ minHeight: "100vh", background: "#050e14", color: "#e2eff2", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0d2733; } ::-webkit-scrollbar-thumb { background: #00ffd244; border-radius: 4px; }
        .btn { cursor: pointer; border: none; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 500; transition: all 0.15s; }
        .btn:active { transform: scale(0.97); }
        .btn-primary { background: #00ffd2; color: #050e14; padding: 10px 20px; }
        .btn-primary:hover { background: #33ffdb; }
        .btn-primary:disabled { background: #00ffd244; color: #6b93a3; cursor: not-allowed; transform: none; }
        .btn-ghost { background: transparent; color: #6b93a3; border: 1px solid #183e52; padding: 8px 16px; }
        .btn-ghost:hover { background: #0d2733; color: #e2eff2; }
        .btn-danger { background: #ff840022; color: #ff8400; border: 1px solid #ff840044; padding: 8px 16px; }
        .btn-danger:hover { background: #ff840033; }
        .btn-success { background: #3dffa322; color: #3dffa3; border: 1px solid #3dffa344; padding: 10px 24px; }
        .btn-success:hover { background: #3dffa333; }
        .widget-action:hover { background: #0d2733; color: #00ffd2 !important; }
        .pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        .steam { animation: steam 3s ease-in-out infinite; }
        @keyframes steam { 0%,100%{transform:translateY(0) scaleX(1)} 50%{transform:translateY(-4px) scaleX(1.05)} }
        .tip-fade { animation: tipfade 0.5s ease; }
        @keyframes tipfade { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Header */}
      <div style={{ background: "#0a1b24", borderBottom: "1px solid #183e52", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" stroke="#00ffd2" strokeWidth="1.5" />
          <path d="M8 14 C8 10 11 7 14 7 C17 7 20 10 20 14" stroke="#00ffd2" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="14" cy="17" r="3" fill="#00ffd244" stroke="#00ffd2" strokeWidth="1.5" />
          <path d="M7 20 Q10 16 14 20 Q18 24 21 20" stroke="#3dffa3" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        </svg>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e2eff2", letterSpacing: "0.02em" }}>Steam Vault Companion</div>
          <div style={{ fontSize: 11, color: "#6b93a3" }}>Coilfang Reservoir · Solo Farming Tracker</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 11, color: "#00ffd2", background: "#0d2733", border: "1px solid #00ffd233", borderRadius: 6, padding: "5px 10px", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
            <span style={{ color: "#3dffa3" }}>🕒</span>
            <span>{new Date().toLocaleDateString("id-ID", { weekday: 'short', day: '2-digit', month: 'short' })} · {new Date().toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
        </div>

      </div>

      {/* Tip bar */}
      <div style={{ background: "#081d29", borderBottom: "1px solid #183e5233", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#00ffd2", fontWeight: 600, whiteSpace: "nowrap" }}>💡 TIP</span>
        <span key={tipIndex} className="tip-fade" style={{ fontSize: 12, color: "#6b93a3" }}>{STEAM_TIPS[tipIndex]}</span>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* TRACKER */}
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
              
              {/* LEFT COLUMN: Live Lockouts Monitor Panel (aligned with website theme) */}
              <div style={{ flex: "1 1 360px", maxWidth: "460px", background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "16px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #183e52", paddingBottom: 8, marginBottom: 12 }}>
                  <span style={{ color: "#00ffd2", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em" }}>⚔ Live Lockouts Monitor</span>
                  <span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#3dffa3", marginLeft: "auto", boxShadow: "0 0 6px #3dffa3" }} />
                </div>

                {/* Body */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid #183e5233", paddingBottom: 6 }}>
                    <span style={{ color: "#6b93a3" }}>Run Jam Ini (Rolling):</span>
                    <span style={{ color: hourlyCapped ? "#ff8400" : "#3dffa3", fontFamily: "'JetBrains Mono', monospace", fontWeight: "bold" }}>{hourlyRuns.length} / {HOURLY_CAP}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid #183e5233", paddingBottom: 6 }}>
                    <span style={{ color: "#6b93a3" }}>Run 24 Jam Ini (Rolling):</span>
                    <span style={{ color: dailyCapped ? "#ff8400" : "#3dffa3", fontFamily: "'JetBrains Mono', monospace", fontWeight: "bold" }}>{dailyRuns.length} / {DAILY_CAP}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid #183e5233", paddingBottom: 6 }}>
                    <span style={{ color: "#6b93a3" }}>Next Dungeon Slot:</span>
                    <span style={{ color: "#00ffd2", fontWeight: "bold", fontFamily: "'JetBrains Mono', monospace" }}>{fmtDurationText(nextSlotSec)}</span>
                  </div>

                  {/* Lockouts list */}
                  {showLockoutsDetail && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ color: "#00ffd2", fontSize: 11, fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px dashed rgba(24, 62, 82, 0.4)", paddingBottom: 2, marginBottom: 4 }}>
                        Detail Lockout Aktif:
                      </div>
                      
                      {hourlyRuns.length === 0 ? (
                        <div style={{ color: "#6b93a3", fontSize: 11, fontStyle: "italic", padding: "4px 0" }}>Belum ada lockout aktif jam ini.</div>
                      ) : (
                        [...hourlyRuns].reverse().map((r) => {
                          const timeLeftSec = Math.ceil(Math.max(0, (r.id + HOUR_MS - now) / 1000));
                          const m = Math.floor(timeLeftSec / 60);
                          const s = timeLeftSec % 60;
                          const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
                          return (
                            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#e2eff2", padding: "1px 0" }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ color: "#00ffd2" }}>•</span> Steamvault Run
                              </span>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#ff8400" }}>({timeStr} tersisa)</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Actions list */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8, borderTop: "1px solid #183e52", paddingTop: 8 }}>
                    <div onClick={handleWidgetLeftClick} className="widget-action" style={{ color: "#6b93a3", cursor: "pointer", fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>📁 Riwayat Seluruh Run (Instance Frame)</span>
                      <span style={{ color: "#00ffd2", fontSize: 10 }}>Buka ➔</span>
                    </div>
                    <div onClick={(e) => handleWidgetMiddleClick(e)} className="widget-action" style={{ color: "#6b93a3", cursor: "pointer", fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>⏳ Toggle Detail Lockout Aktif</span>
                      <span style={{ color: "#00ffd2", fontSize: 10 }}>{showLockoutsDetail ? "Tutup" : "Buka"}</span>
                    </div>
                    <div onClick={(e) => handleWidgetShiftRightClick(e)} className="widget-action" style={{ color: "#6b93a3", cursor: "pointer", fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>🔊 Notifikasi Suara Reset</span>
                      <span style={{ color: soundEnabled ? "#3dffa3" : "#ff8400", fontSize: 10, fontFamily: "monospace" }}>{soundEnabled ? "AKTIF" : "MUTE"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Controls, stats & reset timers */}
              <div style={{ flex: "1 1 400px", display: "flex", flexDirection: "column", gap: 16 }}>
                
                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Run Jam Ini", value: hourlyRuns.length, sub: `dari ${HOURLY_CAP} / jam`, color: hourlyCapped ? "#ff8400" : "#00ffd2" },
                    { label: "Sisa Jam Ini", value: remainingHourly, sub: targetHourlyRun ? `Next: ${fmtSlot(nextSlotSec)}` : "Semua slot ready", color: hourlyCapped ? "#ff8400" : "#3dffa3" },
                    { label: "Run 24 Jam Ini", value: dailyRuns.length, sub: targetDailyRun ? `Next: ${fmtDailySlot(nextDailySlotSec)}` : "Semua slot ready", color: dailyCapped ? "#ff8400" : "#6b93a3" },
                    { label: "Total Lifetime", value: totalRuns, sub: "semua run", color: "#6b93a3" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, color: "#6b93a3", marginBottom: 4, fontWeight: 500 }}>{s.label}</div>
                      <div style={{ fontSize: 24, fontWeight: 600, color: s.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: "#6b93a3cc", marginTop: 4 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Progress bars */}
                <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#6b93a3", fontWeight: 500 }}>INSTANCE / JAM (ROLLING)</span>
                      <span style={{ fontSize: 11, color: hourlyCapped ? "#ff8400" : "#00ffd2", fontFamily: "'JetBrains Mono'" }}>{hourlyRuns.length}/{HOURLY_CAP}</span>
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {Array.from({ length: HOURLY_CAP }, (_, i) => i < hourlyRuns.length).map((filled, i) => (
                        <div key={i} style={{ flex: 1, height: 16, borderRadius: 4, background: filled ? "#00ffd2" : "#0d2733", transition: "background 0.3s", boxShadow: filled ? "0 0 6px #00ffd255" : "none" }} />
                      ))}
                    </div>
                    {targetHourlyRun && (
                      <div style={{ fontSize: 11, color: hourlyCapped ? "#ff8400" : "#00ffd2", marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pulse">⏳</span>
                        Slot berikutnya terbuka dalam <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 600, marginLeft: 4 }}>{fmtSlot(nextSlotSec)}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#6b93a3", fontWeight: 500 }}>INSTANCE / 24 JAM (ROLLING)</span>
                      <span style={{ fontSize: 11, color: dailyCapped ? "#ff8400" : "#6b93a3", fontFamily: "'JetBrains Mono'" }}>{dailyRuns.length}/{DAILY_CAP}</span>
                    </div>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {Array.from({ length: DAILY_CAP }, (_, i) => i < dailyRuns.length).map((filled, i) => (
                        <div key={i} style={{ width: "calc(10% - 3px)", height: 12, borderRadius: 3, background: filled ? (i >= 25 ? "#ff8400" : "#3dffa366") : "#0d2733", transition: "background 0.3s" }} />
                      ))}
                    </div>
                    {targetDailyRun && (
                      <div style={{ fontSize: 11, color: dailyCapped ? "#ff8400" : "#6b93a3", marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pulse">⏳</span>
                        Slot harian berikutnya terbuka dalam <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 600, marginLeft: 4, color: "#e2eff2" }}>{fmtDailySlot(nextDailySlotSec)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="btn"
                    style={{
                      flex: 2,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      borderRadius: 8,
                      padding: "12px 24px",
                      transition: "all 0.15s",
                      background: capReached ? "#ff840022" : "#3dffa322",
                      color: capReached ? "#ff8400" : "#3dffa3",
                      border: `1px solid ${capReached ? "#ff8400cc" : "#3dffa3cc"}`
                    }}
                    onClick={addRun}
                  >
                    {hourlyCapped && !dailyCapped
                      ? `⏳ Catat Run Selesai (Cap Jam Ini)`
                      : dailyCapped
                      ? "⚠ Catat Run Selesai (Cap Harian)"
                      : "+ Catat Run Selesai"}
                  </button>
                  <button className="btn btn-ghost" onClick={removeLastRun} disabled={runs.length === 0} style={{ fontSize: 13, flex: 1 }}>Undo</button>
                </div>

                {/* Reset Timer */}
                <div style={{ background: "#0a1b24", border: `1px solid ${timerActive ? "#00ffd244" : timerComplete ? "#3dffa344" : "#183e52"}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#6b93a3", fontWeight: 500 }}>DUNGEON RESET TIMER</div>
                      <div style={{ fontSize: 11, color: "#6b93a355", marginTop: 2 }}>Log out 5 menit untuk reset instance</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={() => { setSoundEnabled(v => !v); if (alarmRinging) setAlarmRinging(false); }}
                        title={soundEnabled ? "Matikan alarm" : "Nyalakan alarm"}
                        style={{ background: soundEnabled ? "#00ffd222" : "#6b93a322", border: `1px solid ${soundEnabled ? "#00ffd255" : "#6b93a355"}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 16, lineHeight: 1, color: soundEnabled ? "#00ffd2" : "#6b93a3", transition: "all 0.15s" }}
                        aria-label={soundEnabled ? "Mute alarm" : "Unmute alarm"}
                      >
                        {soundEnabled ? "🔔" : "🔕"}
                      </button>
                      <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 32, fontWeight: 600, color: timerComplete ? "#3dffa3" : timerActive ? "#00ffd2" : "#e2eff2" }}>
                        {fmt(timerSeconds)}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: "#0d2733", borderRadius: 4, height: 6, marginBottom: 12, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 4, background: timerComplete ? "#3dffa3" : "#00ffd2", width: `${timerPct}%`, transition: "width 1s linear" }} />
                  </div>

                  {timerComplete && (
                    <div style={{ background: "#3dffa311", border: "1px solid #3dffa333", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: "#3dffa3", textAlign: "center" }}>
                      ✅ Reset selesai! Log in sekarang dan masuk dungeon.
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    {alarmRinging && (
                      <button
                        className="btn"
                        onClick={stopAlarm}
                        style={{ flex: 1, background: "#ff840022", color: "#ff8400", border: "1px solid #ff840044", fontSize: 14, fontWeight: 600, animation: "pulse 0.8s ease-in-out infinite" }}
                      >
                        🔕 Hentikan Alarm
                      </button>
                    )}
                    {!timerActive && !alarmRinging && (
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={startTimer}>
                        {timerComplete ? "⏱ Timer Ulang" : "⏱ Mulai Timer Reset"}
                      </button>
                    )}
                    {!timerActive && alarmRinging && (
                      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={startTimer}>⏱ Timer Ulang</button>
                    )}
                    {timerActive && (
                      <>
                        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={stopTimer}>Batal</button>
                        <div style={{ flex: 2, background: "#0d2733", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#6b93a3" }}>
                          <span className="pulse">●</span>&nbsp;Menunggu reset...
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Today's run log with scroll limit */}
                {dailyRuns.length > 0 && (
                  <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 12, color: "#6b93a3", fontWeight: 500, marginBottom: 10 }}>LOG RUN (24 JAM TERAKHIR)</div>
                    <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, paddingRight: 4 }}>
                      {dailyRuns.map((r, i) => (
                        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 20, height: 20, background: "#00ffd222", border: "1px solid #00ffd244", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#00ffd2", fontFamily: "'JetBrains Mono'" }}>{i + 1}</div>
                          <div style={{ fontSize: 13, color: "#e2eff2" }}>Run #{i + 1}</div>
                          <div style={{ marginLeft: "auto", fontSize: 11, color: "#6b93a3", fontFamily: "'JetBrains Mono'" }}>{r.time}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>

            </div>
            
            {/* Instance Frame Modal */}
            {showLogModal && (
              <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
                <div style={{ background: "#0a1b24", border: "2px solid #ffd100", borderRadius: 8, width: "90%", maxWidth: "500px", padding: 20, boxShadow: "0 0 20px rgba(0,0,0,0.8)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #183e52", paddingBottom: 10, marginBottom: 15 }}>
                    <h3 style={{ color: "#ffd100", fontSize: 16 }}>Instance Frame - Log Seluruh Run</h3>
                    <button style={{ background: "transparent", border: "none", color: "#6b93a3", fontSize: 18, cursor: "pointer" }} onClick={() => setShowLogModal(false)}>✕</button>
                  </div>
                  <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
                    {runs.length === 0 ? (
                      <div style={{ color: "#6b93a3", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Belum ada run yang tercatat.</div>
                    ) : (
                      [...runs].reverse().map((r, i) => (
                        <div key={r.id} style={{ display: "flex", justifyItems: "center", alignItems: "center", background: "#0d2733", border: "1px solid #183e52", borderRadius: 6, padding: "8px 12px" }}>
                          <span style={{ fontSize: 12, color: "#00ffd2", fontWeight: 600, marginRight: 10 }}>Run #{runs.length - i}</span>
                          <span style={{ fontSize: 12, color: "#e2eff2" }}>{new Date(r.id).toLocaleDateString("id-ID", { day: '2-digit', month: 'short' })}</span>
                          <span style={{ fontSize: 11, color: "#6b93a3", marginLeft: 8 }}>{r.time}</span>
                          <button
                            style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#ff8400", fontSize: 11, cursor: "pointer" }}
                            onClick={() => {
                              if (confirm("Hapus run ini?")) {
                                setRuns(prev => prev.filter(item => item.id !== r.id));
                              }
                            }}
                          >
                            Hapus
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 15 }}>
                    <button className="btn btn-ghost" onClick={() => setShowLogModal(false)}>Tutup</button>
                  </div>
                </div>
              </div>
            )}

          </div>
      </div>



      {/* Footer */}
      <div style={{ background: "#040b0f", borderTop: "1px solid #183e5233", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "#6b93a344", letterSpacing: "0.05em" }}>
          © {new Date().getFullYear()} <span style={{ color: "#00ffd266", fontWeight: 600 }}>ChromeT</span> · WoW TBC Companion
        </span>
      </div>

    </div>
  );
}
