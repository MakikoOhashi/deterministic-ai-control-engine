import type { TextGenerationProvider } from "./gemini.generate.provider.js";

type GradientChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function resolveCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function extractContent(data: GradientChatResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  throw new Error("Gradient chat completion returned no text.");
}

export class GradientTextGenerationProvider implements TextGenerationProvider {
  private apiKey: string;
  private model: string;
  private completionsUrl: string;

  constructor(apiKey: string, model: string, baseUrl = "https://api.gradient.ai/v1") {
    this.apiKey = apiKey;
    this.model = model;
    this.completionsUrl = resolveCompletionsUrl(baseUrl);
  }

  async generateText(prompt: string, system?: string): Promise<string> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const res = await fetch(this.completionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.7,
          max_tokens: 900,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as GradientChatResponse;
        return extractContent(data);
      }

      if ((res.status === 429 || res.status === 503) && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }

      const msg = await res.text();
      throw new Error(`Gradient chat completion failed: ${msg}`);
    }
    throw new Error("Gradient chat completion failed after retries.");
  }
}

