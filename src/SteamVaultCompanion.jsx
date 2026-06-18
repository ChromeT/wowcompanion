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
  const chatEndRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const alarmLoopRef = useRef(null);

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

  // Auto-reset runs when date changes (midnight) and purge expired runs
  useEffect(() => {
    const todayStr = new Date().toDateString();
    const nowTs = Date.now();
    // Keep only runs from today OR runs within the last 1 hour (sliding window)
    const validRuns = runs.filter(r => r.date === todayStr || nowTs - r.id < HOUR_MS);
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
    <div style={{ minHeight: "100vh", background: "#050e14", color: "#e2eff2", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0d2733; } ::-webkit-scrollbar-thumb { background: #00ffd244; border-radius: 4px; }
        .btn { cursor: pointer; border: none; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 500; transition: all 0.15s; }
        .btn:active { transform: scale(0.97); }
        .btn-primary { background: #00ffd2; color: #050e14; padding: 10px 20px; }
        .btn-primary:hover { background: #5BBDFF; }
        .btn-primary:disabled { background: #00ffd244; color: #6b93a3; cursor: not-allowed; transform: none; }
        .btn-ghost { background: transparent; color: #6b93a3; border: 1px solid #2A3547; padding: 8px 16px; }
        .btn-ghost:hover { background: #0d2733; color: #e2eff2; }
        .btn-danger { background: #ff840022; color: #ff8400; border: 1px solid #ff840044; padding: 8px 16px; }
        .btn-danger:hover { background: #ff840033; }
        .btn-success { background: #3dffa322; color: #3dffa3; border: 1px solid #3dffa344; padding: 10px 24px; }
        .btn-success:hover { background: #3dffa333; }
        .tab { cursor: pointer; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; border: none; background: transparent; color: #6b93a3; transition: all 0.15s; }
        .tab.active { background: #0d2733; color: #00ffd2; }
        .tab:hover:not(.active) { color: #e2eff2; }
        textarea { resize: none; outline: none; font-family: inherit; }
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
          <div style={{ display: "flex", gap: 4 }}>
            <button className={`tab ${activeTab === "tracker" ? "active" : ""}`} onClick={() => setActiveTab("tracker")}>⚔ Tracker</button>
            <button className={`tab ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
              💬 Chat AI {loading && <span className="pulse" style={{ marginLeft: 4 }}>●</span>}
            </button>
          </div>
        </div>

      </div>

      {/* Tip bar */}
      <div style={{ background: "#081d29", borderBottom: "1px solid #183e5233", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#00ffd2", fontWeight: 600, whiteSpace: "nowrap" }}>💡 TIP</span>
        <span key={tipIndex} className="tip-fade" style={{ fontSize: 12, color: "#6b93a3" }}>{STEAM_TIPS[tipIndex]}</span>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* TRACKER TAB */}
        {activeTab === "tracker" && (
          <div style={{ flex: 1, padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "Run Jam Ini", value: hourlyRuns.length, sub: `dari ${HOURLY_CAP} / jam`, color: hourlyCapped ? "#ff8400" : "#00ffd2" },
                { label: "Sisa Jam Ini", value: remainingHourly, sub: hourlyCapped ? fmtSlot(nextSlotSec) + " buka" : "slot tersisa", color: hourlyCapped ? "#ff8400" : "#3dffa3" },
                { label: "Run Hari Ini", value: todayRuns.length, sub: `dari ${DAILY_CAP} / hari`, color: dailyCapped ? "#ff8400" : "#6b93a3" },
                { label: "Total Lifetime", value: totalRuns, sub: "semua run", color: "#6b93a3" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#6b93a3", marginBottom: 4, fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 600, color: s.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#6b93a355", marginTop: 4 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Cap progress bars */}
            <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Hourly */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#6b93a3", fontWeight: 500 }}>INSTANCE / JAM</span>
                  <span style={{ fontSize: 11, color: hourlyCapped ? "#ff8400" : "#00ffd2", fontFamily: "'JetBrains Mono'" }}>{hourlyRuns.length}/{HOURLY_CAP}</span>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {hourlyBars.map((filled, i) => (
                    <div key={i} style={{ flex: 1, height: 22, borderRadius: 4, background: filled ? "#00ffd2" : "#0d2733", transition: "background 0.3s", boxShadow: filled ? "0 0 6px #00ffd255" : "none" }} />
                  ))}
                </div>
                {hourlyCapped && (
                  <div style={{ fontSize: 11, color: "#ff8400", marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="pulse">⏳</span>
                    Slot berikutnya terbuka dalam <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 600, marginLeft: 4 }}>{fmtSlot(nextSlotSec)}</span>
                  </div>
                )}
              </div>
              {/* Daily */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#6b93a3", fontWeight: 500 }}>INSTANCE / HARI</span>
                  <span style={{ fontSize: 11, color: dailyCapped ? "#ff8400" : "#6b93a3", fontFamily: "'JetBrains Mono'" }}>{todayRuns.length}/{DAILY_CAP}</span>
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {dailyBars.map((filled, i) => (
                    <div key={i} style={{ width: "calc(10% - 3px)", height: 14, borderRadius: 3, background: filled ? (i >= 25 ? "#ff8400" : "#3dffa366") : "#0d2733", transition: "background 0.3s" }} />
                  ))}
                </div>
                {dailyCapped && <div style={{ fontSize: 11, color: "#ff8400", marginTop: 7, textAlign: "center" }}>⚠ Cap harian 30 tercapai! Reset besok pagi.</div>}
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
                  <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 36, fontWeight: 600, color: timerComplete ? "#3dffa3" : timerActive ? "#00ffd2" : "#e2eff2" }}>
                    {fmt(timerSeconds)}
                  </div>
                </div>
              </div>

              {/* Timer progress bar */}
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

            {/* Today's run log */}
            {todayRuns.length > 0 && (
              <div style={{ background: "#0a1b24", border: "1px solid #183e52", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 12, color: "#6b93a3", fontWeight: 500, marginBottom: 10 }}>LOG HARI INI</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {todayRuns.map((r, i) => (
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
        )}

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Context bar */}
            <div style={{ background: "#0a1b24", borderBottom: "1px solid #183e5233", padding: "8px 16px", display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
              <span style={{ color: "#6b93a3" }}>Jam ini: <span style={{ color: hourlyCapped ? "#ff8400" : "#00ffd2", fontFamily: "monospace" }}>{hourlyRuns.length}/{HOURLY_CAP}</span></span>
              <span style={{ color: "#6b93a3" }}>Hari ini: <span style={{ color: dailyCapped ? "#ff8400" : "#3dffa3", fontFamily: "monospace" }}>{todayRuns.length}/{DAILY_CAP}</span></span>
              <span style={{ color: "#6b93a3" }}>Total: <span style={{ color: "#e2eff2", fontFamily: "monospace" }}>{totalRuns}</span></span>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: m.role === "user" ? "#00ffd2" : "#0d2733",
                    color: m.role === "user" ? "#050e14" : "#e2eff2",
                    fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap"
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ background: "#0d2733", borderRadius: "12px 12px 12px 2px", padding: "10px 16px", display: "flex", gap: 4, alignItems: "center" }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, background: "#00ffd2", borderRadius: "50%", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
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
                style={{ flex: 1, background: "#0d2733", border: "1px solid #2A3547", borderRadius: 8, padding: "10px 12px", color: "#e2eff2", fontSize: 14, lineHeight: 1.5 }}
              />
              <button className="btn btn-primary" onClick={sendMessage} disabled={loading || !input.trim()} style={{ padding: "10px 16px", height: 42 }}>
                {loading ? "⏳" : "↑"}
              </button>
            </div>
          </div>
        )}
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
