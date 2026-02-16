"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import QualityConsole from "./quality/QualityConsole";

type Weights = {
  wL: number;
  wS: number;
  wA: number;
  wR: number;
};

type Components = {
  L: number;
  S: number;
  A: number;
  R: number;
};
type TargetBand = {
  min: Components;
  max: Components;
};
type AxisTolerance = Components;

type OverallResponse = {
  D: number;
  components: Components;
  weights: Weights;
};

type SimilarityBreakdown = {
  passage: number | null;
  question: number | null;
  correctChoice: number | null;
  distractors: number | null;
  choices: number | null;
};
type ChoiceIntent = {
  concept: string;
  patterns: string[];
};
type ChoiceStructure = {
  correctMeanSim: number;
  distractorMeanSim: number;
  distractorVariance: number;
  isolationIndex: number;
};

type TaskType = "guided_reading";

type ParsedBlank = {
  prefix: string;
  missingCount: number;
  start: number;
  end: number;
} | null;

type BlankSlot = {
  index: number;
  start: number;
  end: number;
  prefix: string;
  missingCount: number;
  pattern: string;
  slotConfidence?: number;
};

function parsePrimaryBlank(text: string): ParsedBlank {
  const prefixMatch = /([A-Za-z]+)\s*((?:[_*]\s*){2,})/.exec(text);
  if (prefixMatch && prefixMatch.index >= 0) {
    const rawBlank = prefixMatch[2] || "";
    const missingCount = rawBlank.replace(/[\s]/g, "").length;
    return {
      prefix: prefixMatch[1] || "",
      missingCount,
      start: prefixMatch.index,
      end: prefixMatch.index + prefixMatch[0].length,
    };
  }

  const plainMatch = /([_*]\s*){2,}/.exec(text);
  if (plainMatch && plainMatch.index >= 0) {
    const missingCount = plainMatch[0].replace(/[\s]/g, "").length;
    return {
      prefix: "",
      missingCount,
      start: plainMatch.index,
      end: plainMatch.index + plainMatch[0].length,
    };
  }

  return null;
}

function countBlanksInText(text: string): number {
  const normalized = String(text || "");
  const matches = normalized.match(/([A-Za-z]{0,6}\s*(?:[_*]\s*){2,}|(?:[_*]\s*){2,})/g);
  return matches ? matches.length : 0;
}

