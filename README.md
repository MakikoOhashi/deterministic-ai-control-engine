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

##### Difficulty Quantification Model 設計原則

本プロジェクトにおける難易度（difficulty）は主観評価ではなく、観測可能な構造的特徴量の合成指標として定義する。

難易度は以下4軸に分解される：

* Lexical Complexity（語彙難易度）
* Structural Complexity（構文深度）
* Semantic Ambiguity（選択肢の紛らわしさ）
* Reasoning Depth（推論段階数）

各指標は 0〜1 に正規化され、最終的に重み付き線形結合で統合される。

##### 正規化方針（0〜1スケール）

すべての指標は以下の Min-Max 正規化を使用する：

```
X_norm = (X - X_min) / (X_max - X_min)
```

設定方法

* 初期値は理論上想定される範囲で固定する
* 将来的には観測データ分布に基づき更新可能

例：

| 指標 | Xmin | Xmax |
| --- | --- | --- |
| 単語数 | 5 | 150 |
| 文数 | 1 | 10 |
| 推論段階 | 1 | 5 |

これにより difficultyScore は常に 0〜1 に収束する。

##### 各構成要素の理論整理

1. Lexical Complexity（L）

定義

* 単語数（word_count）
* 平均単語長（avg_word_length）

理論背景

語彙量と単語長は処理負荷と相関する。
短文かつ単純語彙は認知負荷が低い。

定義式

```
L = 0.5 * WC_norm + 0.5 * AWL_norm
```

均等重みの理由

* 同一の lexical axis に属する
* 相関はあるが完全一致しないため分離

2. Structural Complexity（S）

定義

* 文の数（sentence_count）
* 接続詞数（conjunction_count）
* 従属節指標（簡易：接続詞ベース）

理論背景

構文が深いほどワーキングメモリ負荷が増大する。

定義式

```
S = 0.6 * Clause_norm + 0.4 * Sentence_norm
```

重みの理由

* 従属節数は構文深度をより直接的に反映
* 文数は補助指標

3. Semantic Ambiguity（A）

定義

正解選択肢と誤答選択肢間の embedding 距離に基づく。

手順

* 各選択肢の embedding を生成
* 正解と各誤答の cosine similarity を算出
* 平均類似度を計算

```
A = (1 / n) * sum(cosine_similarity(correct, distractor_i))
```

解釈

* 類似度が高いほど紛らわしい
* 値はすでに 0〜1 範囲
* 正規化不要

理論的意義

Semantic距離が近いほど判別困難性が増す。
これは識別難易度の直接的代理指標である。

4. Reasoning Depth（R）

定義

問題解決に必要な推論ステップ数。

推定方法

* LLMに構造抽出のみ依頼（生成評価ではない）
* 「最小推論段階数」を出力させる
* 数値を正規化

推論段階定義

* 最短で正解に到達するために必要な推論の段数
* 事実抽出 → 結合 → 含意判定 などの連鎖を1段と数える

正規化式

```
R = min(steps / maxSteps, 1)
```

上限値の根拠

* 初期値は試験問題の設計想定レンジに合わせて `maxSteps = 5` とする
* 実データの分布に応じて将来的に更新可能

理論的意義

多段階推論は処理負荷増加と相関する。

将来NLP自動推定予定

##### 最終難易度スコア

```
Difficulty = 0.20L + 0.20S + 0.30A + 0.30R
```

重みの理論根拠

なぜ A/R を 0.30 とするか

本プロジェクトの中心思想は：

* LLM生成を制御可能にすること

Semantic Ambiguity / Reasoning Depth は：

* ベクトルDBを活用
* 数学的に再現可能
* 本プロジェクトの差別化要素

そのため難易度の中核として最も重い重みを与える。

なぜ L/S は 0.20 か

Lexical / Structural / Reasoning は：

* 認知負荷の異なる側面を測定
* 相互相関が存在する可能性がある
* 単独で支配的ではない

よって均等重みとする。

将来的に、ユーザー正答率やIRTパラメータに基づき重みを学習的に最適化する。

スコア特性

* 出力範囲：0〜1
* 0に近い → 易しい
* 1に近い → 難しい
* 再現可能
* LLM非依存
* 拡張可能性

将来的に：

* IRTパラメータ統合
* 実ユーザー正答率統合
* 動的重み最適化

が可能。

現段階では理論駆動型 difficulty model として実装する。

ここまでがREADME定義。

##### Target Profile（観測ベースライン）

Target profile is derived from internally constructed baseline assessment items (non-proprietary).
Each baseline item is evaluated to produce (L, S, A, R), and the target is the mean vector across items:

```
T = (1 / N) * sum(v_i), where v_i = (L_i, S_i, A_i, R_i)
```

This target is configurable and not tied to proprietary data.
将来的に学習データに基づいて更新可能とする。

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

## 現状整理（実装済み）

### 1. 生成フロー（Multiple Choice固定）

入力：

* ユーザーが貼った問題文（Passage + Question + Choices）
* Mode（A / B）
* Target profile（L/S/A/R）

処理：

1. **入力の正規化・パース**
   * 末尾の選択肢ブロックを検出し、Passage / Question / Choices に分解
   * 日本語の「ア〜エ + アイ/アウ…」形式を Combo として扱う
2. **Passage生成（Passageが存在する場合）**
   * Passageは別リクエストで生成し、**固定化して使用**
   * 生成が失敗した場合は、**元のPassageをフォールバック**として採用
3. **Question/Choices生成**
   * Mode A: 1候補
   * Mode B: 2候補
4. **検証**
   * フォーマット検証（Choice数、QuestionにChoiceが混入していないか）
   * Similarity/Jaccard閾値チェック
   * Mode Bでは **テーマ整合性（Semantic check）** と **キーワード保持** を実施
5. **採用**
   * 最初に条件を満たした候補を採用

---

### 2. Modeの定義

**Mode A（Cognitive Match）**

* トピックは変わっても良い
* 目的は難易度プロファイル（L/S/A/R）の一致
* 監査指標は「選択肢内部構造」が中心

**Mode B（Concept Preservation）**

* 同じ概念・論点を維持しながら言い換え
* テーマ逸脱を抑止するためのSemanticチェックを実施
* 選択肢意図（誤答パターン）を抽象化し再生成

---

### 3. Similarity分解（監査用）

Similarityは1つの数値ではなく以下に分解して計測：

* Passage similarity
* Question similarity
* Correct choice similarity
* Distractors similarity
* Overall choices similarity

Mode Aは **Choice Structure Score** を表示：

* 正答 vs 誤答距離
* 誤答同士の距離分散
* 正答の孤立度

---

### 4. UI（現状）

* Top: 入力 + Set Target + Generate
* Generated Question 表示
* Submit Answer / Run Audit
* 下部に折りたたみ式 **Difficulty Stability Console**
  * Difficulty指標（L/S/A/R/D）
  * Similarity breakdown
  * Mode別の監査指標

---

### 5. 既存API

* `POST /target/from-sources-mc`  
  Baseline問題から Target profile を算出（平均 + stability + tolerance）

* `POST /generate/mc`  
  Multiple Choice生成（Mode A/B）

* `POST /difficulty/overall`  
  L/S/A/R/D を算出

---

### 6. 現在の制限

* Mode Aは **トピック変更が前提**（能力測定型）
* Mode Bは **テーマ保持が前提**（専門知識型）
* Passage生成は長さ範囲に収まらない場合があるため、
  フォールバック（元Passage使用）を許容
* 多形式（Fill blank / constructed response）は現在対象外


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
