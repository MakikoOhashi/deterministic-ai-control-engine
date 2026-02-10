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

type OverallResponse = {
  D: number;
  components: Components;
  weights: Weights;
};

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
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [weights, setWeights] = useState<Weights | null>(null);
  const [target, setTarget] = useState<Components | null>(null);
  const [targetStability, setTargetStability] = useState<string | null>(null);
  const [effectiveTolerance, setEffectiveTolerance] = useState<number>(0.05);
  const [result, setResult] = useState<OverallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [mode, setMode] = useState<"A" | "B">("A");

  useEffect(() => {
    fetch(`${apiBase}/difficulty/weights`)
      .then((res) => res.json())
      .then((data) => setWeights(data.weights))
      .catch(() => setWeights(null));
  }, [apiBase]);

  const handleSetTarget = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/target/from-sources-mc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTexts: baselineSources
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
      };
      setTarget(data.mean);
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
      setSelected(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (targetOverride?: Components | null) => {
    setLoading(true);
    setError(null);
    try {
      const firstSource =
        baselineSources
          .split(/\n\s*\n/)
          .map((s) => s.trim())
          .filter(Boolean)[0] || "";
      const sourceText = firstSource;
      const res = await fetch(`${apiBase}/generate/mc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          target: targetOverride ?? target,
          mode,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as {
        item: { passage?: string | null; question: string; choices: string[]; correctIndex: number };
        similarity?: number;
      };
      setPassage(data.item.passage || "");
      setQuestion(data.item.question);
      setChoices(data.item.choices);
      setCorrectIndex(data.item.correctIndex);
      setSimilarity(typeof data.similarity === "number" ? data.similarity : null);
      setSelected(null);
      setSubmitted(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setSimilarity(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSetAndGenerate = async () => {
    const nextTarget = await handleSetTarget();
    await handleGenerate(nextTarget);
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
    correctIndex != null && choices[correctIndex] ? choices[correctIndex] : "";
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
          <div className="mode-title">Mode</div>
          <div className="mode-buttons">
            <button
              className={`mode-button ${mode === "A" ? "active" : ""}`}
              onClick={() => setMode("A")}
              type="button"
            >
              Mode A
            </button>
            <button
              className={`mode-button ${mode === "B" ? "active" : ""}`}
              onClick={() => setMode("B")}
              type="button"
            >
              Mode B
            </button>
          </div>
          <div className="mode-note">
            {mode === "A"
              ? "Cognitive Match (ability-based). Topic can change; difficulty profile must match."
              : "Concept Preservation (domain-specific). Keep topic; rephrase only."}
          </div>
        </div>
        <div className="field">
          <label>Paste target examples (1–3)</label>
          <textarea
            value={baselineSources}
            onChange={(e) => setBaselineSources(e.target.value)}
            placeholder="Separate examples with a blank line."
          />
        </div>

        <div className="actions" style={{ marginTop: 4 }}>
          <button onClick={handleSetAndGenerate} disabled={loading}>
            {loading ? "Working..." : "Set Target + Generate"}
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

        {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>

      <QualityConsole
        result={result}
        target={target}
        weights={weights}
        effectiveTolerance={effectiveTolerance}
        stability={targetStability}
        similarity={similarity}
        error={error}
      />
    </main>
  );
}
