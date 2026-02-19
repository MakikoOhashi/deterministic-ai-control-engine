"use client";

import { useEffect, useMemo, useState } from "react";
import QualityConsole from "./quality/QualityConsole";
import type {
  Components,
  SimilarityBreakdown,
  ChoiceStructure,
  GenerateMcResponse,
  TargetFromSourcesMcResponse,
} from "../../shared/api";

type Weights = {
  wL: number;
  wS: number;
  wA: number;
  wR: number;
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

type ChoiceIntent = {
  concept: string;
  patterns: string[];
};

function normalizeSourceText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const [correctText, setCorrectText] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [weights, setWeights] = useState<Weights | null>(null);
  const [target, setTarget] = useState<Components | null>(null);
  const [targetBand, setTargetBand] = useState<TargetBand | null>(null);
  const [axisTolerance, setAxisTolerance] = useState<AxisTolerance | null>(null);
  const [targetStability, setTargetStability] = useState<string | null>(null);
  const [effectiveTolerance, setEffectiveTolerance] = useState<number>(0.05);
  const [inferenceStyle, setInferenceStyle] = useState<
    "fact_based" | "intent_based" | "emotional"
  >("fact_based");
  const [targetAdjust, setTargetAdjust] = useState<Components>({
    L: 0,
    S: 0,
    A: 0,
    R: 0,
  });
  const [result, setResult] = useState<OverallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
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
  const [lastTargetSource, setLastTargetSource] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/difficulty/weights`)
      .then((res) => res.json())
      .then((data) => setWeights(data.weights))
      .catch(() => setWeights(null));
  }, [apiBase]);

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const adjustedTarget = useMemo(() => {
    if (!target) return null;
    return {
      L: clamp01(target.L + targetAdjust.L),
      S: clamp01(target.S + targetAdjust.S),
      A: clamp01(target.A + targetAdjust.A),
      R: clamp01(target.R + targetAdjust.R),
    };
  }, [target, targetAdjust]);

  const handleSetTarget = async (sourceOverride?: string | null) => {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`${apiBase}/target/from-sources-mc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTexts: [(sourceOverride || baselineSources).trim()].filter(Boolean),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as TargetFromSourcesMcResponse;
      if (!data.ok) {
        throw new Error(data.error || "Target build failed");
      }
      setTarget(data.mean);
      setLastTargetSource((sourceOverride || baselineSources).trim());
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
        (sourceOverride || baselineSources).trim();
      const res = await fetch(`${apiBase}/generate/mc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          target: targetOverride ?? adjustedTarget ?? target,
          inferenceStyle,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as GenerateMcResponse;
      if (!data.ok) {
        throw new Error(data.error || "Generation failed");
      }
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
      const normalizedSource = normalizeSourceText(baselineSources);
      if (normalizedSource !== baselineSources) {
        setBaselineSources(normalizedSource);
      }
      if (!normalizedSource) return;
      const normalizedKey = normalizedSource.trim();
      const needsTargetRecalc = !target || !lastTargetSource || lastTargetSource !== normalizedKey;
      if (needsTargetRecalc) {
        const nextTarget = await handleSetTarget(normalizedSource);
        if (!nextTarget) return;
        await handleGenerate(nextTarget, normalizedSource);
        return;
      }
      await handleGenerate(adjustedTarget ?? target, normalizedSource);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    }
  };

  const handleRegenerate = async () => {
    setError(null);
    setWarning(null);
    if (!target && !adjustedTarget) {
      setError("Set target first.");
      return;
    }
    await handleGenerate(adjustedTarget ?? target, baselineSources);
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
          <label>Paste target example (1 passage and 1 question with 4 choices)</label>
          <textarea
            value={baselineSources}
            onChange={(e) => setBaselineSources(e.target.value)}
            placeholder={"Passage:\n...\n\nQuestion:\n...\n\nChoices:\nA) ...\nB) ...\nC) ...\nD) ..."}
          />
        </div>
        <div className="field">
          <label>Inference Style</label>
          <select
            value={inferenceStyle}
            onChange={(e) =>
              setInferenceStyle(
                e.target.value as "fact_based" | "intent_based" | "emotional"
              )
            }
            style={{ maxWidth: 280 }}
          >
            <option value="fact_based">Fact-based</option>
            <option value="intent_based">Intent-based</option>
            <option value="emotional">Emotional/Tone</option>
          </select>
        </div>

        <div className="field">
          <label>Difficulty Target Adjust (L / S / A / R)</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {(["L", "S", "A", "R"] as const).map((axis) => (
              <div key={axis} style={{ display: "grid", gridTemplateColumns: "28px 1fr 56px", gap: 8, alignItems: "center" }}>
                <span>{axis}</span>
                <input
                  type="range"
                  min={-0.2}
                  max={0.2}
                  step={0.01}
                  value={targetAdjust[axis]}
                  onChange={(e) =>
                    setTargetAdjust((prev) => ({
                      ...prev,
                      [axis]: Number(e.target.value),
                    }))
                  }
                />
                <span>{targetAdjust[axis].toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="actions" style={{ marginTop: 4 }}>
          <button onClick={handleSetAndGenerate} disabled={loading}>
            {loading ? "Working..." : "Generate"}
          </button>
          <button onClick={handleRegenerate} disabled={loading || !target}>
            {loading ? "Working..." : "Regenerate"}
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
