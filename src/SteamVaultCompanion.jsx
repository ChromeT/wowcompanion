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
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Halo Adventurer! Aku siap bantu farming Steam Vault kamu. Tanya apa saja — tips boss, strategi, gear, atau apapun!" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("tracker");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alarmRinging, setAlarmRinging] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const chatEndRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const alarmLoopRef = useRef(null);

  const logDebug = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev, `[${time}] ${msg}`].slice(-10));
    console.log(msg);
  }, []);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      logDebug("Creating new AudioContext");
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const ensureAudioCtx = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") {
        logDebug("Initializing/resuming AudioContext on user gesture...");
        ctx.resume().then(() => {
          logDebug(`AudioContext resumed successfully. State: ${ctx.state}`);
        });
      }
    } catch (e) {
      logDebug(`AudioContext gesture activation error: ${e.message}`);
    }
  }, [logDebug]);


  const playAlarm = useCallback(() => {
    logDebug(`playAlarm invoked. soundEnabled=${soundEnabled}`);
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      logDebug(`AudioContext state: ${ctx.state}, currentTime: ${ctx.currentTime.toFixed(3)}`);
      if (ctx.state === "suspended") {
        logDebug("Attempting to resume AudioContext...");
        ctx.resume().then(() => {
          logDebug(`AudioContext resumed successfully. State: ${ctx.state}`);
        }).catch(err => {
          logDebug(`AudioContext resume failed: ${err.message}`);
        });
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
      logDebug("Oscillators scheduled successfully");
    } catch (e) {
      logDebug(`Audio error: ${e.message}`);
    }
  }, [soundEnabled, logDebug]);


  // Tick setiap detik agar countdown jam selalu update
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const todayRuns = runs.filter(r => r.date === new Date().toDateString());
  const hourlyRuns = runs.filter(r => now - r.id < HOUR_MS);
  const totalRuns = runs.length;

  // Cap
  const hourlyCapped = hourlyRuns.length >= HOURLY_CAP;
  const dailyCapped = todayRuns.length >= DAILY_CAP;
  const capReached = hourlyCapped || dailyCapped;

  const remainingHourly = Math.max(0, HOURLY_CAP - hourlyRuns.length);
  const remainingToday = Math.max(0, DAILY_CAP - todayRuns.length);

  // Countdown sampai slot jam tertua expire (sliding window)
  const oldestHourly = hourlyRuns.length > 0 ? Math.min(...hourlyRuns.map(r => r.id)) : null;
  const nextSlotMs = hourlyCapped && oldestHourly ? Math.max(0, oldestHourly + HOUR_MS - now) : 0;
  const nextSlotSec = Math.ceil(nextSlotMs / 1000);
  const fmtSlot = s => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  useEffect(() => {
    try { localStorage.setItem("sv_runs", JSON.stringify(runs)); } catch {}
  }, [runs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    logDebug(`alarm loop useEffect triggered. alarmRinging=${alarmRinging}, soundEnabled=${soundEnabled}`);
    if (alarmRinging && soundEnabled) {
      logDebug("Starting alarm loop...");
      playAlarm(); // langsung bunyikan pertama kali
      alarmLoopRef.current = setInterval(() => {
        logDebug("alarm loop interval tick");
        playAlarm();
      }, 2000);
    } else {
      logDebug("Clearing alarm loop...");
      clearInterval(alarmLoopRef.current);
    }
    return () => {
      logDebug("alarm loop cleanup running");
      clearInterval(alarmLoopRef.current);
    };
  }, [alarmRinging, soundEnabled, playAlarm, logDebug]);

  useEffect(() => {
    if (timerComplete) {
      logDebug("timerComplete became true, setting alarmRinging to true");
      setAlarmRinging(true);
    }
  }, [timerComplete, logDebug]);

  // Auto-reset runs when date changes (midnight) and purge expired runs
  useEffect(() => {
    const todayStr = new Date().toDateString();
    const nowTs = Date.now();
    // Keep only runs from today OR runs within the last 1 hour (sliding window)
    const validRuns = runs.filter(r => r.date === todayStr || nowTs - r.id < HOUR_MS);
    if (validRuns.length !== runs.length) {
      logDebug(`Auto-resetting: Purged ${runs.length - validRuns.length} expired run(s) from previous days.`);
      setRuns(validRuns);
    }
  }, [tick, runs, logDebug]);

  const addRun = () => {
    ensureAudioCtx();
    if (capReached) return;
    const ts = Date.now();
    const run = { id: ts, date: new Date().toDateString(), time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) };
    setRuns(prev => [...prev, run]);
  };

  const removeLastRun = () => {
    ensureAudioCtx();
    const todayIds = todayRuns.map(r => r.id);
    if (todayIds.length === 0) return;
    setRuns(prev => prev.filter(r => r.id !== todayIds[todayIds.length - 1]));
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

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: `Kamu adalah companion AI untuk World of Warcraft: The Burning Crusade (TBC Classic). Bantu pemain dengan segala topik seputar TBC — class & spec, talent build, rotasi, gear & BIS list, enchant & gem, dungeon & raid (Karazhan, Gruul, Magtheridon, SSC, TK, MH, BT, Sunwell), PvP & Arena, profesi, reputasi, gold farming, dan tips umum lainnya. Jawab dalam bahasa Indonesia yang santai, jelas, dan informatif. Jika ada data tracker: run jam ini ${hourlyRuns.length}/${HOURLY_CAP}, run hari ini ${todayRuns.length}/${DAILY_CAP} (dungeon Steam Vault). Instance limit TBC: 5/jam, 30/hari.`,
          messages: history,
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "Maaf, ada error. Coba lagi ya!";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Koneksi bermasalah. Coba lagi!" }]);
    }
    setLoading(false);
  }, [input, loading, messages, todayRuns.length, totalRuns]);

  const handleKey = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const hourlyBars = Array.from({ length: HOURLY_CAP }, (_, i) => i < hourlyRuns.length);
  const dailyBars = Array.from({ length: DAILY_CAP }, (_, i) => i < todayRuns.length);

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", color: "#E2E8F0", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #1C2333; } ::-webkit-scrollbar-thumb { background: #2EA8FF44; border-radius: 4px; }
        .btn { cursor: pointer; border: none; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 500; transition: all 0.15s; }
        .btn:active { transform: scale(0.97); }
        .btn-primary { background: #2EA8FF; color: #0D1117; padding: 10px 20px; }
        .btn-primary:hover { background: #5BBDFF; }
        .btn-primary:disabled { background: #2EA8FF44; color: #8B9BB4; cursor: not-allowed; transform: none; }
        .btn-ghost { background: transparent; color: #8B9BB4; border: 1px solid #2A3547; padding: 8px 16px; }
        .btn-ghost:hover { background: #1C2333; color: #E2E8F0; }
        .btn-danger { background: #FF6B3522; color: #FF6B35; border: 1px solid #FF6B3544; padding: 8px 16px; }
        .btn-danger:hover { background: #FF6B3533; }
        .btn-success { background: #4FFFB022; color: #4FFFB0; border: 1px solid #4FFFB044; padding: 10px 24px; }
        .btn-success:hover { background: #4FFFB033; }
        .tab { cursor: pointer; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; border: none; background: transparent; color: #8B9BB4; transition: all 0.15s; }
        .tab.active { background: #1C2333; color: #2EA8FF; }
        .tab:hover:not(.active) { color: #E2E8F0; }
        textarea { resize: none; outline: none; font-family: inherit; }
        .pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        .steam { animation: steam 3s ease-in-out infinite; }
        @keyframes steam { 0%,100%{transform:translateY(0) scaleX(1)} 50%{transform:translateY(-4px) scaleX(1.05)} }
        .tip-fade { animation: tipfade 0.5s ease; }
        @keyframes tipfade { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Header */}
      <div style={{ background: "#111827", borderBottom: "1px solid #1E3A5F", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" stroke="#2EA8FF" strokeWidth="1.5" />
          <path d="M8 14 C8 10 11 7 14 7 C17 7 20 10 20 14" stroke="#2EA8FF" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="14" cy="17" r="3" fill="#2EA8FF44" stroke="#2EA8FF" strokeWidth="1.5" />
          <path d="M7 20 Q10 16 14 20 Q18 24 21 20" stroke="#4FFFB0" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        </svg>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#E2E8F0", letterSpacing: "0.02em" }}>Steam Vault Companion</div>
          <div style={{ fontSize: 11, color: "#8B9BB4" }}>Coilfang Reservoir · Solo Farming Tracker</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button className={`tab ${activeTab === "tracker" ? "active" : ""}`} onClick={() => setActiveTab("tracker")}>⚔ Tracker</button>
          <button className={`tab ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
            💬 Chat AI {loading && <span className="pulse" style={{ marginLeft: 4 }}>●</span>}
          </button>
        </div>
      </div>

      {/* Tip bar */}
      <div style={{ background: "#0F1929", borderBottom: "1px solid #1E3A5F33", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#2EA8FF", fontWeight: 600, whiteSpace: "nowrap" }}>💡 TIP</span>
        <span key={tipIndex} className="tip-fade" style={{ fontSize: 12, color: "#8B9BB4" }}>{STEAM_TIPS[tipIndex]}</span>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* TRACKER TAB */}
        {activeTab === "tracker" && (
          <div style={{ flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "Run Jam Ini", value: hourlyRuns.length, sub: `dari ${HOURLY_CAP} / jam`, color: hourlyCapped ? "#FF6B35" : "#2EA8FF" },
                { label: "Sisa Jam Ini", value: remainingHourly, sub: hourlyCapped ? fmtSlot(nextSlotSec) + " buka" : "slot tersisa", color: hourlyCapped ? "#FF6B35" : "#4FFFB0" },
                { label: "Run Hari Ini", value: todayRuns.length, sub: `dari ${DAILY_CAP} / hari`, color: dailyCapped ? "#FF6B35" : "#8B9BB4" },
                { label: "Total Lifetime", value: totalRuns, sub: "semua run", color: "#8B9BB4" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#111827", border: "1px solid #1E3A5F", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#8B9BB4", marginBottom: 4, fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 600, color: s.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#8B9BB455", marginTop: 4 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Cap progress bars */}
            <div style={{ background: "#111827", border: "1px solid #1E3A5F", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Hourly */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#8B9BB4", fontWeight: 500 }}>INSTANCE / JAM</span>
                  <span style={{ fontSize: 11, color: hourlyCapped ? "#FF6B35" : "#2EA8FF", fontFamily: "'JetBrains Mono'" }}>{hourlyRuns.length}/{HOURLY_CAP}</span>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {hourlyBars.map((filled, i) => (
                    <div key={i} style={{ flex: 1, height: 22, borderRadius: 4, background: filled ? "#2EA8FF" : "#1C2333", transition: "background 0.3s", boxShadow: filled ? "0 0 6px #2EA8FF55" : "none" }} />
                  ))}
                </div>
                {hourlyCapped && (
                  <div style={{ fontSize: 11, color: "#FF6B35", marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="pulse">⏳</span>
                    Slot berikutnya terbuka dalam <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 600, marginLeft: 4 }}>{fmtSlot(nextSlotSec)}</span>
                  </div>
                )}
              </div>
              {/* Daily */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#8B9BB4", fontWeight: 500 }}>INSTANCE / HARI</span>
                  <span style={{ fontSize: 11, color: dailyCapped ? "#FF6B35" : "#8B9BB4", fontFamily: "'JetBrains Mono'" }}>{todayRuns.length}/{DAILY_CAP}</span>
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {dailyBars.map((filled, i) => (
                    <div key={i} style={{ width: "calc(10% - 3px)", height: 14, borderRadius: 3, background: filled ? (i >= 25 ? "#FF6B35" : "#4FFFB066") : "#1C2333", transition: "background 0.3s" }} />
                  ))}
                </div>
                {dailyCapped && <div style={{ fontSize: 11, color: "#FF6B35", marginTop: 7, textAlign: "center" }}>⚠ Cap harian 30 tercapai! Reset besok pagi.</div>}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-success" style={{ flex: 1, fontSize: 15 }} onClick={addRun} disabled={capReached}>
                {hourlyCapped && !dailyCapped
                  ? `⏳ Tunggu ${fmtSlot(nextSlotSec)}`
                  : dailyCapped
                  ? "🚫 Cap Harian Penuh"
                  : "+ Catat Run Selesai"}
              </button>
              <button className="btn btn-ghost" onClick={removeLastRun} disabled={todayRuns.length === 0} style={{ fontSize: 13 }}>Undo</button>
            </div>

            {/* Reset Timer */}
            <div style={{ background: "#111827", border: `1px solid ${timerActive ? "#2EA8FF44" : timerComplete ? "#4FFFB044" : "#1E3A5F"}`, borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#8B9BB4", fontWeight: 500 }}>DUNGEON RESET TIMER</div>
                  <div style={{ fontSize: 11, color: "#8B9BB455", marginTop: 2 }}>Log out 5 menit untuk reset instance</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => { setSoundEnabled(v => !v); if (alarmRinging) setAlarmRinging(false); }}
                    title={soundEnabled ? "Matikan alarm" : "Nyalakan alarm"}
                    style={{ background: soundEnabled ? "#2EA8FF22" : "#8B9BB422", border: `1px solid ${soundEnabled ? "#2EA8FF55" : "#8B9BB455"}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 16, lineHeight: 1, color: soundEnabled ? "#2EA8FF" : "#8B9BB4", transition: "all 0.15s" }}
                    aria-label={soundEnabled ? "Mute alarm" : "Unmute alarm"}
                  >
                    {soundEnabled ? "🔔" : "🔕"}
                  </button>
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 36, fontWeight: 600, color: timerComplete ? "#4FFFB0" : timerActive ? "#2EA8FF" : "#E2E8F0" }}>
                    {fmt(timerSeconds)}
                  </div>
                </div>
              </div>

              {/* Timer progress bar */}
              <div style={{ background: "#1C2333", borderRadius: 4, height: 6, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: timerComplete ? "#4FFFB0" : "#2EA8FF", width: `${timerPct}%`, transition: "width 1s linear" }} />
              </div>

              {timerComplete && (
                <div style={{ background: "#4FFFB011", border: "1px solid #4FFFB033", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: "#4FFFB0", textAlign: "center" }}>
                  ✅ Reset selesai! Log in sekarang dan masuk dungeon.
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                {alarmRinging && (
                  <button
                    className="btn"
                    onClick={stopAlarm}
                    style={{ flex: 1, background: "#FF6B3522", color: "#FF6B35", border: "1px solid #FF6B3544", fontSize: 14, fontWeight: 600, animation: "pulse 0.8s ease-in-out infinite" }}
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
                    <div style={{ flex: 2, background: "#1C2333", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8B9BB4" }}>
                      <span className="pulse">●</span>&nbsp;Menunggu reset...
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Today's run log */}
            {todayRuns.length > 0 && (
              <div style={{ background: "#111827", border: "1px solid #1E3A5F", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 12, color: "#8B9BB4", fontWeight: 500, marginBottom: 10 }}>LOG HARI INI</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {todayRuns.map((r, i) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 20, height: 20, background: "#2EA8FF22", border: "1px solid #2EA8FF44", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#2EA8FF", fontFamily: "'JetBrains Mono'" }}>{i + 1}</div>
                      <div style={{ fontSize: 13, color: "#E2E8F0" }}>Run #{i + 1}</div>
                      <div style={{ marginLeft: "auto", fontSize: 11, color: "#8B9BB4", fontFamily: "'JetBrains Mono'" }}>{r.time}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Context bar */}
            <div style={{ background: "#111827", borderBottom: "1px solid #1E3A5F33", padding: "8px 16px", display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
              <span style={{ color: "#8B9BB4" }}>Jam ini: <span style={{ color: hourlyCapped ? "#FF6B35" : "#2EA8FF", fontFamily: "monospace" }}>{hourlyRuns.length}/{HOURLY_CAP}</span></span>
              <span style={{ color: "#8B9BB4" }}>Hari ini: <span style={{ color: dailyCapped ? "#FF6B35" : "#4FFFB0", fontFamily: "monospace" }}>{todayRuns.length}/{DAILY_CAP}</span></span>
              <span style={{ color: "#8B9BB4" }}>Total: <span style={{ color: "#E2E8F0", fontFamily: "monospace" }}>{totalRuns}</span></span>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: m.role === "user" ? "#2EA8FF" : "#1C2333",
                    color: m.role === "user" ? "#0D1117" : "#E2E8F0",
                    fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap"
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ background: "#1C2333", borderRadius: "12px 12px 12px 2px", padding: "10px 16px", display: "flex", gap: 4, alignItems: "center" }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, background: "#2EA8FF", borderRadius: "50%", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick prompts */}
            <div style={{ padding: "0 16px 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["BIS gear untuk kelasku", "Tips farming gold TBC", "Raid mana yang cocok?", "Talent build terbaik", "Tips Arena & PvP", "Reputasi penting TBC"].map(q => (
                <button key={q} className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => { setInput(q); }}>
                  {q}
                </button>
              ))}
            </div>

            {/* Input */}
            <div style={{ padding: "0 16px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder="Tanya seputar Steam Vault... (Enter untuk kirim)"
                rows={2}
                style={{ flex: 1, background: "#1C2333", border: "1px solid #2A3547", borderRadius: 8, padding: "10px 12px", color: "#E2E8F0", fontSize: 14, lineHeight: 1.5 }}
              />
              <button className="btn btn-primary" onClick={sendMessage} disabled={loading || !input.trim()} style={{ padding: "10px 16px", height: 42 }}>
                {loading ? "⏳" : "↑"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Debug Logs */}
      {debugLogs.length > 0 && (
        <div style={{ background: "#060A12", borderTop: "1px solid #FF6B3533", padding: "10px 20px", maxHeight: 150, overflowY: "auto", fontFamily: "monospace", fontSize: 11, color: "#8B9BB4" }}>
          <div style={{ color: "#FF6B35", fontWeight: "bold", marginBottom: 5 }}>🛠 DEBUG LOGS:</div>
          {debugLogs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      )}

      {/* Footer */}
      <div style={{ background: "#0A0F1A", borderTop: "1px solid #1E3A5F33", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "#8B9BB444", letterSpacing: "0.05em" }}>
          © {new Date().getFullYear()} <span style={{ color: "#2EA8FF66", fontWeight: 600 }}>ChromeT</span> · WoW TBC Companion
        </span>
      </div>

    </div>
  );
}
