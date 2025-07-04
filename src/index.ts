import fs from "node:fs/promises";
import path from "node:path";
import { createSpinner, type Spinner } from "nanospinner";
import "dotenv/config";
import { z } from "zod/v4";
import {
  resizeImage,
  stripMetadata,
  writeCaption,
  readImageMetadata,
} from "./imageProcessor.js";
import { CaptionGenerator } from "./captionGenerator.js";
import { ParallelProcessor } from "./parallelProcessor.js";
import { Logger } from "./logger.js";

const INPUT_DIR = path.join(process.cwd(), "input");
const OUTPUT_DIR = path.join(process.cwd(), "output");
const CONCURRENCY = z.coerce
  .number()
  .int()
  .optional()
  .default(4)
  .parse(process.env.CONCURRENCY);

async function findJpegFiles(): Promise<string[]> {
  try {
    const files = await fs.readdir(INPUT_DIR);
    return files
      .filter((file) => /\.(jpg|jpeg)$/i.test(file))
      .map((file) => path.join(INPUT_DIR, file));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Input directory not found. Please create: ${INPUT_DIR}`);
    }
    throw error;
  }
}

type ProcessImageResult = {
  imagePath: string;
  caption: string;
  processingTime: number;
  metadata?: {
    existingCaption?: string;
    existingTags?: string[];
  };
};

type ProcessImageError = {
  imagePath: string;
  error: string;
  processingTime: number;
};

async function processImage(
  imagePath: string,
  captionGenerator: CaptionGenerator,
  spinner: Spinner
): Promise<ProcessImageResult> {
  const startTime = Date.now();
  const fileName = path.basename(imagePath);

  try {
    spinner.update({ text: `Processing ${fileName}...` });

    // Read existing metadata
    const metadata = await readImageMetadata(imagePath);
    const existingCaption =
      metadata["Caption-Abstract"] ??
      metadata.Description ??
      metadata.ImageDescription;
    const existingTags = metadata.Keywords ?? metadata.Subject;

    const existingMetadata: { caption?: string; tags?: string[] } = {};
    if (existingCaption) {
      existingMetadata.caption = existingCaption;
    }
    if (existingTags) {
      existingMetadata.tags = Array.isArray(existingTags)
        ? existingTags
        : [existingTags];
    }

    // Resize and strip metadata for API
    const resizedBuffer = await resizeImage(imagePath);
    const strippedBuffer = await stripMetadata(resizedBuffer);

    // Generate caption
    spinner.update({ text: `Generating caption for ${fileName}...` });
    const { caption } = await captionGenerator.generateCaption(
      strippedBuffer,
      existingMetadata
    );

    // Write caption to metadata
    spinner.update({ text: `Writing caption for ${fileName}...` });
    await writeCaption(imagePath, caption);

    const processingTime = Date.now() - startTime;

    const resultMetadata: {
      existingCaption?: string;
      existingTags?: string[];
    } = {};
    if (existingMetadata.caption) {
      resultMetadata.existingCaption = existingMetadata.caption;
    }
    if (existingMetadata.tags) {
      resultMetadata.existingTags = existingMetadata.tags;
    }

    return {
      imagePath,
      caption,
      processingTime,
      metadata:
        Object.keys(resultMetadata).length > 0 ? resultMetadata : undefined,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\nError processing ${fileName}: ${errorMessage}`);
    throw new Error(
      JSON.stringify({
        imagePath,
        error: errorMessage,
        processingTime,
      })
    );
  }
}

async function main() {
  const spinner = createSpinner("Initializing...").start();

  try {
    // Check for API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    // Create output directory
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Find JPEG files
    spinner.update({ text: "Searching for JPEG files..." });
    const jpegFiles = await findJpegFiles();

    if (jpegFiles.length === 0) {
      spinner.warn({ text: "No JPEG files found in input directory" });
      return;
    }

    spinner.success({ text: `Found ${jpegFiles.length} JPEG files` });

    // Initialize components
    const captionGenerator = new CaptionGenerator(apiKey);
    const processor = new ParallelProcessor<string, ProcessImageResult>(
      CONCURRENCY
    );
    const logger = new Logger();

    // Process images
    const processSpinner = createSpinner(
      `Processing ${jpegFiles.length} images...`
    ).start();

    const results = await processor.process(jpegFiles, async (imagePath) =>
      processImage(imagePath, captionGenerator, processSpinner)
    );

    // Log results
    let successCount = 0;
    let errorCount = 0;

    for (const result of results) {
      if (result.result) {
        logger.log(result.result);
        successCount++;
      } else if (result.error) {
        try {
          const errorData = JSON.parse(
            result.error.message
          ) as ProcessImageError;
          logger.log({
            imagePath: errorData.imagePath,
            error: errorData.error,
            processingTime: errorData.processingTime,
          });
        } catch {
          logger.log({
            imagePath: result.item,
            error: result.error.message,
            processingTime: 0,
          });
        }
        errorCount++;
      }
    }

    processSpinner.success({
      text: `Processed ${successCount} images successfully${errorCount > 0 ? ` (${errorCount} failed)` : ""}`,
    });

    // Save logs
    await logger.save();

    // Show failed images if any
    if (errorCount > 0) {
      console.log("\nFailed images:");
      for (const result of results) {
        if (result.error) {
          try {
            const errorData = JSON.parse(
              result.error.message
            ) as ProcessImageError;
            const fileName = path.basename(errorData.imagePath);
            console.log(`  - ${fileName}: ${errorData.error}`);
          } catch {
            const fileName = path.basename(result.item);
            console.log(`  - ${fileName}: ${result.error.message}`);
          }
        }
      }
      console.log("\nCheck the log file for more details.");
    }
  } catch (error) {
    spinner.error({ text: (error as Error).message });
    process.exit(1);
  }
}

main().catch(console.error);
