"use client";

import { useEffect, useMemo, useState } from "react";
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

type TaskType = "context_completion" | "guided_reading";

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
  const [taskType, setTaskType] = useState<TaskType>("context_completion");
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
  const parsedBlank = useMemo(
    () => (taskType === "context_completion" ? parsePrimaryBlank(question) : null),
    [taskType, question]
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
        taskType?: TaskType;
        normalizedText?: string;
        displayText?: string;
        answerKey?: string[];
        payload?: {
          taskType?: TaskType;
          displayText?: string;
          sourceAnswerKey?: string[];
        };
      };
      const payload = data.payload;
      const nextTaskType = payload?.taskType || data.taskType;
      if (nextTaskType && nextTaskType !== taskType) {
        setTaskType(nextTaskType);
      }
      const normalized = (payload?.displayText || data.displayText || data.normalizedText || input).trim();
      setSourceAnswerKey(
        Array.isArray(payload?.sourceAnswerKey)
          ? payload.sourceAnswerKey
          : Array.isArray(data.answerKey)
          ? data.answerKey
          : []
      );
      if (taskType === "context_completion" && !/[_*]{2,}/.test(normalized)) {
        throw new Error("Could not detect blanks from input. Please use a clearer image or add underscores manually.");
      }
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
      const targetEndpoint =
        taskType === "guided_reading" ? "/target/from-sources-mc" : "/target/from-sources";
      const res = await fetch(`${apiBase}${targetEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTexts:
            taskType === "context_completion"
              ? [(sourceOverride || baselineSources).trim()].filter(Boolean)
              : (sourceOverride || baselineSources)
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

  useEffect(() => {
    setPassage("");
    setQuestion("");
    setChoices([]);
    setCorrectIndex(null);
    setCorrectText("");
    setSelected(null);
    setTypedAnswer("");
    setContextSlots([]);
    setContextAnswers([]);
    setContextAnswerKey([]);
    setTargetBand(null);
    setAxisTolerance(null);
    setSourceAnswerKey([]);
    setRunMeta(null);
    setSubmitted(false);
  }, [taskType]);

  const handleGenerate = async (
    targetOverride?: Components | null,
    sourceOverride?: string | null
  ) => {
    setLoading(true);
    setError(null);
    try {
      const sourceText =
        taskType === "context_completion"
          ? (sourceOverride || baselineSources).trim()
          : (sourceOverride || baselineSources)
              .split(/\n\s*\n/)
              .map((s) => s.trim())
              .filter(Boolean)[0] || "";
      const endpoint =
        taskType === "guided_reading" ? "/generate/mc" : "/generate/fill-blank";
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          target: targetOverride ?? target,
          sourceAnswers: taskType === "context_completion" ? sourceAnswerKey : undefined,
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
      if (taskType === "guided_reading") {
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
      } else {
        const item = data.item as { text: string; correct: string; distractors: string[] };
        setPassage("");
        setQuestion(data.displayText || item.text);
        const slots = Array.isArray(data.slots) ? data.slots : [];
        const answerKey = Array.isArray(data.answerKey) ? data.answerKey : [item.correct];
        setContextSlots(slots);
        setContextAnswerKey(answerKey);
        setContextAnswers(Array.from({ length: answerKey.length }, () => ""));
        const auditChoices = [item.correct, ...item.distractors];
        setChoices(auditChoices);
        setCorrectIndex(0);
        setCorrectText(item.correct);
      }
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

  const correctChoice =
    taskType === "guided_reading"
      ? correctIndex != null && choices[correctIndex]
        ? choices[correctIndex]
        : ""
      : correctText;
  const contextSubmittedAnswer =
    taskType === "context_completion" && parsedBlank
      ? `${parsedBlank.prefix}${typedAnswer}`
      : typedAnswer;
  const contextSubmittedList =
    contextSlots.length > 1
      ? contextAnswers.map((a, idx) => `${contextSlots[idx]?.prefix ?? ""}${a}`)
      : [contextSubmittedAnswer];
  const isCorrect =
    submitted &&
    (taskType === "guided_reading"
      ? selected === correctChoice
      : contextSlots.length > 1
      ? contextSubmittedList.every(
          (v, i) => v.trim().toLowerCase() === (contextAnswerKey[i] || "").trim().toLowerCase()
        )
      : contextSubmittedAnswer.trim().toLowerCase() === correctChoice.trim().toLowerCase());

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
            <button
              className={`mode-button ${taskType === "context_completion" ? "active" : ""}`}
              onClick={() => setTaskType("context_completion")}
              type="button"
            >
              Context Completion
            </button>
            <button
              className={`mode-button ${taskType === "guided_reading" ? "active" : ""}`}
              onClick={() => setTaskType("guided_reading")}
              type="button"
            >
              Guided Reading
            </button>
          </div>
        </div>
        <div className="mode-note">
          {taskType === "context_completion"
            ? "Fill missing words using context."
            : "Read a short passage and answer inference questions."}
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
              {taskType === "guided_reading" ? (
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
              ) : (
                <div className="context-completion">
                  <div className="context-heading">Complete the text with the correct word</div>
                  <div className="context-text">
                    {contextSlots.length > 1 ? (
                      question || "—"
                    ) : parsedBlank ? (
                      <>
                        {question.slice(0, parsedBlank.start)}
                        <span className="context-blank">
                          {parsedBlank.prefix
                            .split("")
                            .filter(Boolean)
                            .map((ch, idx) => (
                              <span key={`p-${idx}`} className="blank-cell fixed">
                                {ch}
                              </span>
                            ))}
                          {Array.from({ length: parsedBlank!.missingCount }).map((_, idx) => (
                            <input
                              key={`m-${idx}`}
                              className="blank-cell blank-input"
                              value={typedAnswer[idx] || ""}
                              onChange={(e) => {
                                const char = (e.target.value || "").slice(-1);
                                setTypedAnswer((prev) => {
                                  const arr = Array.from({ length: parsedBlank!.missingCount }).map(
                                    (_x, i) => prev[i] || ""
                                  );
                                  arr[idx] = char;
                                  return arr.join("");
                                });
                              }}
                              maxLength={1}
                            />
                          ))}
                        </span>
                        {question.slice(parsedBlank.end)}
                      </>
                    ) : (
                      question || "—"
                    )}
                  </div>
                  {contextSlots.length > 1 ? (
                    <div className="field">
                      <label>Type missing letters for each blank</label>
                      {contextSlots.map((slot, idx) => (
                        <div key={`slot-${idx}`} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                          <span className="muted" style={{ minWidth: 80 }}>
                            Blank {idx + 1}: {slot.prefix}
                          </span>
                          <input
                            value={contextAnswers[idx] || ""}
                            onChange={(e) => {
                              const next = e.target.value.slice(0, slot.missingCount);
                              setContextAnswers((prev) => {
                                const cloned = [...prev];
                                cloned[idx] = next;
                                return cloned;
                              });
                            }}
                            placeholder={`${slot.missingCount} letters`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : parsedBlank ? null : (
                    <div className="field">
                      <label>Your answer</label>
                      <input
                        value={typedAnswer}
                        onChange={(e) => setTypedAnswer(e.target.value)}
                        placeholder="Type the missing word(s)"
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="actions">
                <button
                  onClick={() => setSubmitted(true)}
                  disabled={
                    taskType === "guided_reading"
                      ? !selected
                      : contextSlots.length > 1
                      ? contextAnswers.some((a, idx) => (a || "").trim().length < (contextSlots[idx]?.missingCount || 0))
                      : !typedAnswer.trim()
                  }
                >
                  Submit Answer
                </button>
                <button onClick={handleAudit} disabled={loading}>
                  {loading ? "Auditing..." : "Run Audit"}
                </button>
              </div>
              {submitted ? (
                <div className={isCorrect ? "result good" : "result bad"}>
                  {isCorrect
                    ? "Correct"
                    : contextSlots.length > 1
                    ? `Correct answers: ${contextAnswerKey.join(", ")}`
                    : `Correct answer: ${correctChoice}`}
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
