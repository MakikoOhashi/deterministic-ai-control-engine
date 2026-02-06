export interface EmbeddingProvider {
  embedText(text: string, dimension?: number): number[];
  embedTexts(texts: string[], dimension?: number): number[][];
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
  embedText(text: string, dimension = 8): number[] {
    const seed = fnv1a32(text.trim().toLowerCase());
    const rand = lcg(seed);
    const vec = new Array<number>(dimension);
    for (let i = 0; i < dimension; i += 1) {
      vec[i] = rand() * 2 - 1;
    }
    return normalize(vec);
  }

  embedTexts(texts: string[], dimension = 8): number[][] {
    return texts.map((t) => this.embedText(t, dimension));
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
