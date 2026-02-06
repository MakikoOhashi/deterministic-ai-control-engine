import type { EmbeddingProvider } from "./embedding.provider.js";

export interface OpenAIEmbeddingProviderOptions {
  apiKey: string;
  model: string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  embedText(_text: string, _dimension = 8): number[] {
    throw new Error("OpenAIEmbeddingProvider.embedText is not implemented.");
  }

  embedTexts(_texts: string[], _dimension = 8): number[][] {
    throw new Error("OpenAIEmbeddingProvider.embedTexts is not implemented.");
  }
}
