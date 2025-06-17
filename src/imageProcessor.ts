import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod/v4";

const execFileAsync = promisify(execFile);

const ExifMetadataSchema = z
  .object({
    "Caption-Abstract": z.string().optional(),
    Description: z.string().optional(),
    ImageDescription: z.string().optional(),
    Keywords: z.union([z.string(), z.array(z.string())]).optional(),
    Subject: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .loose();

export type ExifMetadata = z.infer<typeof ExifMetadataSchema>;

export async function resizeImage(
  inputPath: string,
  maxDimension: number = 1248
): Promise<Buffer> {
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to get image dimensions");
  }

  const resizeOptions: sharp.ResizeOptions = {
    fit: "inside",
    withoutEnlargement: true,
  };

  if (metadata.width > maxDimension || metadata.height > maxDimension) {
    resizeOptions.width = maxDimension;
    resizeOptions.height = maxDimension;
  }

  return image.resize(resizeOptions).jpeg({ quality: 70 }).toBuffer();
}

export async function stripMetadata(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).toBuffer();
}

export async function readImageMetadata(
  imagePath: string
): Promise<ExifMetadata> {
  try {
    const { stdout } = await execFileAsync("/opt/homebrew/bin/exiftool", [
      "-j",
      imagePath,
    ]);
    const rawMetadata = JSON.parse(stdout) as unknown[];
    const metadata = ExifMetadataSchema.parse(rawMetadata[0] ?? {});
    return metadata;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Invalid metadata format:", z.prettifyError(error));
    } else {
      console.error("Error reading metadata:", error);
    }
    return {};
  }
}

export async function writeCaption(
  imagePath: string,
  caption: string
): Promise<void> {
  const outputPath = path.join(
    path.dirname(imagePath),
    "..",
    "output",
    path.basename(imagePath)
  );

  try {
    await execFileAsync("/opt/homebrew/bin/exiftool", [
      "-overwrite_original",
      `-Caption-Abstract=${caption}`,
      `-Description=${caption}`,
      `-ImageDescription=${caption}`,
      imagePath,
      "-o",
      outputPath,
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stderr = (error as Error & { stderr?: string }).stderr ?? "";
    throw new Error(
      `Failed to write caption to image: ${errorMessage}${stderr ? `\nDetails: ${stderr}` : ""}`
    );
  }
}
