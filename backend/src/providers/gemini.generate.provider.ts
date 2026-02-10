export interface TextGenerationProvider {
  generateText(prompt: string, system?: string): Promise<string>;
}

export class GeminiTextGenerationProvider implements TextGenerationProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model.replace(/^models\//, "");
  }

  async generateText(prompt: string, system?: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          system_instruction: system
            ? { parts: [{ text: system }] }
            : undefined,
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 120,
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Gemini generateContent returned no text.");
        }
        return text.trim();
      }
      if (res.status === 503 && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      const msg = await res.text();
      throw new Error(`Gemini generateContent failed: ${msg}`);
    }
    throw new Error("Gemini generateContent failed after retries.");
  }
}
