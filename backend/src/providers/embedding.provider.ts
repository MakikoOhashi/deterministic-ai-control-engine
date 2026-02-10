export interface EmbeddingProvider {
  embedText(text: string, dimension?: number): Promise<number[]>;
  embedTexts(texts: string[], dimension?: number): Promise<number[][]>;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  if (norm === 0) return vec;
  const scale = 1 / Math.sqrt(norm);
  return vec.map((v) => v * scale);
}

export class DummyEmbeddingProvider implements EmbeddingProvider {
  async embedText(text: string, dimension = 8): Promise<number[]> {
    const seed = fnv1a32(text.trim().toLowerCase());
    const rand = lcg(seed);
    const vec = new Array<number>(dimension);
    for (let i = 0; i < dimension; i += 1) {
      vec[i] = rand() * 2 - 1;
    }
    return normalize(vec);
  }

  async embedTexts(texts: string[], dimension = 8): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embedText(t, dimension)));
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model.replace(/^models\//, "");
  }

  async embedText(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Gemini embedContent failed: ${msg}`);
    }
    const data = (await res.json()) as { embedding?: { values: number[] } };
    if (!data.embedding?.values) {
      throw new Error("Gemini embedContent returned no embedding.");
    }
    return data.embedding.values;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
        })),
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Gemini batchEmbedContents failed: ${msg}`);
    }
    const data = (await res.json()) as { embeddings?: { values: number[] }[] };
    if (!data.embeddings || data.embeddings.length === 0) {
      throw new Error("Gemini batchEmbedContents returned no embeddings.");
    }
    return data.embeddings.map((e) => e.values);
  }
}

export function embedTextDummy(text: string, dimension = 8): number[] {
  const seed = fnv1a32(text.trim().toLowerCase());
  const rand = lcg(seed);
  const vec = new Array<number>(dimension);
  for (let i = 0; i < dimension; i += 1) {
    vec[i] = rand() * 2 - 1;
  }
  return normalize(vec);
}

export function embedTextsDummy(texts: string[], dimension = 8): number[][] {
  return texts.map((t) => embedTextDummy(t, dimension));
}
