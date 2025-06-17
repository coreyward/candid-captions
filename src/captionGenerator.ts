import { heredoc } from "heredoc-ts";
import OpenAI from "openai";
import { z } from "zod/v4";

const ResponseSchema = z.object({
  caption: z.string(),
});

export type CaptionResponse = z.infer<typeof ResponseSchema>;

export class CaptionGenerator {
  private openai: OpenAI;
  private prompt: string;

  constructor(apiKey: string, customPrompt?: string) {
    this.openai = new OpenAI({ apiKey });
    this.prompt =
      customPrompt ||
      heredoc`
        Write a brief caption for this photo. Be specific and include terms that might be useful for search later while still writing it in a natural voice. It should help tell the story of the photo. Avoid inferring too much—if you're not confident in a specific action, don't hypothesize in the output, just include what you are reasonably confident of. Output only the caption, nothing else.
      `;
  }

  async generateCaption(
    imageBuffer: Buffer,
    existingMetadata?: { caption?: string; tags?: string[] }
  ): Promise<CaptionResponse> {
    try {
      const base64Image = imageBuffer.toString("base64");

      let enhancedPrompt = this.prompt;
      if (existingMetadata && (existingMetadata.caption || (existingMetadata.tags && existingMetadata.tags.length > 0))) {
        const contextParts: string[] = [];
        if (existingMetadata.caption) {
          contextParts.push(`EXIF Caption: "${existingMetadata.caption}"`);
        }
        if (existingMetadata.tags && existingMetadata.tags.length > 0) {
          contextParts.push(
            `EXIF Keywords: ${existingMetadata.tags.join(", ")}`
          );
        }
        if (contextParts.length > 0) {
          enhancedPrompt = heredoc`
            ${this.prompt} Use the image metadata to inform your caption.

            Image metadata: """
            ${contextParts.join("\n")}
            """

            Try to include any names from the metadata in your caption, but be careful not to infer too much.
          `;
        }
      }

      const response = await this.openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: enhancedPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: "auto",
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No caption generated");
      }

      return {
        caption: content.trim(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate caption: ${errorMessage}`);
    }
  }
}
