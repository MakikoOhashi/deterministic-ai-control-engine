"use client";

import { useEffect, useMemo, useState } from "react";
import QualityConsole from "./quality/QualityConsole";

type BaselineItem = {
  text: string;
  correct: string;
  distractors: string[];
  steps: number;
};

type ViewMode = "try" | "quality";

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
  const [item, setItem] = useState<BaselineItem | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState<ViewMode>("try");

  useEffect(() => {
    fetch(`${apiBase}/config/baseline-sample`)
      .then((res) => res.json())
      .then((data) => {
        const i = data.item as BaselineItem;
        setItem(i);
        setOptions(shuffle([i.correct, ...i.distractors]));
      })
      .catch(() => setItem(null));
  }, [apiBase]);

  const handleSubmit = () => {
    if (!selected) return;
    setSubmitted(true);
  };

  const isCorrect = submitted && selected === item?.correct;

  return (
    <main>
      <h1>Stable Difficulty Generation Engine</h1>
      <div className="subtitle">
        Control-grade difficulty consistency for AI-generated assessments.
      </div>

      <div className="panel">
       
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button
            className={`tab ${view === "try" ? "active" : ""}`}
            onClick={() => setView("try")}
          >
            Try a Question
          </button>
          <button
            className={`tab ${view === "quality" ? "active" : ""}`}
            onClick={() => setView("quality")}
          >
            View Quality Control
          </button>
        </div>

        {view === "try" ? (
          <div>
            <div className="compare-text" style={{ marginTop: 0 }}>
              {item?.text || "Loading..."}
            </div>

            <div className="options">
              {options.map((opt) => (
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
              <button onClick={handleSubmit} disabled={!selected}>
                Submit
              </button>
            </div>

            {submitted ? (
              <div className={isCorrect ? "result good" : "result bad"}>
                {isCorrect ? "Correct" : "Incorrect"}
              </div>
            ) : null}
          </div>
        ) : (
          <QualityConsole />
        )}
      </div>
    </main>
  );
}
