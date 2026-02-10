"use client";

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

type ComplianceLevel = "within" | "minor" | "out";

function complianceLabel(level: ComplianceLevel) {
  if (level === "within") return "Within target";
  if (level === "minor") return "Minor deviation";
  return "Out of range";
}

function complianceLevel(deltaValue: number, tol: number) {
  const abs = Math.abs(deltaValue);
  if (abs <= tol) return "within";
  if (abs <= tol * 2) return "minor";
  return "out";
}

function formatDelta(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}`;
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

function distanceCompliance(distanceValue: number, tol: number) {
  if (distanceValue <= tol) return "within";
  if (distanceValue <= tol * 3) return "minor";
  return "out";
}

export default function QualityConsole(props: {
  result: OverallResponse | null;
  target: Components | null;
  weights: Weights | null;
  effectiveTolerance: number;
  stability: string | null;
  similarity?: number | null;
  similarityBreakdown?: {
    passage: number | null;
    question: number | null;
    correctChoice: number | null;
    distractors: number | null;
    choices: number | null;
  } | null;
  choiceIntent?: { concept: string; patterns: string[] } | null;
  error?: string | null;
}) {
  const {
    result,
    target,
    weights,
    effectiveTolerance,
    stability,
    similarity,
    similarityBreakdown,
    choiceIntent,
    error,
  } = props;

  const current = result?.components || { L: 0, S: 0, A: 0, R: 0 };
  const targetProfile = target || { L: 0, S: 0, A: 0, R: 0 };
  const w = weights || { wL: 0.2, wS: 0.2, wA: 0.3, wR: 0.3 };

  const deltas = {
    L: current.L - targetProfile.L,
    S: current.S - targetProfile.S,
    A: current.A - targetProfile.A,
    R: current.R - targetProfile.R,
  };

  const DCurrent = result?.D ?? 0;
  const DTarget = result
    ? targetProfile.L * w.wL +
      targetProfile.S * w.wS +
      targetProfile.A * w.wA +
      targetProfile.R * w.wR
    : 0;

  const distance = result && target ? distanceScore(current, targetProfile, w) : 0;
  const distanceStatus = result ? distanceCompliance(distance, effectiveTolerance) : "within";

  return (
    <details className="quality-fold" open>
      <summary>Difficulty Stability Console</summary>
      <div className="audit-block">
        <div className={`compliance-badge ${result ? distanceStatus : ""}`}>
          {result ? complianceLabel(distanceStatus) : "--"}
        </div>

        <div className="summary compact">
          <div className="summary-card">
            <div className="label">Target D</div>
            <div className="value">{result ? DTarget.toFixed(3) : "--"}</div>
          </div>
          <div className="summary-card">
            <div className="label">Current D</div>
            <div className="value">{result ? DCurrent.toFixed(3) : "--"}</div>
          </div>
          <div className="summary-card">
            <div className="label">Distance</div>
            <div className="value">{result ? distance.toFixed(3) : "--"}</div>
          </div>
          <div className="summary-card">
            <div className="label">Stability</div>
            <div className="value">{stability || "--"}</div>
          </div>
          <div className="summary-card">
            <div className="label">Similarity</div>
            <div className="value">
              {typeof similarity === "number" ? similarity.toFixed(3) : "--"}
            </div>
          </div>
        </div>

        {similarityBreakdown ? (
          <div className="table compact">
            <div className="row header">
              <div>Similarity</div>
              <div>Value</div>
              <div></div>
              <div></div>
              <div></div>
            </div>
            {[
              { key: "Passage", value: similarityBreakdown.passage },
              { key: "Question", value: similarityBreakdown.question },
              { key: "Correct", value: similarityBreakdown.correctChoice },
              { key: "Distractors", value: similarityBreakdown.distractors },
              { key: "Choices", value: similarityBreakdown.choices },
            ].map((row) => (
              <div className="row" key={row.key}>
                <div className="axis">{row.key}</div>
                <div>{typeof row.value === "number" ? row.value.toFixed(3) : "--"}</div>
                <div></div>
                <div></div>
                <div></div>
              </div>
            ))}
          </div>
        ) : null}

        {choiceIntent ? (
          <div className="summary-card" style={{ marginTop: 12 }}>
            <div className="label">Choice Intent</div>
            <div className="value" style={{ fontSize: 14 }}>
              {choiceIntent.concept}
            </div>
            <div className="meta">
              {choiceIntent.patterns.join(" • ")}
            </div>
          </div>
        ) : null}

        <div className="table compact">
          <div className="row header">
            <div>Axis</div>
            <div>Target</div>
            <div>Current</div>
            <div>Δ</div>
            <div>Status</div>
          </div>
          {[
            { key: "L", target: targetProfile.L, current: current.L, delta: deltas.L },
            { key: "S", target: targetProfile.S, current: current.S, delta: deltas.S },
            { key: "A", target: targetProfile.A, current: current.A, delta: deltas.A },
            { key: "R", target: targetProfile.R, current: current.R, delta: deltas.R },
          ].map((row) => {
            const status = complianceLevel(row.delta, effectiveTolerance);
            return (
              <div className="row" key={row.key}>
                <div className="axis">{row.key}</div>
                <div>{result && target ? row.target.toFixed(3) : "--"}</div>
                <div>{result ? row.current.toFixed(3) : "--"}</div>
                <div>{result && target ? formatDelta(row.delta) : "--"}</div>
                <div>
                  <span className={`badge ${result ? status : ""}`}>
                    {result ? complianceLabel(status) : "--"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {error ? <div className="error">{error}</div> : null}
      </div>
    </details>
  );
}
