# Difficulty Evaluation-Guided Generation Engine

## 概要
本プロジェクトは、英語学習向け問題を **LLM生成 + 評価関数** で安定化する実験実装です。  
主眼は「問題生成」そのものではなく、**生成物の採否を評価で決めること**です。

- 固有試験ブランドには依存しない
- 画像入力（OCR/Vision）とテキスト入力の両方を扱う
- 難易度を L/S/A/R/D で定量化
- 類似度・形式・再利用語チェックで不適切生成を reject

---

## 現在の対応タスク
- `Context Completion`（空欄補充）
- `Guided Reading`（短文読解 + 選択肢）

> `Mode B (Concept Preservation)` は将来拡張として設計のみ。v1の主軸は `Mode A`。

---

## コア設計

### Evaluation-first
LLMは候補生成器。最終採用は評価側で決定。

1. 生成（Generate）
2. 検証（Format / Similarity / Difficulty / Reuse）
3. 採用 or Reject

### payload / debug 分離
`/ocr/structure` は以下を分離して返します。

- `payload`: 生成に必要な最小情報（本番利用）
- `debug`: 生OCR/整形結果などの観測情報（監査・開発用）

これにより「どの中間表現を正とするか」の混乱を避けます。

---

## Pipeline（現行）

```mermaid
flowchart TD
  A["User Upload or Paste"] --> B["OCR + Vision"]
  B --> C["ocr_structure"]
  C --> C1["payload"]
  C --> C2["debug"]
  C1 --> D["target_from_sources"]
  D --> E["target mean + targetBand + axisTolerance"]
  E --> F["generate_fill_blank or generate_mc"]
  F --> G["Format Validation"]
  G --> H["Similarity + Difficulty Distance + Reuse Check"]
  H -->|pass| I["Return Generated Item"]
  H -->|fail| J["Repair or Reject"]
```

---

## Context Completion フロー（詳細）

### Step A
空欄なしの全文を生成（LLM）

### Step B
その全文から空欄にする語を選定（LLM, JSON）

### Step C
空欄化はコード側で決定論的に実施

- prefixあり/なしを保持
- blank長は実語長から算出

### Step D
評価関数で採否判定

- format
- similarity / jaccard
- difficulty distance
- source answer reuse

---

## Difficulty モデル

### 軸
- `L`: Lexical Complexity
- `S`: Structural Complexity
- `A`: Semantic Ambiguity
- `R`: Reasoning Depth

### 統合
`D = 0.20L + 0.20S + 0.30A + 0.30R`

### Target の扱い
`/target/from-sources` は以下を返却:

- `mean`
- `std`
- `axisTolerance`
- `targetBand(min/max)`
- `effectiveTolerance`
- `stability`

`count=1` の場合は点推定ではなく **帯（range）重視** で判定します。

---

## 主な API

### 入力解析
- `POST /ocr/extract` 画像OCR
- `POST /vision/extract-slots` 画像から slot 構造抽出
- `POST /ocr/structure` payload/debug 分離構造化

### ターゲット計算
- `POST /target/from-sources`（Context Completion）
- `POST /target/from-sources-mc`（Guided Reading）

### 生成
- `POST /generate/fill-blank`
- `POST /generate/mc`

### 評価
- `POST /difficulty/overall`
- `GET /difficulty/weights`

---

## 主要レスポンス例

### `/ocr/structure`（抜粋）
```json
{
  "payload": {
    "taskType": "context_completion",
    "format": "prefix_blank",
    "displayText": "... fa__ ...",
    "sourceAnswerKey": ["fail"],
    "slotCount": 1,
    "slots": [{ "prefix": "fa", "missingCount": 2, "slotConfidence": 0.82 }],
    "textFeatures": { "wordCount": 48, "textLengthBucket": "short", "cefr": "B2", "lexical": 0.31, "structural": 0.28 }
  },
  "debug": {
    "rawOcrText": "...",
    "aiNormalizedText": "...",
    "normalizedText": "..."
  }
}
```

### `/generate/fill-blank`（抜粋）
```json
{
  "item": { "text": "... fa__ ...", "correct": "fame" },
  "answers": ["fame"],
  "similarity": 0.72,
  "jaccard": 0.22,
  "runId": "...",
  "sourceId": "...",
  "candidateId": "...",
  "debug": { "stage": "accepted" }
}
```

失敗時は:

```json
{
  "errorType": "VALIDATION_FAILED",
  "debug": {
    "stage": "validation_failed",
    "llmLastValidationReason": "Expected exactly 1 blank."
  }
}
```

---

## フロント実装方針（現行）

- 上段: 学習者向け操作（入力・生成・回答）
- 下段: `Difficulty Stability Console`（監査）

Console では以下を表示:
- Compliance
- Target D / Current D / Distance
- Target Range（L/S/A/R）
- Axis Table
- Similarity（必要時）
- `debug.stage`, `runId`, `sourceId`

---

## 制約（v1）

- OCR品質が極端に低い画像では slot抽出が不安定
- `Context Completion` は現在 1〜2 blanks を優先
- `Mode B` は未実装（READMEの将来計画）

---

## 技術スタック

### Backend
- Node.js / TypeScript / Express
- Embedding Provider（Dummy / Gemini）
- Gemini Text Generation Provider

### Frontend
- Next.js 14
- React + useState（軽量構成）

### Infra（想定）
- DigitalOcean App Platform
- Managed DB / Vector拡張（将来）

---

## 目的の再定義

本プロジェクトは「教育アプリUI」よりも、

**Evaluation-Guided Generation（評価設計駆動の生成制御）**

を実証するためのエンジンです。
