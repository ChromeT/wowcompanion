import { useState, useEffect, useRef, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const HOURLY_CAP = 5;
const HOUR_MS = 3600 * 1000;
const RESET_SECONDS = 300;
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 jam tanpa run = sesi selesai


export default function SteamVaultCompanion() {
  const [username, setUsername] = useState(() => localStorage.getItem("sv_username") || "");
  const [usernameInput, setUsernameInput] = useState("");
  const [runs, setRuns] = useState([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [sessionStart, setSessionStart] = useState(() => {
    const stored = localStorage.getItem("sv_session_start");
    return stored ? parseInt(stored, 10) : null;
  });
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(RESET_SECONDS);
  const [timerComplete, setTimerComplete] = useState(false);
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
  const hourlyRuns = runs.filter(r => now - r.id < HOUR_MS);
  const totalRuns = runs.length;

  // Cap
  const hourlyCapped = hourlyRuns.length >= HOURLY_CAP;
  const capReached = hourlyCapped;

  const remainingHourly = Math.max(0, HOURLY_CAP - hourlyRuns.length);

  // Sorting runs oldest to newest for cap countdown calculations
  const sortedHourly = [...hourlyRuns].sort((a, b) => a.id - b.id);
  const hourlyCapIndex = Math.max(0, sortedHourly.length - HOURLY_CAP);
  const targetHourlyRun = sortedHourly.length >= HOURLY_CAP ? sortedHourly[hourlyCapIndex] : null;
  const nextSlotMs = targetHourlyRun ? Math.max(0, targetHourlyRun.id + HOUR_MS - now) : 0;
  const nextSlotSec = Math.ceil(nextSlotMs / 1000);
  const fmtSlot = s => s > 0 ? `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` : "Ready";

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

  // Session timer: localStorage-backed, auto-reset setelah 2 jam tanpa run
  const fmtSessionTime = s => {
    if (s <= 0) return "--:--";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
    return `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
  };
  const sessionElapsedSec = sessionStart ? Math.floor((now - sessionStart) / 1000) : 0;



  const saveRunsToFirebase = useCallback((newRuns) => {
    if (username) {
      setDoc(doc(db, "users", username), { runs: newRuns }).catch(console.error);
    }
  }, [username]);

  useEffect(() => {
    if (username) {
      setIsLoadingRuns(true);
      const fetchRuns = async () => {
        try {
          const docRef = doc(db, "users", username);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setRuns(docSnap.data().runs || []);
          } else {
            setRuns([]);
          }
        } catch (err) {
          console.error("Failed to load runs:", err);
        } finally {
          setIsLoadingRuns(false);
        }
      };
      fetchRuns();
    }
  }, [username]);

  const handleLogin = (e) => {
    e.preventDefault();
    const trimmed = usernameInput.trim();
    if (trimmed) {
      localStorage.setItem("sv_username", trimmed);
      setUsername(trimmed);
      setRuns([]);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("sv_username");
    setUsername("");
    setUsernameInput("");
    setRuns([]);
  };



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

  // Purge expired runs (older than 1 hour)
  useEffect(() => {
    if (!username || isLoadingRuns) return;
    const nowTs = Date.now();
    const validRuns = runs.filter(r => nowTs - r.id < HOUR_MS);
    if (validRuns.length !== runs.length) {
      setRuns(validRuns);
      saveRunsToFirebase(validRuns);
    }
  }, [tick, runs, username, isLoadingRuns, saveRunsToFirebase]);

  // Auto-reset session jika 2 jam tidak ada run baru
  useEffect(() => {
    if (!sessionStart) return;
    const lastRun = runs.length > 0 ? Math.max(...runs.map(r => r.id)) : null;
    const timeSinceLastRun = lastRun ? Date.now() - lastRun : Date.now() - sessionStart;
    if (timeSinceLastRun > SESSION_TIMEOUT_MS) {
      localStorage.removeItem("sv_session_start");
      setSessionStart(null);
    }
  }, [tick, runs, sessionStart]);


  const addRun = () => {
    ensureAudioCtx();
    if (capReached) return;
    const ts = Date.now();
    // Mulai sesi baru jika belum ada sessionStart
    if (!sessionStart) {
      localStorage.setItem("sv_session_start", ts.toString());
      setSessionStart(ts);
    }
    const run = { id: ts, date: new Date().toDateString(), time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) };
    const newRuns = [...runs, run];
    setRuns(newRuns);
    saveRunsToFirebase(newRuns);
  };

  const removeLastRun = () => {
    ensureAudioCtx();
    if (runs.length === 0) return;
    const newRuns = runs.slice(0, -1);
    setRuns(newRuns);
    saveRunsToFirebase(newRuns);
  };


  const startTimer = () => {
    ensureAudioCtx();
    addRun();
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
    removeLastRun();
  };

  const stopAlarm = () => {
    ensureAudioCtx();
    setAlarmRinging(false);
  };






  const fmt = s => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const timerPct = ((RESET_SECONDS - timerSeconds) / RESET_SECONDS) * 100;

  const hourlyBars = Array.from({ length: HOURLY_CAP }, (_, i) => i < hourlyRuns.length);

  if (!username) {
    return (
      <div style={{ minHeight: "100vh", background: "#050e14", display: "flex", justifyContent: "center", alignItems: "center", color: "#e2eff2", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          .btn { cursor: pointer; border: none; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 500; transition: all 0.15s; }
          .btn:active { transform: scale(0.97); }
          .btn-primary { background: #00ffd2; color: #050e14; padding: 10px 20px; }
          .btn-primary:hover { background: #33ffdb; }
        `}</style>
        <form onSubmit={handleLogin} style={{ background: "#0a1b24", padding: 40, borderRadius: 16, border: "1px solid #183e52", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", maxWidth: 400, width: "90%" }}>
          <div style={{ marginBottom: 24 }}>
            <svg width="48" height="48" viewBox="0 0 28 28" fill="none" style={{ margin: "0 auto" }}>
              <circle cx="14" cy="14" r="13" stroke="#00ffd2" strokeWidth="1.5" />
              <path d="M8 14 C8 10 11 7 14 7 C17 7 20 10 20 14" stroke="#00ffd2" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="14" cy="17" r="3" fill="#00ffd244" stroke="#00ffd2" strokeWidth="1.5" />
              <path d="M7 20 Q10 16 14 20 Q18 24 21 20" stroke="#3dffa3" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
            </svg>
          </div>
          <h2 style={{ color: "#00ffd2", marginBottom: 8, fontSize: 20 }}>Steam Vault Companion</h2>
          <p style={{ color: "#6b93a3", marginBottom: 30, fontSize: 13 }}>Enter your nickname to continue</p>
          <input 
            autoFocus
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            placeholder="Nickname..."
            style={{ padding: "12px 16px", borderRadius: 8, border: "1px solid #183e52", background: "#0d2733", color: "#00ffd2", width: "100%", marginBottom: 20, outline: "none", fontSize: 15, fontFamily: "'JetBrains Mono', monospace" }}
          />
          <button type="submit" className="btn btn-primary" style={{ width: "100%", fontSize: 16, padding: "12px 0" }}>Login</button>
        </form>
      </div>
    );
  }

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
        .tracker-grid { display: grid; grid-template-columns: 320px 1fr; gap: 20px; align-items: stretch; }
        .left-col { display: flex; flex-direction: column; gap: 16px; }
        .right-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .chart-fill { flex: 1; display: flex; flex-direction: column; }
        @media (max-width: 700px) {
          .tracker-grid { grid-template-columns: 1fr; }
        }
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 10 }}>
            <span style={{ color: "#e2eff2", fontSize: 13, fontWeight: 500 }}>👤 {username}</span>
            <button onClick={handleLogout} className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}>Logout</button>
          </div>
          <div style={{ fontSize: 11, color: "#00ffd2", background: "#0d2733", border: "1px solid #00ffd233", borderRadius: 6, padding: "5px 10px", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
            <span style={{ color: "#3dffa3" }}>🕒</span>
            <span>{new Date().toLocaleDateString("id-ID", { weekday: 'short', day: '2-digit', month: 'short' })} · {new Date().toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
        </div>

      </div>

      <div style={{ flex: 1 }}>

        {/* TRACKER */}
          <div style={{ padding: 20 }}>
            <div className="tracker-grid">
              
              {/* LEFT COLUMN */}
              <div className="left-col">

              {/* Live Lockouts Monitor Panel */}
              <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "16px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
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

              {/* Mini Chart: Run distribution this hour */}
              {(() => {
                const BUCKETS = 12; // 12 x 5 menit = 60 menit
                const BUCKET_MS = 5 * 60 * 1000;
                const buckets = Array.from({ length: BUCKETS }, (_, i) => {
                  const bucketStart = now - (BUCKETS - i) * BUCKET_MS;
                  const bucketEnd = bucketStart + BUCKET_MS;
                  const count = runs.filter(r => r.id >= bucketStart && r.id < bucketEnd).length;
                  const label = `-${(BUCKETS - i) * 5}m`;
                  return { count, label };
                });
                const maxCount = Math.max(1, ...buckets.map(b => b.count));
                const totalThisHour = hourlyRuns.length;
                const avgPerBucket = totalThisHour > 0 ? (totalThisHour / BUCKETS).toFixed(1) : "0";
                return (
                  <div className="chart-fill" style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "16px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #183e52", paddingBottom: 8, marginBottom: 14 }}>
                      <span style={{ color: "#00ffd2", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em" }}>📊 Distribusi Run (60 Menit)</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b93a3", fontFamily: "'JetBrains Mono'" }}>avg {avgPerBucket}/5m</span>
                    </div>

                    {/* Bar chart — always rendered */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80, marginBottom: 6 }}>
                      {buckets.map((b, i) => {
                        const heightPct = b.count > 0 ? Math.max(10, (b.count / maxCount) * 100) : 0;
                        const barColor = b.count === 0 ? "#0d2733"
                          : b.count >= maxCount ? "#00ffd2"
                          : i >= BUCKETS - 2 ? "#3dffa3aa"
                          : "#3dffa355";
                        const glowColor = b.count >= maxCount ? "0 0 8px #00ffd288" : "none";
                        return (
                          <div
                            key={i}
                            title={`${b.label}: ${b.count} run`}
                            style={{
                              flex: 1,
                              height: b.count > 0 ? `${heightPct}%` : "4px",
                              background: barColor,
                              borderRadius: "3px 3px 0 0",
                              transition: "height 0.4s ease, background 0.3s",
                              boxShadow: glowColor,
                              cursor: "default",
                              alignSelf: "flex-end",
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* X-axis labels */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#6b93a355", fontFamily: "'JetBrains Mono'" }}>
                      <span>-60m</span>
                      <span>-45m</span>
                      <span>-30m</span>
                      <span>-15m</span>
                      <span>now</span>
                    </div>

                    {totalThisHour === 0 && (
                      <div style={{ textAlign: "center", color: "#6b93a322", fontSize: 10, fontStyle: "italic", marginTop: 6 }}>
                        belum ada run dalam 1 jam terakhir
                      </div>
                    )}

                    {/* Legend */}
                    <div style={{ marginTop: 14, display: "flex", gap: 12 }}>
                      {[
                        { color: "#00ffd2", label: "Peak" },
                        { color: "#3dffa388", label: "Normal" },
                        { color: "#0d2733", label: "Kosong" },
                      ].map(({ color, label }) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#6b93a3" }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2, background: color, border: "1px solid #183e52" }} />
                          {label}
                        </div>
                      ))}
                    </div>

                    {/* Totals + Estimasi */}
                    {(() => {
                      const sessionRuns = sessionStart
                        ? [...runs].filter(r => r.id >= sessionStart).sort((a, b) => a.id - b.id)
                        : [];
                      const sessionRunCount = sessionRuns.length;

                      // Hitung avg gap antar run (cycle time)
                      let totalGapSec = 0;
                      for (let i = 1; i < sessionRuns.length; i++) {
                        totalGapSec += (sessionRuns[i].id - sessionRuns[i - 1].id) / 1000;
                      }
                      const gapCount = sessionRuns.length - 1;
                      const avgCycleSec = gapCount > 0 ? Math.round(totalGapSec / gapCount) : 0;
                      const estDungeonSec = Math.max(0, avgCycleSec - RESET_SECONDS);
                      const efficiencyPct = avgCycleSec > 0 ? Math.round((estDungeonSec / avgCycleSec) * 100) : 0;

                      const fmtSec = s => {
                        if (s <= 0) return "--:--";
                        const m = Math.floor(s / 60);
                        const sec = s % 60;
                        return `${m}:${sec.toString().padStart(2, '0')}`;
                      };

                      const hasEstimate = gapCount >= 1;

                      return (
                        <>
                          {/* Run counts */}
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #183e5244", display: "flex", gap: 0 }}>
                            {[
                              { label: "/ jam", value: totalThisHour, color: hourlyCapped ? "#ff8400" : "#00ffd2" },
                              { label: "/ sesi", value: sessionRunCount, color: sessionStart ? "#3dffa3" : "#6b93a355" },
                              { label: "lifetime", value: totalRuns, color: "#6b93a355" },
                            ].map((item, i, arr) => (
                              <div key={i} style={{ flex: 1, borderRight: i < arr.length - 1 ? "1px solid #183e5244" : "none", paddingRight: i < arr.length - 1 ? 12 : 0, paddingLeft: i > 0 ? 12 : 0 }}>
                                <div style={{ fontSize: 18, fontWeight: 700, color: item.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{item.value}</div>
                                <div style={{ fontSize: 9, color: "#6b93a355", marginTop: 3, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>{item.label}</div>
                              </div>
                            ))}
                          </div>

                          {/* Estimasi timing */}
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #183e5244" }}>
                            <div style={{ fontSize: 9, color: "#6b93a355", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
                              EST. TIMING {!hasEstimate && <span style={{ color: "#6b93a322" }}>— butuh ≥ 2 run</span>}
                            </div>
                            <div style={{ display: "flex", gap: 0 }}>
                              {[
                                { label: "cycle", value: fmtSec(avgCycleSec), title: "Avg waktu 1 siklus (masuk→reset→masuk lagi)", color: "#6b93a3" },
                                { label: "dungeon", value: fmtSec(estDungeonSec), title: "Est. waktu di dalam dungeon (cycle - 5 min reset)", color: "#3dffa3" },
                                { label: "efisiensi", value: hasEstimate ? `${efficiencyPct}%` : "--", title: "% waktu aktif di dalam dungeon", color: efficiencyPct >= 60 ? "#3dffa3" : efficiencyPct >= 40 ? "#00ffd2" : "#ff8400" },
                              ].map((item, i, arr) => (
                                <div key={i} title={item.title} style={{ flex: 1, borderRight: i < arr.length - 1 ? "1px solid #183e5244" : "none", paddingRight: i < arr.length - 1 ? 10 : 0, paddingLeft: i > 0 ? 10 : 0 }}>
                                  <div style={{ fontSize: 15, fontWeight: 700, color: hasEstimate ? item.color : "#6b93a322", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{item.value}</div>
                                  <div style={{ fontSize: 9, color: "#6b93a355", marginTop: 3, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>{item.label}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}


                  </div>
                );
              })()}
              </div>{/* end left column */}

              {/* RIGHT COLUMN: Controls, stats & reset timers */}
              <div className="right-col">
                
                {/* Combined Run Stats Card */}
                {(() => {
                  const sessionRuns = sessionStart ? runs.filter(r => r.id >= sessionStart) : [];
                  const sessionRunCount = sessionRuns.length;
                  const stats = [
                    { label: "/ JAM", value: hourlyRuns.length, max: HOURLY_CAP, color: hourlyCapped ? "#ff8400" : "#00ffd2" },
                    { label: "/ SESI", value: sessionRunCount, max: null, color: sessionStart ? "#3dffa3" : "#6b93a3" },
                    { label: "LIFETIME", value: totalRuns, max: null, color: "#6b93a355" },
                  ];
                  return (
                    <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, color: "#6b93a3", fontWeight: 500, marginBottom: 10, letterSpacing: "0.05em" }}>RUN COUNT</div>
                      <div style={{ display: "flex", gap: 0 }}>
                        {stats.map((s, i) => (
                          <div key={i} style={{ flex: 1, borderRight: i < stats.length - 1 ? "1px solid #183e52" : "none", paddingRight: i < stats.length - 1 ? 16 : 0, paddingLeft: i > 0 ? 16 : 0 }}>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, lineHeight: 1 }}>
                              <span style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</span>
                              {s.max && <span style={{ fontSize: 11, color: "#6b93a355", marginBottom: 3, fontFamily: "'JetBrains Mono'" }}>/{s.max}</span>}
                            </div>
                            <div style={{ fontSize: 10, color: "#6b93a3", marginTop: 5, fontWeight: 600, letterSpacing: "0.04em" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Sisa + Session row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#6b93a3", marginBottom: 4, fontWeight: 500 }}>SISA JAM INI</div>
                    <div style={{ fontSize: 24, fontWeight: 600, color: hourlyCapped ? "#ff8400" : "#3dffa3", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{remainingHourly}</div>
                    <div style={{ fontSize: 10, color: "#6b93a3cc", marginTop: 4 }}>{targetHourlyRun ? `Next: ${fmtSlot(nextSlotSec)}` : "Semua slot ready"}</div>
                  </div>
                  <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#6b93a3", marginBottom: 4, fontWeight: 500 }}>SESSION TIMER</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: sessionStart ? "#00ffd2" : "#6b93a3", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{fmtSessionTime(sessionElapsedSec)}</div>
                    <div style={{ fontSize: 10, color: "#6b93a3cc", marginTop: 4 }}>{sessionStart ? "sesi aktif" : "belum ada run"}</div>
                  </div>
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
                    {hourlyCapped
                      ? `⏳ Catat Run Selesai (Cap Jam Ini)`
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
                {hourlyRuns.length > 0 && (
                  <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 12, color: "#6b93a3", fontWeight: 500, marginBottom: 10 }}>LOG RUN (1 JAM TERAKHIR)</div>
                    <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, paddingRight: 4 }}>
                      {hourlyRuns.map((r, i) => (
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
                                const newRuns = runs.filter(item => item.id !== r.id);
                                setRuns(newRuns);
                                saveRunsToFirebase(newRuns);
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
