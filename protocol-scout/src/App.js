import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `You are a senior research scientist and protocol quality reviewer with 15 years of experience in immunoassay development and laboratory best practices. You are reviewing a protocol for a small biotech team preparing for IND-enabling studies.

Your job is to analyze the protocol step-by-step and identify risks that could cause experimental failure, data invalidation, or irreproducibility. For each issue you find, you must:
1. Quote the exact step text that contains the problem
2. Classify it as: AMBIGUITY, MISSING_CONTROL, or REPRODUCIBILITY_RISK
3. Assign severity: HIGH, MEDIUM, or LOW
4. Explain why it is a problem in 1-2 sentences
5. Provide a specific corrected rewrite
6. Cite a real guideline or publication that supports your flag

Return ONLY a valid JSON object with two fields:
- "protocol_text": the full extracted plain text of the protocol, preserving line breaks
- "flags": an array of flag objects

Flag schema:
{
  "step_number": <number or null>,
  "quoted_text": "<exact words from the protocol>",
  "flag_type": "AMBIGUITY" | "MISSING_CONTROL" | "REPRODUCIBILITY_RISK",
  "severity": "HIGH" | "MEDIUM" | "LOW",
  "explanation": "<1-2 sentences>",
  "suggested_rewrite": "<complete corrected text>",
  "citation": "<real guideline or paper>"
}

No preamble, no markdown fences, just the raw JSON object.`;

const FLAG_CONFIG = {
  AMBIGUITY: { label: "Ambiguity", color: "#c8891a", bg: "#fef3dc", border: "#f5c842" },
  MISSING_CONTROL: { label: "Missing Control", color: "#b94040", bg: "#fdeaea", border: "#e88080" },
  REPRODUCIBILITY_RISK: { label: "Reproducibility Risk", color: "#2c6e9e", bg: "#e8f2fb", border: "#7ab8e8" },
};

const SEVERITY_CONFIG = {
  HIGH: { label: "HIGH", color: "#b94040", bg: "#fdeaea" },
  MEDIUM: { label: "MED", color: "#c8891a", bg: "#fef3dc" },
  LOW: { label: "LOW", color: "#2c6e9e", bg: "#e8f2fb" },
};

