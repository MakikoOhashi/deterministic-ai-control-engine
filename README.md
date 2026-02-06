# Deterministic AI Control Engine

## 概要

本プロジェクトは、LLM（大規模言語モデル）を単なるテキスト生成器ではなく、**制御可能な生成エンジンとして扱うための制御インフラ**を実装する実証プロジェクトである。

対象領域はDuolingo English Test形式の問題生成だが、本質は教育アプリではない。

目的は以下である：

* 生成の再現性を高める
* 難易度を定量化する
* 類似問題の重複を数学的に排除する
* セッション体験のドリフトを検出する

---

## 設計思想

### 1. LLMは「候補生成器」に過ぎない

生成そのものはLLMが行うが、採用可否は制御エンジンが判断する。

生成と制御を明確に分離する。

```
LLM → 候補生成
Control Engine → 制御・検証・評価
```

---

### 2. Provider非依存設計

LLMは抽象化レイヤーを介して接続する。

```
/providers
  gradient.provider.ts
  openai.provider.ts
```

将来的に：

* DigitalOcean Gradient
* OpenAI
* 自前モデル
* 他クラウド

いずれに変更しても制御ロジックは変更不要。

---

### 3. 制御レイヤー構造

#### ① Semantic Guardrail（類似度制御）

* Embedding生成
* pgvector保存
* cosine similarity検索
* 閾値超過時は再生成

目的：問題の重複を確率ではなく数値で制御する。

---

#### ② Difficulty Quantification（難易度定量化）

難易度をLLM評価に依存しない。

指標例：

* 文長
* 構文深度
* 選択肢間semantic距離
* 推論段階数

出力：

```
difficultyScore = weighted composite metric
```

---

#### ③ Session Drift Detection（体験ドリフト）

セッション単位で：

* 正答率変動
* 回答時間標準偏差
* トピック偏り

出力：

```
driftIndex
```

目的：飽き・詰まり・難易度不整合の検出。

---

## アーキテクチャ

```
[ Next.js UI ]
        ↓
[ REST API Layer ]
        ↓
[ Control Engine ]
        ↓
[ LLM Provider Layer ]
        ↓
[ LLM Inference ]
        
[ PostgreSQL + pgvector ]
```

---

## 技術スタック

### Backend

* Node.js
* TypeScript (ESM)
* Express
* Prisma
* PostgreSQL + pgvector

### Frontend

* Next.js
* Control Metrics Visualization

### Infrastructure

* DigitalOcean App Platform
* DigitalOcean Managed PostgreSQL
* DigitalOcean Gradient Inference

---

## ディレクトリ構造

```
/backend
  /src
    /controllers
    /services
    /providers
    /routes
    index.ts

/frontend
/docker
```

---

## 設計手順（開発プロセス）

1. ベクトル保存と類似検索の実装
2. 類似度閾値制御ループの完成
3. 問題生成API完成
4. 難易度算出ロジック追加
5. ドリフト検出実装
6. UIで制御メトリクス可視化
7. LLMをGradientへ切替
8. DO環境へデプロイ

---

## このプロジェクトが解決する問題

従来のLLM活用型教育アプリは：

* 生成が不安定
* 難易度が曖昧
* 問題が重複する
* セッション体験が制御不能

本プロジェクトは、「生成AIを制御可能なシステムへ変換する」ことを目的とする。

---

## 拡張可能性

本設計は以下に応用可能：

* 医療QA生成制御
* 法律問題生成制御
* 企業研修AI制御
* SaaS型Adaptive Testing Engine

---

## 非目標（Out of Scope）

* UIの高度化
* 本格的な課金機能
* 完全適応型試験エンジン

本プロジェクトは「制御インフラの実証」に集中する。