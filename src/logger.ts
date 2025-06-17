import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface LogEntry {
  timestamp: string;
  imagePath: string;
  caption?: string;
  error?: string;
  processingTime: number;
  metadata?: Record<string, any>;
}

export class Logger {
  private logs: LogEntry[] = [];
  private logPath: string;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logPath = path.join(
      process.cwd(),
      "logs",
      `caption-log-${timestamp}.json`
    );
  }

  async log(entry: Omit<LogEntry, "timestamp">): Promise<void> {
    this.logs.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  async save(): Promise<void> {
    const logDir = path.dirname(this.logPath);
    await mkdir(logDir, { recursive: true });

    const summary = {
      totalImages: this.logs.length,
      successful: this.logs.filter((log) => !log.error).length,
      failed: this.logs.filter((log) => log.error).length,
      averageProcessingTime:
        this.logs.reduce((sum, log) => sum + log.processingTime, 0) /
        this.logs.length,
      logs: this.logs,
    };

    await writeFile(this.logPath, JSON.stringify(summary, null, 2));
    console.log(`Log saved to: ${this.logPath}`);
  }
}
