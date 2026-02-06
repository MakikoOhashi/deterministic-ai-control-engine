export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    throw new Error("Vectors must be non-empty.");
  }
  if (a.length !== b.length) {
    throw new Error("Vectors must be the same length.");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    throw new Error("Vectors must have non-zero magnitude.");
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