export default function Home() {
  const apiBase = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001",
    []
  );

  const [baselineSources, setBaselineSources] = useState(
    "Passage:\nUrban green spaces reduce heat and improve wellbeing, but funding remains limited.\n\nQuestion:\nWhat does the passage imply about funding for green spaces?\n\nChoices:\nA) It is adequate.\nB) It is limited.\nC) It is increasing rapidly.\nD) It is unrelated to wellbeing.\n\nAnswer: B"
  );

  const [passage, setPassage] = useState("");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const taskType: TaskType = "guided_reading";
  const [typedAnswer, setTypedAnswer] = useState("");
  const [contextSlots, setContextSlots] = useState<BlankSlot[]>([]);
  const [contextAnswers, setContextAnswers] = useState<string[]>([]);
  const [contextAnswerKey, setContextAnswerKey] = useState<string[]>([]);
  const [correctText, setCorrectText] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [weights, setWeights] = useState<Weights | null>(null);
  const [target, setTarget] = useState<Components | null>(null);
  const [targetBand, setTargetBand] = useState<TargetBand | null>(null);
  const [axisTolerance, setAxisTolerance] = useState<AxisTolerance | null>(null);
  const [targetStability, setTargetStability] = useState<string | null>(null);
  const [effectiveTolerance, setEffectiveTolerance] = useState<number>(0.05);
  const [result, setResult] = useState<OverallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrLang, setOcrLang] = useState<"eng" | "jpn+eng">("eng");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [sourceAnswerKey, setSourceAnswerKey] = useState<string[]>([]);
  const [sourceSlotCount, setSourceSlotCount] = useState<number>(1);
  const [sourcePrefixMode, setSourcePrefixMode] = useState<"none" | "hasPrefix">("none");
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [similarityBreakdown, setSimilarityBreakdown] = useState<SimilarityBreakdown | null>(null);
  const [choiceIntent, setChoiceIntent] = useState<ChoiceIntent | null>(null);
  const [choiceStructure, setChoiceStructure] = useState<ChoiceStructure | null>(null);
  const [runMeta, setRunMeta] = useState<{
    runId?: string;
    sourceId?: string;
    candidateId?: string;
    stage?: string;
  } | null>(null);
  const parsedBlank = useMemo(() => parsePrimaryBlank(question), [question]);
  const sortedContextSlots = useMemo(
    () => [...contextSlots].sort((a, b) => a.start - b.start),
    [contextSlots]
  );
  const displayContextSlots = useMemo(
    () =>
      sortedContextSlots.map((slot, idx) => {
        const answer = (contextAnswerKey[idx] || "").trim().toLowerCase();
        const rawPrefix = slot.prefix || "";
        const prefixValid = Boolean(rawPrefix) && answer.startsWith(rawPrefix.toLowerCase());
        let uiPrefix = prefixValid ? rawPrefix : "";
        if (!prefixValid && sourcePrefixMode === "hasPrefix" && answer.length >= 3) {
          const inferredLen = Math.max(
            1,
            Math.min(3, answer.length - Math.max(2, Math.min(slot.missingCount, answer.length - 1)))
          );
          uiPrefix = answer.slice(0, inferredLen);
        }
        const uiMissingCount = uiPrefix
          ? Math.max(answer.length - uiPrefix.length, 1)
          : Math.max(answer.length, 1);
        const detachedPrefix =
          prefixValid || sourcePrefixMode === "hasPrefix" ? "" : rawPrefix;
        return { ...slot, uiPrefix, uiMissingCount, detachedPrefix };
      }),
    [sortedContextSlots, contextAnswerKey, sourcePrefixMode]
  );

  useEffect(() => {
    fetch(`${apiBase}/difficulty/weights`)
      .then((res) => res.json())
      .then((data) => setWeights(data.weights))
      .catch(() => setWeights(null));
  }, [apiBase]);

  useEffect(() => {
    if (!ocrFile) {
      setOcrPreviewUrl(null);
      return;
    }
    const next = URL.createObjectURL(ocrFile);
    setOcrPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [ocrFile]);

  const normalizeOcrText = (raw: string) =>
    raw
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const fileToResizedBase64 = async (file: File, maxSide = 1024) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode image."));
      image.src = dataUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create canvas context.");
    ctx.drawImage(img, 0, 0, width, height);
    const output = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = output.split(",")[1] || "";
    return { base64, mimeType: "image/jpeg" };
  };

  const runInternalPreprocess = async (): Promise<string | null> => {
    let input = baselineSources.trim();
    if (!input && !ocrFile) {
      setError("Paste an example or upload an image first.");
      return null;
    }

    let visionSlots:
      | Array<{ prefix?: string; missingCount?: number; confidence?: number }>
      | undefined;

    if (ocrFile) {
      setOcrLoading(true);
      try {
        try {
          const resized = await fileToResizedBase64(ocrFile, 1024);
          const visionRes = await fetch(`${apiBase}/vision/extract-slots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: resized.base64,
              mimeType: resized.mimeType,
              maxSlots: 6,
            }),
          });
          if (visionRes.ok) {
            const v = (await visionRes.json()) as {
              slots?: Array<{ prefix?: string; missingCount?: number; confidence?: number }>;
            };
            if (Array.isArray(v.slots) && v.slots.length > 0) {
              visionSlots = v.slots;
            }
          }
        } catch {
          // Vision extraction is best-effort in v1.
        }
        const tesseract = await import("tesseract.js");
        const result = await tesseract.recognize(ocrFile, ocrLang);
        const normalized = normalizeOcrText(result.data.text || "");
        if (!normalized) throw new Error("OCR returned empty text.");
        input = normalized;
      } finally {
        setOcrLoading(false);
      }
    }

    setStructuring(true);
    try {
      const res = await fetch(`${apiBase}/ocr/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input,
          preferredTaskType: taskType,
          visionSlots,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Structuring failed.");
      }
      const data = (await res.json()) as {
        taskType?: "context_completion" | "guided_reading";
        normalizedText?: string;
        displayText?: string;
        answerKey?: string[];
        payload?: {
          taskType?: TaskType;
          displayText?: string;
          sourceAnswerKey?: string[];
          slotCount?: number;
          extraction?: { prefixMode?: "none" | "hasPrefix" };
        };
      };
      const payload = data.payload;
      const normalized = (payload?.displayText || data.displayText || data.normalizedText || input).trim();
      setSourceAnswerKey(
        Array.isArray(payload?.sourceAnswerKey)
          ? payload.sourceAnswerKey
          : Array.isArray(data.answerKey)
          ? data.answerKey
          : []
      );
      const fromPayload = Number(payload?.slotCount || 0);
      const fromText = countBlanksInText(normalized);
      const fromAnswerKey = Array.isArray(payload?.sourceAnswerKey)
        ? payload.sourceAnswerKey.length
        : Array.isArray(data.answerKey)
        ? data.answerKey.length
        : 0;
      const inferredSlotCount = Math.max(fromPayload, fromText, fromAnswerKey, 1);
      setSourceSlotCount(Math.max(1, Math.min(2, inferredSlotCount)));
      setSourcePrefixMode(payload?.extraction?.prefixMode === "hasPrefix" ? "hasPrefix" : "none");
      setBaselineSources(normalized);
      return normalized;
    } finally {
      setStructuring(false);
    }
  };

  const handleSetTarget = async (sourceOverride?: string | null) => {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`${apiBase}/target/from-sources-mc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTexts: (sourceOverride || baselineSources)
            .split(/\n\s*\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 3),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as {
        mean: Components;
        stability: string;
        effectiveTolerance: number;
        axisTolerance?: AxisTolerance;
        targetBand?: TargetBand;
      };
      setTarget(data.mean);
      setTargetBand(data.targetBand ?? null);
      setAxisTolerance(data.axisTolerance ?? null);
      setTargetStability(data.stability);
      setEffectiveTolerance(data.effectiveTolerance);
      return data.mean;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setPassage("");
      setQuestion("");
      setChoices([]);
      setCorrectIndex(null);
      setCorrectText("");
      setTargetBand(null);
      setAxisTolerance(null);
      setSelected(null);
      setTypedAnswer("");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (
    targetOverride?: Components | null,
    sourceOverride?: string | null
  ) => {
    setLoading(true);
    setError(null);
    try {
      const sourceText =
        (sourceOverride || baselineSources)
          .split(/\n\s*\n/)
          .map((s) => s.trim())
          .filter(Boolean)[0] || "";
      const res = await fetch(`${apiBase}/generate/mc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          target: targetOverride ?? target,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as {
        item:
          | { passage?: string | null; question: string; choices: string[]; correctIndex: number }
          | { text: string; correct: string; distractors: string[] };
        displayText?: string;
        answerKey?: string[];
        slots?: BlankSlot[];
        similarity?: number;
        similarityWarning?: string;
        similarityBreakdown?: SimilarityBreakdown;
        choiceIntent?: ChoiceIntent;
        choiceStructure?: ChoiceStructure;
        runId?: string;
        sourceId?: string;
        candidateId?: string;
        debug?: { stage?: string };
      };
      const item = data.item as {
        passage?: string | null;
        question: string;
        choices: string[];
        correctIndex: number;
      };
      setPassage(item.passage || "");
      setQuestion(item.question);
      setChoices(item.choices);
      setCorrectIndex(item.correctIndex);
      setCorrectText(item.choices[item.correctIndex] || "");
      setSimilarity(typeof data.similarity === "number" ? data.similarity : null);
      setWarning(data.similarityWarning ?? null);
      setSimilarityBreakdown(data.similarityBreakdown ?? null);
      setChoiceIntent(data.choiceIntent ?? null);
      setChoiceStructure(data.choiceStructure ?? null);
      setRunMeta({
        runId: data.runId,
        sourceId: data.sourceId,
        candidateId: data.candidateId,
        stage: data.debug?.stage,
      });
      setSelected(null);
      setTypedAnswer("");
      setSubmitted(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setSimilarity(null);
      setWarning(null);
      setSimilarityBreakdown(null);
      setChoiceIntent(null);
      setChoiceStructure(null);
      setRunMeta(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSetAndGenerate = async () => {
    setError(null);
    setWarning(null);
    try {
      const normalizedSource = await runInternalPreprocess();
      if (!normalizedSource) return;
      const nextTarget = await handleSetTarget(normalizedSource);
      if (!nextTarget) return;
      await handleGenerate(nextTarget, normalizedSource);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    }
  };

  const handleAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/difficulty/overall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: passage ? `${passage}\n\n${question}` : question,
          correct:
            correctIndex != null && choices[correctIndex] ? choices[correctIndex] : "",
          distractors:
            correctIndex != null
              ? choices.filter((_, i) => i !== correctIndex)
              : [],
          steps: 2,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as OverallResponse;
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const correctChoice = correctIndex != null && choices[correctIndex] ? choices[correctIndex] : "";
  const isCorrect = submitted && selected === correctChoice;

  const hints = [
    target && result
      ? result.components.A < target.A - 0.05
        ? "Increase distractor similarity."
        : result.components.A > target.A + 0.05
        ? "Reduce distractor similarity."
        : null
      : null,
    target && result
      ? result.components.S < target.S - 0.05
        ? "Increase clause complexity."
        : result.components.S > target.S + 0.05
        ? "Simplify sentence structure."
        : null
      : null,
  ].filter(Boolean) as string[];

  return (
    <main>
      <h1>Stable Difficulty Generation Engine</h1>
      <div className="subtitle">
        Control-grade difficulty consistency for AI-generated assessments.
      </div>

      <div className="panel">
        <div className="mode-bar">
          <div className="mode-title">Task Type</div>
          <div className="mode-buttons">
            <button className="mode-button active" type="button">
              Guided Reading (v1)
            </button>
          </div>
        </div>
        <div className="mode-note">
          Read a passage and answer one inference question with 4 choices.
        </div>
        <div className="field">
          <label>Paste target examples (1–3)</label>
          <textarea
            value={baselineSources}
            onChange={(e) => setBaselineSources(e.target.value)}
            placeholder="Separate examples with a blank line."
          />
        </div>
        <div className="field">
          <label>Or upload screenshot (OCR)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setOcrFile(e.target.files?.[0] || null)}
          />
          <div className="actions" style={{ marginTop: 8 }}>
            <select
              value={ocrLang}
              onChange={(e) => setOcrLang(e.target.value as "eng" | "jpn+eng")}
              style={{ maxWidth: 240 }}
            >
              <option value="eng">English OCR</option>
              <option value="jpn+eng">Japanese + English OCR</option>
            </select>
            <span className="muted">
              OCR + AI structuring runs automatically when you click Set Target + Generate.
            </span>
          </div>
          {ocrPreviewUrl ? (
            <div style={{ marginTop: 8 }}>
              <img
                src={ocrPreviewUrl}
                alt="OCR source preview"
                style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </div>
          ) : null}
        </div>

        <div className="actions" style={{ marginTop: 4 }}>
          <button onClick={handleSetAndGenerate} disabled={loading}>
            {loading || ocrLoading || structuring ? "Working..." : "Set Target + Generate"}
          </button>
        </div>

            <div className="generated">
              <div className="generated-title">Generated Question</div>
              {passage ? <div className="generated-text">{passage}</div> : null}
              <div className="generated-text">{question || "—"}</div>
              <div className="options">
                {choices.filter(Boolean).map((opt) => (
                  <label key={opt} className="option">
                    <input
                      type="radio"
                      name="answer"
                      value={opt}
                      checked={selected === opt}
                      onChange={() => setSelected(opt)}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
              <div className="actions">
                <button
                  onClick={() => setSubmitted(true)}
                  disabled={!selected}
                >
                  Submit Answer
                </button>
                <button onClick={handleAudit} disabled={loading}>
                  {loading ? "Auditing..." : "Run Audit"}
                </button>
              </div>
              {submitted ? (
                <div className={isCorrect ? "result good" : "result bad"}>
                  {isCorrect ? "Correct" : `Correct answer: ${correctChoice}`}
                </div>
              ) : null}
            </div>

        {warning ? <div className="warning" style={{ marginTop: 12 }}>{warning}</div> : null}
        {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>

      <QualityConsole
        result={result}
        target={target}
        targetBand={targetBand}
        axisTolerance={axisTolerance}
        weights={weights}
        effectiveTolerance={effectiveTolerance}
        stability={targetStability}
        similarity={similarity}
        similarityBreakdown={similarityBreakdown}
        choiceIntent={choiceIntent}
        choiceStructure={choiceStructure}
        runMeta={runMeta}
        error={error}
      />
    </main>
  );
}
