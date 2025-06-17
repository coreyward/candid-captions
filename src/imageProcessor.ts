import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

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
): Promise<Record<string, any>> {
  try {
    const { stdout } = await execFileAsync("/opt/homebrew/bin/exiftool", [
      "-j",
      imagePath,
    ]);
    const metadata = JSON.parse(stdout);
    return metadata[0] || {};
  } catch (error) {
    console.error("Error reading metadata:", error);
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
    const stderr = (error as any).stderr || "";
    throw new Error(
      `Failed to write caption to image: ${errorMessage}${stderr ? `\nDetails: ${stderr}` : ""}`
    );
  }
}