export default function App() {
  const [stage, setStage] = useState("upload");
  const [flags, setFlags] = useState([]);
  const [thinkingLines, setThinkingLines] = useState([]);
  const [activeFlag, setActiveFlag] = useState(null);
  const [dismissed, setDismissed] = useState(new Set());
  const [accepted, setAccepted] = useState(new Set());
  const [error, setError] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [protocolText, setProtocolText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const thinkingRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingLines]);

  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const handleFile = async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { setError("Please upload a PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("File too large. Please use a PDF under 10MB."); return; }
    setError(null);
    setPdfFile(file);
    const b64 = await readFileAsBase64(file);
    setPdfBase64(b64);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFile(e.dataTransfer.files[0]);
  };

  const analyze = async () => {
    if (!pdfBase64) return;
    setStage("analyzing");
    setThinkingLines([]);
    setFlags([]);
    setProtocolText("");
    setError(null);

    const steps = [
      "Reading PDF document structure...",
      "Extracting protocol steps...",
      "Checking temperature specifications...",
      "Evaluating control architecture...",
      "Cross-referencing NIH rigor guidelines...",
      "Scanning for ambiguous timing language...",
      "Checking for reproducibility risk patterns...",
      "Reviewing CLSI EP guideline compliance...",
      "Assessing reagent concentration specificity...",
      "Evaluating wash and incubation steps...",
      "Compiling risk flag report...",
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) setThinkingLines((p) => [...p, steps[i++]]);
      else clearInterval(interval);
    }, 180);

    try {
      const apiKey = process.env.REACT_APP_ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Missing REACT_APP_ANTHROPIC_API_KEY in .env");

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
              { type: "text", text: "Analyze this protocol and return the JSON object with protocol_text and flags fields." },
            ],
          }],
        }),
      });

      clearInterval(interval);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || "API request failed"); }

      const data = await res.json();
      const firstContent = data.content && data.content[0];
      const raw = (firstContent?.text || "").replace(/```json|```/g, "").trim();
      if (!raw) throw new Error("No analysis result from API. The model may have returned empty or non-JSON content.");
      const parsed = JSON.parse(raw);

      const flagsArr = Array.isArray(parsed) ? parsed : (parsed.flags || []);
      const text = (parsed && parsed.protocol_text) ? String(parsed.protocol_text) : "";

      setThinkingLines((p) => [...p, `✓ Analysis complete — ${flagsArr.length} issues found.`]);
      await new Promise((r) => setTimeout(r, 350));
      setFlags(flagsArr);
      setProtocolText(text);
      setStage("results");
    } catch (err) {
      clearInterval(interval);
      console.error(err);
      let message = err.message || "Something went wrong.";
      if (message.toLowerCase().includes("invalid x-api-key") || message.toLowerCase().includes("invalid api key")) {
        message = "Invalid API key. Check protocol-scout/.env: set REACT_APP_ANTHROPIC_API_KEY to your key from console.anthropic.com, then restart the app (stop and run npm start again).";
      } else if (message.includes("JSON Parse error") || message.includes("Unterminated string") || message.includes("Unexpected end of JSON")) {
        message = "The analysis response was cut off or invalid (often due to a long protocol). Try again with a shorter protocol, or the same file—sometimes it works on retry.";
      }
      setError(message);
      setStage("upload");
    }
  };

  const toggleDismiss = (i) => {
    setDismissed((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
    setAccepted((p) => { const n = new Set(p); n.delete(i); return n; });
  };
  const toggleAccept = (i) => {
    setAccepted((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
    setDismissed((p) => { const n = new Set(p); n.delete(i); return n; });
  };

  const resetApp = () => {
    setStage("upload"); setFlags([]); setDismissed(new Set()); setAccepted(new Set());
    setActiveFlag(null); setPdfFile(null); setPdfBase64(null); setProtocolText(""); setError(null);
  };

  const protocolLines = protocolText ? protocolText.split("\n") : [];
  // For each flag, find the last protocol line that overlaps with its quoted text, so we show the flag after the full step.
  const lastLineForFlag = (() => {
    const out = {};
    flags.forEach((f, fi) => {
      if (!f.quoted_text) return;
      const q = f.quoted_text;
      const head = q.slice(0, 20);
      const tail = q.length > 20 ? q.slice(-20) : q;
      let last = -1;
      protocolLines.forEach((line, i) => {
        const s = line != null ? String(line) : "";
        if (s.includes(head) || s.includes(tail) || (q.length <= 40 && s.includes(q))) last = i;
      });
      out[fi] = last;
    });
    return out;
  })();
  const getFlagsToShowAfterLine = (lineIndex) =>
    flags.filter((_, fi) => lastLineForFlag[fi] === lineIndex);
  // Order risk flags by position in the procedure (earlier steps first).
  const sortedFlagIndices = flags
    .map((_, fi) => fi)
    .sort((a, b) => (lastLineForFlag[a] ?? 999999) - (lastLineForFlag[b] ?? 999999));

  const highCount = flags.filter((f, i) => f.severity === "HIGH" && !dismissed.has(i)).length;
  const medCount  = flags.filter((f, i) => f.severity === "MEDIUM" && !dismissed.has(i)).length;
  const lowCount  = flags.filter((f, i) => f.severity === "LOW" && !dismissed.has(i)).length;

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#f4f3ef}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#ccc;border-radius:2px}
        .flag-row:hover{background:#f9f8f5!important}
        .proto-line:hover{background:#f0efe9!important}
        .chip:hover{opacity:.8;cursor:pointer}
        .drop-zone:hover{border-color:#888!important;background:#f9f8f5!important}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        .tline{animation:fadeUp .3s ease forwards}
        .sdot{animation:blink 1.2s ease infinite}
      `}</style>

      <header style={S.header}>
        <div style={S.hInner}>
          <div style={S.logo}>
            <span style={S.logoMark}>◈</span>
            <span style={S.logoText}>ProtocolScout</span>
            <span style={S.logoBadge}>BETA</span>
          </div>
          <span style={S.metaTag}>Life Sciences · AI Protocol Analysis</span>
        </div>
      </header>

      {stage === "upload" && (
        <div style={S.center}>
          <div style={S.card}>
            <div style={S.cardIcon}>◈</div>
            <h1 style={S.cardTitle}>Protocol Risk Analysis</h1>
            <p style={S.cardSub}>Upload any lab protocol as a PDF. The agent identifies ambiguities, missing controls, and reproducibility risks before your team runs the experiment.</p>

            <div
              className="drop-zone"
              style={{ ...S.dropZone, borderColor: isDragging ? "#888" : pdfFile ? "#2d7d46" : "#ddd", background: isDragging ? "#f9f8f5" : pdfFile ? "#f4f9f5" : "white" }}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => !pdfFile && fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
              {pdfFile ? (
                <div style={S.fileRow}>
                  <span style={{ fontSize: 26, color: "#2d7d46" }}>⬡</span>
                  <div style={{ flex: 1 }}>
                    <div style={S.fileName}>{pdfFile.name}</div>
                    <div style={S.fileSize}>{(pdfFile.size / 1024).toFixed(1)} KB · Ready to analyze</div>
                  </div>
                  <button style={S.removeBtn} onClick={(e) => { e.stopPropagation(); setPdfFile(null); setPdfBase64(null); }}>✕</button>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, color: "#ccc", marginBottom: 8 }}>↑</div>
                  <div style={{ fontSize: 15, color: "#666", fontWeight: 500, marginBottom: 4 }}>Drop your protocol PDF here</div>
                  <div style={{ fontSize: 12, color: "#bbb" }}>or click to browse · max 10MB</div>
                </div>
              )}
            </div>

            {error && <div style={S.errorBox}><strong>Error:</strong> {error}</div>}

            <button style={{ ...S.analyzeBtn, opacity: pdfFile ? 1 : 0.4, cursor: pdfFile ? "pointer" : "not-allowed" }} onClick={pdfFile ? analyze : undefined}>
              Run Protocol Analysis <span style={{ fontSize: 18 }}>→</span>
            </button>

            <div style={S.footer}>
              <span style={S.footerItem}>◆ Ambiguity detection</span>
              <span style={S.footerItem}>◆ Control gap analysis</span>
              <span style={S.footerItem}>◆ Reproducibility flags</span>
            </div>
          </div>
        </div>
      )}

      {stage === "analyzing" && (
        <div style={S.center}>
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span className="sdot" style={{ width: 10, height: 10, borderRadius: "50%", background: "#f5c842", display: "inline-block" }} />
              <span style={{ fontSize: 17, fontWeight: 600 }}>Agent Analysis Running</span>
            </div>
            <div style={{ fontSize: 12, color: "#aaa", fontFamily: "IBM Plex Mono, monospace", marginBottom: 24 }}>{pdfFile?.name}</div>
            <div ref={thinkingRef} style={S.thinkLog}>
              {thinkingLines.map((line, i) => (
                <div key={i} className="tline" style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.7 }}>
                  <span style={{ color: "#aaa" }}>{(line || "").startsWith("✓") ? "✓" : "›"}</span>
                  <span style={{ color: (line || "").startsWith("✓") ? "#2d7d46" : "#444" }}>{(line || "").replace(/^✓ /, "")}</span>
                </div>
              ))}
              {thinkingLines.length > 0 && !(thinkingLines[thinkingLines.length - 1] || "").startsWith("✓") && (
                <div style={{ color: "#f5c842", fontSize: 14 }}>▋</div>
              )}
            </div>
            <div style={{ marginTop: 20, fontSize: 11, color: "#bbb", textAlign: "center" }}>Reasoning against NIH Rigor Guidelines · CLSI EP · Nature Methods</div>
          </div>
        </div>
      )}

      {stage === "results" && (
        <div style={S.results}>
          <div style={S.summaryBar}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "IBM Plex Mono, monospace", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdfFile?.name}</span>
              <span style={{ color: "#ccc" }}>·</span>
              <span style={{ fontSize: 13, color: "#888" }}>Analysis Complete</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {highCount > 0 && <span style={{ ...S.pill, background: "#fdeaea", color: "#b94040" }}>{highCount} HIGH</span>}
              {medCount  > 0 && <span style={{ ...S.pill, background: "#fef3dc", color: "#c8891a" }}>{medCount} MED</span>}
              {lowCount  > 0 && <span style={{ ...S.pill, background: "#e8f2fb", color: "#2c6e9e" }}>{lowCount} LOW</span>}
              <span style={{ fontSize: 12, color: "#aaa", marginLeft: 4 }}>{flags.length} total</span>
              <button style={S.resetBtn} onClick={resetApp}>↺ New Analysis</button>
            </div>
          </div>

          <div style={S.panels}>
            <div style={S.leftPanel}>
              <div style={S.panelHdr}>
                <span style={S.panelLabel}>EXTRACTED PROTOCOL</span>
                <span style={{ fontSize: 11, color: "#bbb", fontFamily: "IBM Plex Mono, monospace", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdfFile?.name}</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {protocolLines.length > 0 ? protocolLines.map((line, i) => {
                  const safeLine = line != null ? String(line) : "";
                  const sf = getFlagsToShowAfterLine(i);
                  const isActive = sf.some((f) => flags.indexOf(f) === activeFlag);
                  return (
                    <div key={i} className="proto-line" style={{ padding: "3px 16px 3px 12px", transition: "background .15s", background: isActive ? "#fff8e6" : "transparent", borderLeft: isActive ? "3px solid #f5c842" : "3px solid transparent" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#ccc", flexShrink: 0, paddingTop: 2, minWidth: 22, textAlign: "right" }}>{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, lineHeight: 1.65, flex: 1, fontWeight: /^step\s/i.test(safeLine) || /^\d+\./.test(safeLine.trim()) ? 500 : 400, color: /^step\s/i.test(safeLine) || /^\d+\./.test(safeLine.trim()) ? "#1a1a1a" : "#555" }}>{safeLine || "\u00A0"}</span>
                      </div>
                      {sf.length > 0 && (
                        <div style={{ marginLeft: 34, marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                          {sf.map((f, fi) => {
                            const idx = flags.indexOf(f);
                            if (dismissed.has(idx)) return null;
                            const cfg = FLAG_CONFIG[f.flag_type] || FLAG_CONFIG.AMBIGUITY;
                            const sev = SEVERITY_CONFIG[f.severity] || SEVERITY_CONFIG.LOW;
                            return (
                              <div key={fi} className="chip" style={{ padding: "5px 10px", borderRadius: 5, display: "flex", alignItems: "center", gap: 8, background: cfg.bg, borderLeft: `3px solid ${cfg.border}`, outline: activeFlag === idx ? `2px solid ${cfg.border}` : "none" }} onClick={() => setActiveFlag(activeFlag === idx ? null : idx)}>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: ".06em", fontFamily: "IBM Plex Mono, monospace", background: sev.bg, color: sev.color }}>{sev.label}</span>
                                <span style={{ fontSize: 11, fontWeight: 500, color: cfg.color }}>{cfg.label}</span>
                                <span style={{ marginLeft: "auto", color: "#aaa", fontSize: 14 }}>›</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  <div style={{ padding: 20, fontSize: 13, color: "#aaa" }}>Protocol text could not be extracted. See flags panel →</div>
                )}
              </div>
            </div>

            <div style={S.rightPanel}>
              <div style={S.panelHdr}>
                <span style={S.panelLabel}>RISK FLAGS</span>
                <span style={{ fontSize: 11, color: "#bbb" }}>{flags.filter((_, i) => !dismissed.has(i)).length} active</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {sortedFlagIndices.map((idx) => {
                  const flag = flags[idx];
                  const cfg = FLAG_CONFIG[flag.flag_type] || FLAG_CONFIG.AMBIGUITY;
                  const sev = SEVERITY_CONFIG[flag.severity] || SEVERITY_CONFIG.LOW;
                  const isDism = dismissed.has(idx);
                  const isAcc  = accepted.has(idx);
                  const isAct  = activeFlag === idx;
                  return (
                    <div key={idx} className="flag-row" style={{ background: isAct ? "#fffbf0" : "white", borderRadius: 10, padding: "14px 16px", cursor: "pointer", transition: "background .15s", borderLeft: `4px solid ${isDism ? "#ddd" : cfg.border}`, opacity: isDism ? 0.4 : 1, outline: isAct ? `1px solid ${cfg.border}` : "none" }} onClick={() => setActiveFlag(isAct ? null : idx)}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, letterSpacing: ".06em", fontFamily: "IBM Plex Mono, monospace", background: sev.bg, color: sev.color }}>{sev.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: cfg.color }}>{cfg.label}</span>
                          {flag.step_number && <span style={{ fontSize: 11, color: "#bbb", fontFamily: "IBM Plex Mono, monospace" }}>Step {flag.step_number}</span>}
                        </div>
                        {isAcc && <span style={{ fontSize: 11, color: "#2d7d46", fontWeight: 600 }}>✓ Accepted</span>}
                      </div>
                      <p style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "#888", fontStyle: "italic", marginBottom: 6, lineHeight: 1.5 }}>"{flag.quoted_text}"</p>
                      <p style={{ fontSize: 13, color: "#444", lineHeight: 1.55 }}>{flag.explanation}</p>
                      {isAct && (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0efe9" }}>
                          <div style={{ background: "#f4f9f5", borderRadius: 7, padding: 12, marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: "#2d7d46", marginBottom: 6, fontFamily: "IBM Plex Mono, monospace" }}>SUGGESTED REWRITE</div>
                            <p style={{ fontSize: 12, color: "#333", lineHeight: 1.6, fontFamily: "IBM Plex Mono, monospace" }}>{flag.suggested_rewrite}</p>
                          </div>
                          <div style={{ marginBottom: 12 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#aaa" }}>Citation: </span>
                            <span style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>{flag.citation}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={{ flex: 1, padding: "8px 14px", borderRadius: 7, border: `1px solid ${isAcc ? "#b6dfc4" : "#e8e6e0"}`, background: isAcc ? "#e6f4ec" : "white", fontSize: 12, cursor: "pointer", fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 500, color: isAcc ? "#2d7d46" : "#444" }} onClick={(e) => { e.stopPropagation(); toggleAccept(idx); }}>{isAcc ? "✓ Accepted" : "Accept fix"}</button>
                            <button style={{ flex: 1, padding: "8px 14px", borderRadius: 7, border: `1px solid ${isDism ? "#e88080" : "#e8e6e0"}`, background: isDism ? "#fdeaea" : "white", fontSize: 12, cursor: "pointer", fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 500, color: isDism ? "#b94040" : "#444" }} onClick={(e) => { e.stopPropagation(); toggleDismiss(idx); }}>Dismiss</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  app: { fontFamily: "'IBM Plex Sans', sans-serif", minHeight: "100vh", background: "#f4f3ef", color: "#1a1a1a" },
  header: { background: "#1a1a1a", borderBottom: "1px solid #333", padding: "0 32px", height: 52, display: "flex", alignItems: "center" },
  hInner: { width: "100%", maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoMark: { color: "#f5c842", fontSize: 18 },
  logoText: { color: "#fff", fontSize: 15, fontWeight: 600, letterSpacing: ".02em", fontFamily: "IBM Plex Mono, monospace" },
  logoBadge: { background: "#333", color: "#888", fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 3, letterSpacing: ".08em" },
  metaTag: { color: "#666", fontSize: 12 },
  center: { display: "flex", justifyContent: "center", alignItems: "center", minHeight: "calc(100vh - 52px)", padding: 40 },
  card: { background: "white", borderRadius: 16, padding: 48, maxWidth: 560, width: "100%", boxShadow: "0 2px 24px rgba(0,0,0,.07)" },
  cardIcon: { fontSize: 32, marginBottom: 20, color: "#f5c842" },
  cardTitle: { fontSize: 28, fontWeight: 600, marginBottom: 12, letterSpacing: "-.02em" },
  cardSub: { fontSize: 15, color: "#666", lineHeight: 1.6, marginBottom: 32 },
  dropZone: { border: "2px dashed #ddd", borderRadius: 12, padding: 32, marginBottom: 24, cursor: "pointer", transition: "all .2s", minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" },
  fileRow: { display: "flex", alignItems: "center", gap: 14, width: "100%" },
  fileName: { fontSize: 14, fontWeight: 500, fontFamily: "IBM Plex Mono, monospace", wordBreak: "break-all" },
  fileSize: { fontSize: 12, color: "#2d7d46", marginTop: 2 },
  removeBtn: { background: "none", border: "none", color: "#aaa", fontSize: 16, cursor: "pointer", padding: "4px 6px", borderRadius: 4 },
  errorBox: { background: "#fdeaea", border: "1px solid #e88080", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#b94040" },
  analyzeBtn: { width: "100%", background: "#1a1a1a", color: "white", border: "none", borderRadius: 10, padding: "16px 24px", fontSize: 15, fontWeight: 500, display: "flex", justifyContent: "center", alignItems: "center", gap: 8, fontFamily: "IBM Plex Sans, sans-serif", transition: "opacity .2s" },
  footer: { display: "flex", justifyContent: "center", gap: 24, marginTop: 24 },
  footerItem: { fontSize: 12, color: "#aaa" },
  thinkLog: { background: "#f9f8f5", borderRadius: 10, padding: "16px 20px", minHeight: 200, maxHeight: 320, overflowY: "auto", fontFamily: "IBM Plex Mono, monospace" },
  results: { display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" },
  summaryBar: { background: "white", borderBottom: "1px solid #e8e6e0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
  pill: { fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4, letterSpacing: ".06em" },
  resetBtn: { marginLeft: 12, background: "#f4f3ef", border: "1px solid #ddd", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "#666", fontFamily: "IBM Plex Sans, sans-serif" },
  panels: { display: "flex", flex: 1, overflow: "hidden" },
  leftPanel: { width: "45%", borderRight: "1px solid #e8e6e0", display: "flex", flexDirection: "column", background: "white" },
  rightPanel: { flex: 1, display: "flex", flexDirection: "column", background: "#fafaf8" },
  panelHdr: { padding: "12px 20px", borderBottom: "1px solid #f0efe9", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafaf8", flexShrink: 0 },
  panelLabel: { fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#aaa", fontFamily: "IBM Plex Mono, monospace" },
};
