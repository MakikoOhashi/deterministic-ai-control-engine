"use client";

import QualityConsole from "./QualityConsole";

export default function QualityPage() {
  return (
    <main className="quality">
      <h1>Stable Difficulty Generation Engine</h1>
      <div className="subtitle">
        Control-grade difficulty consistency for AI-generated assessments.
      </div>
      <div className="muted" style={{ marginBottom: 16 }}>
        <a className="link" href="/">
          Back to Home
        </a>
      </div>

      <div className="panel">
        <h2>Difficulty Control Console</h2>
        <QualityConsole
          result={null}
          target={null}
          weights={null}
          effectiveTolerance={0.05}
          stability={null}
        />
      </div>
    </main>
  );
}
