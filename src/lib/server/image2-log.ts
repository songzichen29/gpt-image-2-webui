import fs from 'fs/promises';
import path from 'path';

const logDir = path.resolve(process.cwd(), '.logs');
const logFile = path.join(logDir, 'image2-runtime.log');

function serialize(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export async function writeImage2RuntimeLog(event: string, payload: Record<string, unknown>) {
    const line = `${new Date().toISOString()} ${event} ${serialize(payload)}\n`;
    try {
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logFile, line, 'utf8');
    } catch (error) {
        console.error('Failed to write image2 runtime log:', error);
    }
}
