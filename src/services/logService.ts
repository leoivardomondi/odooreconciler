import { getRecentLogs, insertLog } from '../models/repositories';
import { LogEntry } from '../models/types';
import { sanitizeForLog } from '../utils/helpers';

export async function logEvent(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {},
  historyId?: string | null,
) {
  const sanitized = sanitizeForLog(context);
  await insertLog({
    historyId: historyId || null,
    level,
    message,
    context: sanitized,
  });

  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  logger(`[${level}] ${message}`, sanitized);
}

export function fetchRecentLogs(limit = 50, historyId?: string): LogEntry[] {
  throw new Error('fetchRecentLogs must be awaited via fetchRecentLogsAsync.');
}

export async function fetchRecentLogsAsync(limit = 50, historyId?: string): Promise<LogEntry[]> {
  return getRecentLogs(limit, historyId);
}
