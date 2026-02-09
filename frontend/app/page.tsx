"use client";

import { useEffect, useMemo, useState } from "react";

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

const DEFAULT_TEXT =
  "Although it is improving, the author implies climate change is accelerating rapidly, and policy is involved.";

const DEFAULT_DISTRACTORS = [
  "It is slightly improving.",
  "It is stable.",
  "It is unrelated to policy.",
].join("\n");

const TOLERANCE = 0.05;

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function toPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function delta(a: number, b: number) {
  return a - b;
}

function formatDelta(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}`;
}

type ComplianceLevel = "within" | "minor" | "out";

function complianceLevel(deltaValue: number) {
  const abs = Math.abs(deltaValue);
  if (abs <= TOLERANCE) return "within";
  if (abs <= TOLERANCE * 2) return "minor";
  return "out";
}

function complianceLabel(level: ComplianceLevel) {
  if (level === "within") return "Within target";
  if (level === "minor") return "Minor deviation";
  return "Out of range";
}

function distanceScore(current: Components, target: Components, weights: Weights) {
  const dL = current.L - target.L;
  const dS = current.S - target.S;
  const dA = current.A - target.A;
  const dR = current.R - target.R;
  const sum =
    weights.wL * dL * dL +
    weights.wS * dS * dS +
    weights.wA * dA * dA +
    weights.wR * dR * dR;
  return Math.sqrt(sum);
}

function distanceCompliance(distanceValue: number) {
  if (distanceValue <= 0.05) return "within";
  if (distanceValue <= 0.15) return "minor";
  return "out";
}

function RadarChart({ data }: { data: Components }) {
  const size = 220;
  const center = size / 2;
  const radius = 80;
  const labels = ["L", "S", "A", "R"];
  const values = [data.L, data.S, data.A, data.R].map(clamp01);

  const points = values.map((v, i) => {
    const angle = ((-90 + i * 90) * Math.PI) / 180;
    const r = radius * v;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return `${x},${y}`;
  });

  const labelPoints = labels.map((label, i) => {
    const angle = ((-90 + i * 90) * Math.PI) / 180;
    const r = radius + 20;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return { label, x, y };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(255,255,255,0.1)" />
      <circle cx={center} cy={center} r={radius * 0.66} fill="none" stroke="rgba(255,255,255,0.08)" />
      <circle cx={center} cy={center} r={radius * 0.33} fill="none" stroke="rgba(255,255,255,0.06)" />
      {labels.map((_, i) => {
        const angle = ((-90 + i * 90) * Math.PI) / 180;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return (
          <line
            key={`axis-${i}`}
            x1={center}
            y1={center}
            x2={x}
            y2={y}
            stroke="rgba(255,255,255,0.1)"
          />
        );
      })}
      <polygon
        points={points.join(" ")}
        fill="rgba(67,230,164,0.25)"
        stroke="rgba(67,230,164,0.8)"
        strokeWidth="2"
      />
      {labelPoints.map((p) => (
        <text key={p.label} x={p.x} y={p.y} fill="#cdd7e6" fontSize="12" textAnchor="middle">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

export default function Home() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [correct, setCorrect] = useState("It is accelerating rapidly.");
  const [distractors, setDistractors] = useState(DEFAULT_DISTRACTORS);
  const [steps, setSteps] = useState(3);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [target, setTarget] = useState<Components | null>(null);
  const [baselineCount, setBaselineCount] = useState<number | null>(null);
  const [baselineItem, setBaselineItem] = useState<BaselineItem | null>(null);
  const [result, setResult] = useState<OverallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001",
    []
  );

  useEffect(() => {
    fetch(`${apiBase}/difficulty/weights`)
      .then((res) => res.json())
      .then((data) => setWeights(data.weights))
      .catch(() => setWeights(null));
  }, [apiBase]);

  useEffect(() => {
    fetch(`${apiBase}/config/target-profile`)
      .then((res) => res.json())
      .then((data) => {
        setTarget(data.target || null);
        setBaselineCount(typeof data.baselineCount === "number" ? data.baselineCount : null);
      })
      .catch(() => setTarget(null));
  }, [apiBase]);

  useEffect(() => {
    fetch(`${apiBase}/config/baseline-sample`)
      .then((res) => res.json())
      .then((data) => setBaselineItem(data.item || null))
      .catch(() => setBaselineItem(null));
  }, [apiBase]);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        text,
        correct,
        distractors: distractors
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        steps: Number(steps),
      };
      const res = await fetch(`${apiBase}/difficulty/overall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const data = (await res.json()) as OverallResponse;
      setResult(data);
      setWeights(data.weights);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const current = result?.components || { L: 0, S: 0, A: 0, R: 0 };
  const targetProfile = target || { L: 0, S: 0, A: 0, R: 0 };
  const deltas = {
    L: delta(current.L, targetProfile.L),
    S: delta(current.S, targetProfile.S),
    A: delta(current.A, targetProfile.A),
    R: delta(current.R, targetProfile.R),
  };
  const DCurrent = result?.D ?? 0;
  const DTarget = result
    ? targetProfile.L * (weights?.wL || 0.2) +
      targetProfile.S * (weights?.wS || 0.2) +
      targetProfile.A * (weights?.wA || 0.3) +
      targetProfile.R * (weights?.wR || 0.3)
    : 0;
  const DDelta = result ? DCurrent - DTarget : 0;
  const DCompliance = result ? complianceLevel(DDelta) : "within";
  const LCompliance = result ? complianceLevel(deltas.L) : "within";
  const SCompliance = result ? complianceLevel(deltas.S) : "within";
  const ACompliance = result ? complianceLevel(deltas.A) : "within";
  const RCompliance = result ? complianceLevel(deltas.R) : "within";
  const effectiveWeights = weights || { wL: 0.2, wS: 0.2, wA: 0.3, wR: 0.3 };
  const distance = result && target ? distanceScore(current, targetProfile, effectiveWeights) : 0;
  const distanceStatus = result ? distanceCompliance(distance) : "within";

  const suggestions = [
    deltas.L < -0.05 ? "Increase lexical complexity (use longer or rarer words)." : null,
    deltas.L > 0.05 ? "Reduce lexical complexity (shorter, more common words)." : null,
    deltas.S < -0.05 ? "Increase clause complexity (add conjunctions/subordinate clauses)." : null,
    deltas.S > 0.05 ? "Reduce clause complexity (simplify sentence structure)." : null,
    deltas.A < -0.05 ? "Increase distractor similarity (harder semantic choices)." : null,
    deltas.A > 0.05 ? "Reduce distractor similarity (clearer separation)." : null,
    deltas.R < -0.05 ? "Increase reasoning steps (multi-hop inference)." : null,
    deltas.R > 0.05 ? "Reduce reasoning steps (more direct inference)." : null,
  ].filter(Boolean) as string[];

  return (
    <main>
      <h1>Difficulty Control Console</h1>
      <div className="subtitle">
        Control metrics visualization for L/S/A/R and integrated difficulty score.
      </div>

      <div className="panel compare">
        <h2>Problem Comparison</h2>
        <div className="compare-grid">
          <div>
            <div className="compare-title">Target Problem (Baseline)</div>
            <div className="compare-block">
              <div className="compare-label">Problem Text</div>
              <div className="compare-text">{baselineItem?.text || "--"}</div>
              <div className="compare-label">Correct Answer</div>
              <div className="compare-text">{baselineItem?.correct || "--"}</div>
              <div className="compare-label">Distractors</div>
              <ul className="compare-list">
                {baselineItem
                  ? baselineItem.distractors.map((d) => <li key={d}>{d}</li>)
                  : "--"}
              </ul>
            </div>
          </div>
          <div>
            <div className="compare-title">Generated Problem (Current)</div>
            <div className="compare-block">
              <div className="compare-label">Problem Text</div>
              <div className="compare-text">{text}</div>
              <div className="compare-label">Correct Answer</div>
              <div className="compare-text">{correct}</div>
              <div className="compare-label">Distractors</div>
              <ul className="compare-list">
                {distractors
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((d) => (
                    <li key={d}>{d}</li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Input</h2>
          <label>Problem Text</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />

          <label>Correct Answer</label>
          <input value={correct} onChange={(e) => setCorrect(e.target.value)} />

          <label>Distractors (one per line)</label>
          <textarea value={distractors} onChange={(e) => setDistractors(e.target.value)} />

          <div className="row">
            <div>
              <label>Reasoning Steps</label>
              <input
                type="number"
                min={0}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </div>
            <div>
              <label>API Base</label>
              <input value={apiBase} disabled />
            </div>
          </div>

          <div className="actions">
            <button onClick={handleCalculate} disabled={loading}>
              {loading ? "Calculating..." : "Calculate"}
            </button>
            <span className="muted">
              Hits: <code>/difficulty/overall</code> + <code>/difficulty/weights</code>
            </span>
          </div>
          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="panel">
          <h2>Compliance Dashboard</h2>
          <div className="summary">
            <div className={`summary-card ${result ? distanceStatus : ""}`}>
              <div className="label">Compliance</div>
              <div className="value">
                {result ? complianceLabel(distanceStatus) : "--"}
              </div>
              <div className="meta">Distance thresholds: ≤0.05 / 0.15</div>
            </div>
            <div className="summary-card">
              <div className="label">Target D</div>
              <div className="value">{result ? DTarget.toFixed(3) : "--"}</div>
              <div className="meta">
                Target source: baseline set {baselineCount ? `(${baselineCount} items)` : "(loading)"}
              </div>
            </div>
            <div className="summary-card">
              <div className="label">Current D</div>
              <div className="value">{result ? DCurrent.toFixed(3) : "--"}</div>
              <div className="meta">D Δ {result ? formatDelta(DDelta) : "--"}</div>
            </div>
            <div className="summary-card">
              <div className="label">Distance</div>
              <div className="value">{result ? distance.toFixed(3) : "--"}</div>
              <div className="meta">Weighted L2 across L/S/A/R</div>
            </div>
          </div>

          <div className="table">
            <div className="row header">
              <div>Axis</div>
              <div>Target</div>
              <div>Current</div>
              <div>Δ</div>
              <div>Status</div>
            </div>
            {[
              { key: "L", target: targetProfile.L, current: current.L, delta: deltas.L, status: LCompliance },
              { key: "S", target: targetProfile.S, current: current.S, delta: deltas.S, status: SCompliance },
              { key: "A", target: targetProfile.A, current: current.A, delta: deltas.A, status: ACompliance },
              { key: "R", target: targetProfile.R, current: current.R, delta: deltas.R, status: RCompliance },
            ].map((row) => (
              <div className="row" key={row.key}>
                <div className="axis">{row.key}</div>
                <div>{result && target ? row.target.toFixed(3) : "--"}</div>
                <div>{result ? row.current.toFixed(3) : "--"}</div>
                <div>{result && target ? formatDelta(row.delta) : "--"}</div>
                <div>
                  <span className={`badge ${result ? row.status : ""}`}>
                    {result ? complianceLabel(row.status) : "--"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="chart" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div>
                <div className="muted">Current</div>
                <RadarChart data={current} />
              </div>
              <div>
                <div className="muted">Target</div>
                <RadarChart data={targetProfile} />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
              <div className="muted">Weights</div>
              <div className="weights">
                <div>L: {weights ? toPercent(weights.wL) : "--"}</div>
                <div>S: {weights ? toPercent(weights.wS) : "--"}</div>
                <div>A: {weights ? toPercent(weights.wA) : "--"}</div>
                <div>R: {weights ? toPercent(weights.wR) : "--"}</div>
              </div>
            </div>

          <div style={{ marginTop: 16 }}>
            <div className="muted">Target Profile</div>
            <div className="weights">
              <div>L: {target ? target.L.toFixed(2) : "--"}</div>
              <div>S: {target ? target.S.toFixed(2) : "--"}</div>
              <div>A: {target ? target.A.toFixed(2) : "--"}</div>
              <div>R: {target ? target.R.toFixed(2) : "--"}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="muted">Δ (Current - Target)</div>
            <div className="weights">
              <div>L: {result && target ? formatDelta(deltas.L) : "--"}</div>
              <div>S: {result && target ? formatDelta(deltas.S) : "--"}</div>
              <div>A: {result && target ? formatDelta(deltas.A) : "--"}</div>
              <div>R: {result && target ? formatDelta(deltas.R) : "--"}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="muted">Adjustment Suggestions</div>
            <div className="weights">
              {result
                ? suggestions.length
                  ? suggestions.map((s) => <div key={s}>{s}</div>)
                  : "On target."
                : "--"}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
