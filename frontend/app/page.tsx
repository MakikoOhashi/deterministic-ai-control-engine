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

type BaselineItem = {
  text: string;
  correct: string;
  distractors: string[];
  steps: number;
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function Home() {
  const apiBase = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001",
    []
  );

  const [baselineSources, setBaselineSources] = useState(
    "Yesterday, we went to the park, and it brought back so many childhood memories."
  );

  const [text, setText] = useState("");
  const [correct, setCorrect] = useState("");
  const [distractors, setDistractors] = useState<string[]>([]);
  const [format, setFormat] = useState<string | null>(null);
  const [blankAnswer, setBlankAnswer] = useState("");
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

  useEffect(() => {
    fetch(`${apiBase}/difficulty/weights`)
      .then((res) => res.json())
      .then((data) => setWeights(data.weights))
      .catch(() => setWeights(null));
  }, [apiBase]);

  useEffect(() => {
    fetch(`${apiBase}/config/baseline-sample`)
      .then((res) => res.json())
      .then((data) => {
        const item = data.item as BaselineItem;
        setText(item.text);
        setCorrect(item.correct);
        setDistractors(shuffle(item.distractors));
      })
      .catch(() => null);
  }, [apiBase]);

  const handleSetTarget = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/target/from-sources`, {
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
      setText("");
      setCorrect("");
      setDistractors([]);
      setFormat(null);
      setSelected(null);
      setBlankAnswer("");
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
      const res = await fetch(`${apiBase}/generate/fill-blank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, target: targetOverride ?? target }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as {
        item: { text: string; correct: string; distractors: string[]; steps: number };
        format?: string;
        similarity?: number;
      };
      setText(data.item.text);
      setCorrect(data.item.correct);
      setDistractors(shuffle(data.item.distractors));
      setFormat(data.format || null);
      setSimilarity(typeof data.similarity === "number" ? data.similarity : null);
      setSelected(null);
      setBlankAnswer("");
      setSubmitted(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setText("");
      setCorrect("");
      setDistractors([]);
      setFormat(null);
      setSelected(null);
      setBlankAnswer("");
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
          text,
          correct,
          distractors,
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

  const isCorrect = submitted && selected === correct;
  const hasBlank = format === "full_blank" || format === "prefix_blank" || /(_\s*){2,}/.test(text);
  const prefixMatch = text.match(/([A-Za-z]+)\s*((?:_\s*){2,})/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  const blankCount = prefixMatch ? (prefixMatch[2].match(/_/g) || []).length : 0;
  const isPrefixBlank = format === "prefix_blank" || (!!prefixMatch && blankCount > 0);
  const userAnswer = (hasBlank ? blankAnswer : selected || "").trim().toLowerCase();
  const correctLower = correct.toLowerCase();
  const suffix = prefix ? correctLower.slice(prefix.length) : "";
  const blankCorrect =
    submitted &&
    (userAnswer === correctLower ||
      (isPrefixBlank && userAnswer === suffix && suffix.length === blankCount));

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
              <div className="generated-text">{text || "—"}</div>
              {hasBlank ? (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>{isPrefixBlank ? "Type the missing letters" : "Type the missing word"}</label>
                  <input
                    value={blankAnswer}
                    onChange={(e) => setBlankAnswer(e.target.value)}
                    placeholder="Your answer"
                  />
                </div>
              ) : (
                <div className="options">
                  {[correct, ...distractors].filter(Boolean).map((opt) => (
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
              )}
              <div className="actions">
                <button
                  onClick={() => setSubmitted(true)}
                  disabled={hasBlank ? !blankAnswer : !selected}
                >
                  Submit Answer
                </button>
                <button onClick={handleAudit} disabled={loading}>
                  {loading ? "Auditing..." : "Run Audit"}
                </button>
              </div>
              {submitted ? (
                <div className={isCorrect ? "result good" : "result bad"}>
                  {hasBlank
                    ? blankCorrect
                      ? "Correct"
                      : `Correct answer: ${correct}`
                    : isCorrect
                    ? "Correct"
                    : `Correct answer: ${correct}`}
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
