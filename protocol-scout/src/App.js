// Core React hooks and jsPDF for client‑side PDF generation.
import { useState, useRef, useEffect } from "react";
import { jsPDF } from "jspdf";

// System prompt that defines the "agent" persona and the JSON contract
// for protocol analysis. This is sent as the `system` message to Anthropic.
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

// Visual configuration for how each flag type is rendered in the UI.
const FLAG_CONFIG = {
  AMBIGUITY: { label: "Ambiguity", color: "#c8891a", bg: "#fef3dc", border: "#f5c842" },
  MISSING_CONTROL: { label: "Missing Control", color: "#b94040", bg: "#fdeaea", border: "#e88080" },
  REPRODUCIBILITY_RISK: { label: "Reproducibility Risk", color: "#2c6e9e", bg: "#e8f2fb", border: "#7ab8e8" },
};

// Visual configuration for severity badges (HIGH / MEDIUM / LOW).
const SEVERITY_CONFIG = {
  HIGH: { label: "HIGH", color: "#b94040", bg: "#fdeaea" },
  MEDIUM: { label: "MED", color: "#c8891a", bg: "#fef3dc" },
  LOW: { label: "LOW", color: "#2c6e9e", bg: "#e8f2fb" },
};

// Main ProtocolScout application component. Coordinates file upload,
// agent call, triage UI, live protocol updates, and PDF export.
export default function App() {
  // High‑level UI stage: upload → analyzing → results.
  const [stage, setStage] = useState("upload");
  // Flags and analysis state returned by the agent.
  const [flags, setFlags] = useState([]);
  const [thinkingLines, setThinkingLines] = useState([]);
  const [activeFlag, setActiveFlag] = useState(null);
  // User triage state for each flag.
  const [dismissed, setDismissed] = useState(new Set());
  const [accepted, setAccepted] = useState(new Set());
  // File / protocol state and transient UI error.
  const [error, setError] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [protocolText, setProtocolText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const thinkingRef = useRef(null);
  const fileInputRef = useRef(null);

  // Keep the "thinking" log scrolled to the bottom while the agent runs.
  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingLines]);

  // Read a File object as base64 (without the data: prefix) so it can be
  // sent to Anthropic as a `document` input.
  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  // Validate and ingest a user‑selected PDF file.
  const handleFile = async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { setError("Please upload a PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("File too large. Please use a PDF under 10MB."); return; }
    setError(null);
    setPdfFile(file);
    const b64 = await readFileAsBase64(file);
    setPdfBase64(b64);
  };

  // Drag‑and‑drop wrapper that feeds into handleFile.
  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFile(e.dataTransfer.files[0]);
  };

  // Main agent call: send the PDF to Anthropic with SYSTEM_PROMPT,
  // parse the JSON response into protocol text + flags, and move
  // the UI into the results stage.
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

  // Mark a flag as dismissed (and ensure it is not accepted).
  const toggleDismiss = (i) => {
    setDismissed((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
    setAccepted((p) => { const n = new Set(p); n.delete(i); return n; });
  };
  // Mark a flag as accepted (and ensure it is not dismissed).
  const toggleAccept = (i) => {
    setAccepted((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
    setDismissed((p) => { const n = new Set(p); n.delete(i); return n; });
  };

  // Reset all analysis state back to the initial upload screen.
  const resetApp = () => {
    setStage("upload"); setFlags([]); setDismissed(new Set()); setAccepted(new Set());
    setActiveFlag(null); setPdfFile(null); setPdfBase64(null); setProtocolText(""); setError(null);
  };

  // Raw protocol lines as returned by the agent (not yet updated).
  const protocolLines = protocolText ? protocolText.split("\n") : [];
  // Live "displayed" protocol lines with all accepted fixes applied in place.
  // This is the single source of truth for what the user sees and exports.
  const displayedLines = (() => {
    if (!protocolText) return [];
    const lines = protocolText.split("\n");
    const stepHeaderRe = /^(\s*Step\s+\d+[.:]\s*|\s*\d+\.\s*)/i;
    const stripStepFromSuggestion = (text) => String(text).replace(/^\s*Step\s+\d+[.:]\s*/i, "").replace(/^\s*\d+\.\s*/, "").trim();
    flags.forEach((f, fi) => {
      if (!accepted.has(fi) || !f.quoted_text || !f.suggested_rewrite) return;
      try {
        const q = String(f.quoted_text);
        const snippet = q.slice(0, Math.min(60, q.length)).trim();
        const relaxed = snippet.replace(/[.:]+$/, "").trim();
        const stepNo = f.step_number != null ? String(f.step_number) : null;

        // First, if we have a step_number, try to update the entire process step
        // block (header + following lines until the next step header).
        if (stepNo) {
          for (let i = 0; i < lines.length; i++) {
            const s = lines[i] != null ? String(lines[i]) : "";
            const trimmed = s.trim();
            if (!trimmed) continue;
            if (/^Step\s+\d+/i.test(trimmed) || /^\d+\./.test(trimmed)) {
              const numMatch = trimmed.match(/^Step\s+(\d+)/i) || trimmed.match(/^(\d+)\./);
              if (numMatch && numMatch[1] === stepNo) {
                const match = s.match(stepHeaderRe);
                const keepHeader = match ? match[1] : "";
                const bodyOnly = stripStepFromSuggestion(f.suggested_rewrite) || "";
                // Find the end of this step block (up to but not including next header).
                let end = i;
                for (let k = i + 1; k < lines.length; k++) {
                  const t = lines[k] != null ? String(lines[k]) : "";
                  const tTrim = t.trim();
                  if (!tTrim) { end = k; continue; }
                  if (/^Step\s+\d+/i.test(tTrim) || /^\d+\./.test(tTrim)) break;
                  end = k;
                }
                // Replace the whole block with a single updated step line.
                lines.splice(i, end - i + 1, (keepHeader + bodyOnly).trim());
                // We updated this step from its canonical header; move to next flag.
                return;
              }
            }
          }
        }

        for (let i = 0; i < lines.length; i++) {
          const s = lines[i] != null ? String(lines[i]) : "";
          if (!s) continue;
          if (s.includes(snippet) || (relaxed && s.includes(relaxed))) {
            const match = s.match(stepHeaderRe);
            const keepHeader = match ? match[1] : "";
            const bodyOnly = stripStepFromSuggestion(f.suggested_rewrite) || "";
            if (keepHeader) {
              lines[i] = (keepHeader + bodyOnly).trim();
            } else {
              const replaced = s.replace(snippet || relaxed, bodyOnly);
              lines[i] = replaced !== s ? replaced : bodyOnly;
            }
            break;
          }
        }
      } catch (_) {
        // If one flag's replacement fails, skip it so displayedLines and export still work
      }
    });
    return lines;
  })();
  // For each displayed line, compute the last line index of the "step"
  // (steps start with "Step N:" or "N.") that contains it.
  const stepEndByLine = (() => {
    const result = [];
    let stepStart = 0;
    const isStepStart = (s) => /^\s*Step\s+\d+/i.test(s) || /^\s*\d+\.\s+\S/.test(s);
    for (let i = 0; i < displayedLines.length; i++) {
      const s = (displayedLines[i] != null ? String(displayedLines[i]) : "").trim();
      if (i > stepStart && isStepStart(s)) {
        const stepEnd = i - 1;
        for (let j = stepStart; j <= stepEnd; j++) result[j] = stepEnd;
        stepStart = i;
      }
    }
    const stepEnd = displayedLines.length - 1;
    for (let j = stepStart; j <= stepEnd; j++) result[j] = stepEnd;
    return result;
  })();
  // For each flag, find the last displayed line that overlaps its quoted text,
  // then anchor the flag to the end of the *step* that contains that line.
  const lastLineForFlag = (() => {
    const out = {};
    flags.forEach((f, fi) => {
      if (!f.quoted_text) return;
      const q = f.quoted_text;
      const head = q.slice(0, 20);
      const tail = q.length > 20 ? q.slice(-20) : q;
      let lastOverlap = -1;
      displayedLines.forEach((line, i) => {
        const s = line != null ? String(line) : "";
        if (s.includes(head) || s.includes(tail) || (q.length <= 40 && s.includes(q))) lastOverlap = i;
      });
      out[fi] = lastOverlap >= 0 && stepEndByLine[lastOverlap] !== undefined ? stepEndByLine[lastOverlap] : lastOverlap;
    });
    return out;
  })();
  // Choose at most ONE primary flag per step (by severity, then first occurrence),
  // so that each step only surfaces a single canonical issue.
  const chosenFlagIndexByStepEnd = (() => {
    const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const byStep = {};
    flags.forEach((f, fi) => {
      const stepEnd = lastLineForFlag[fi];
      if (stepEnd == null || stepEnd < 0) return;
      const existing = byStep[stepEnd];
      if (existing == null) {
        byStep[stepEnd] = fi;
        return;
      }
      const existingFlag = flags[existing];
      const currentScore = severityRank[f.severity] || 0;
      const existingScore = severityRank[existingFlag.severity] || 0;
      if (currentScore > existingScore) byStep[stepEnd] = fi;
    });
    return byStep;
  })();
  // Helper to ask "which (single) flag should appear under this displayed line?".
  const getFlagsToShowAfterLine = (lineIndex) => {
    const idx = chosenFlagIndexByStepEnd[lineIndex];
    return typeof idx === "number" ? [flags[idx]] : [];
  };
  // Order the chosen flags by where they appear in the protocol (earlier steps first).
  const sortedFlagIndices = Object.values(chosenFlagIndexByStepEnd)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => (lastLineForFlag[a] ?? 999999) - (lastLineForFlag[b] ?? 999999));

  // Summary counts (ignoring dismissed flags) for the header pills,
  // based only on the single chosen flag per step.
  const chosenActiveFlags = sortedFlagIndices.map((idx) => ({ flag: flags[idx], idx }))
    .filter(({ idx }) => !dismissed.has(idx));
  const highCount = chosenActiveFlags.filter(({ flag }) => flag.severity === "HIGH").length;
  const medCount  = chosenActiveFlags.filter(({ flag }) => flag.severity === "MEDIUM").length;
  const lowCount  = chosenActiveFlags.filter(({ flag }) => flag.severity === "LOW").length;

  // Convenience helper for consumers that want the fully updated protocol.
  const buildUpdatedProtocolText = () => displayedLines.join("\n");

  // Generate a PDF of the updated protocol (with accepted fixes applied),
  // 1" margins, Times 12, 1.15 spacing, paragraph wrapping, and a
  // References section built from accepted flags' citations.
  const exportUpdatedProtocolPdf = () => {
    let baseText = (displayedLines.length > 0 ? displayedLines.join("\n") : protocolText) || "";
    if (!baseText.trim()) {
      setError("No protocol text available to export.");
      return;
    }
    try {
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const oneInch = 72;
      const margin = oneInch;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const usableWidth = pageWidth - margin * 2;
      const fontSize = 12;
      const lineSpacing = 1.15;
      const lineHeight = fontSize * lineSpacing;

      // Normalize Unicode subscripts (e.g., H₂O) to plain digits so they
      // render correctly with the built-in Times font.
      const subscriptMap = {
        "\u2080": "0",
        "\u2081": "1",
        "\u2082": "2",
        "\u2083": "3",
        "\u2084": "4",
        "\u2085": "5",
        "\u2086": "6",
        "\u2087": "7",
        "\u2088": "8",
        "\u2089": "9",
      };
      baseText = baseText.replace(/[\u2080-\u2089]/g, (ch) => subscriptMap[ch] || ch);

      // Normalize Greek letters that don't render well in built-in Times.
      // Keep ± as-is, but render common Greek symbols as parenthesized English strings.
      const greekMap = {
        "\u03B1": "(alpha)",
        "\u0391": "(Alpha)",
        "\u03B2": "(beta)",
        "\u0392": "(Beta)",
        "\u03B3": "(gamma)",
        "\u0393": "(Gamma)",
        "\u03B4": "(delta)",
        "\u0394": "(Delta)",
        "\u03B5": "(epsilon)",
        "\u0395": "(Epsilon)",
        "\u03BC": "(mu)",
        "\u039C": "(Mu)",
        "\u03C3": "(sigma)",
        "\u03A3": "(Sigma)",
        "\u03C9": "(omega)",
        "\u03A9": "(Omega)"
      };
      baseText = baseText.replace(/[\u0391-\u03C9]/g, (ch) => greekMap[ch] || ch);

      let y = margin;
      doc.setFont("times", "normal");
      doc.setFontSize(fontSize);

      const header = "Updated Protocol (with accepted fixes applied)";
      const headerLines = doc.splitTextToSize(header, usableWidth);
      headerLines.forEach((line) => {
        if (y + lineHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y, { maxWidth: usableWidth });
        y += lineHeight;
      });

      y += lineHeight * 0.5;
      const paragraphs = baseText.split("\n");
      const lines = [];
      let firstStepSeen = false;
      paragraphs.forEach((p) => {
        const text = p || " ";
        const trimmed = text.trim();
        const isStepStart =
          /^Step\s+\d+/i.test(trimmed) ||
          /^\d+\.\s+\S/.test(trimmed);
        // Insert a blank line before every step after the first so that
        // process steps are visually separated in the exported PDF.
        if (isStepStart) {
          if (firstStepSeen) {
            lines.push("");
          }
          firstStepSeen = true;
        }
        const wrapped = doc.splitTextToSize(text, usableWidth);
        lines.push(...wrapped);
      });
      lines.forEach((line) => {
        if (y + lineHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        if (line === "") {
          // Blank spacer line between steps.
          y += lineHeight;
        } else {
          doc.text(line, margin, y, { maxWidth: usableWidth });
          y += lineHeight;
        }
      });

      // Build references only from accepted, chosen flags (one per step).
      const refs = [];
      sortedFlagIndices.forEach((idx) => {
        const f = flags[idx];
        if (accepted.has(idx) && f.citation && String(f.citation).trim()) {
          refs.push(String(f.citation).trim());
        }
      });
      const references = [...new Set(refs)];

      y += lineHeight * 2;
      if (references.length > 0) {
        if (y + lineHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text("References", margin, y);
        y += lineHeight * 1.5;
        references.forEach((ref, i) => {
          const block = (i + 1) + ". " + ref;
          const refLines = doc.splitTextToSize(block, usableWidth);
          refLines.forEach((l) => {
            if (y + lineHeight > pageHeight - margin) {
              doc.addPage();
              y = margin;
            }
            doc.text(l, margin, y, { maxWidth: usableWidth });
            y += lineHeight;
          });
        });
      }

      const baseName = pdfFile?.name?.replace(/\.[^.]+$/, "") || "protocol";
      doc.save(`${baseName}-updated.pdf`);
    } catch (err) {
      console.error(err);
      setError("Failed to generate PDF export.");
    }
  };

  return (
    <div style={S.app}>
      {/* Global styles for typography, scrollbars, and small animation helpers. */}
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

      {/* Top nav bar with app name and tagline. */}
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

      {/* ── Upload stage: user selects a protocol PDF for the agent to review. ── */}
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

      {/* ── Analyzing stage: show streaming "thinking" while the agent runs. ── */}
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

      {/* ── Results stage: updated protocol on the left, triage flags on the right. ── */}
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
                <button style={S.exportBtn} onClick={exportUpdatedProtocolPdf}>⬇ Export Updated Protocol (PDF)</button>
                <button style={S.resetBtn} onClick={resetApp}>↺ New Analysis</button>
            </div>
          </div>

          <div style={S.panels}>
            <div style={S.leftPanel}>
              <div style={S.panelHdr}>
                <span style={S.panelLabel}>UPDATED PROTOCOL</span>
                <span style={{ fontSize: 11, color: "#bbb", fontFamily: "IBM Plex Mono, monospace", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdfFile?.name}</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {displayedLines.length > 0 ? displayedLines.map((line, i) => {
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
                            if (dismissed.has(idx) || accepted.has(idx)) return null;
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
                <span style={{ fontSize: 11, color: "#bbb" }}>{sortedFlagIndices.filter((idx) => !dismissed.has(idx) && !accepted.has(idx)).length} remaining</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {sortedFlagIndices.filter((idx) => !accepted.has(idx)).map((idx) => {
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
  exportBtn: { marginLeft: 8, background: "#1a1a1a", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 11, cursor: "pointer", color: "#fff", fontFamily: "IBM Plex Sans, sans-serif" },
  panels: { display: "flex", flex: 1, overflow: "hidden" },
  leftPanel: { width: "45%", borderRight: "1px solid #e8e6e0", display: "flex", flexDirection: "column", background: "white" },
  rightPanel: { flex: 1, display: "flex", flexDirection: "column", background: "#fafaf8" },
  panelHdr: { padding: "12px 20px", borderBottom: "1px solid #f0efe9", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafaf8", flexShrink: 0 },
  panelLabel: { fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#aaa", fontFamily: "IBM Plex Mono, monospace" },
};
