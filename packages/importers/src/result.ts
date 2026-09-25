export interface ImportResult {
  created: number;
  /** Already in the library (same URL, same file, same source path or id). */
  skipped: number;
  failed: { source: string; error: string }[];
}

export const emptyResult = (): ImportResult => ({ created: 0, skipped: 0, failed: [] });

export function record(result: ImportResult, source: string, attempt: () => boolean): void {
  try {
    if (attempt()) result.created++;
    else result.skipped++;
  } catch (error) {
    result.failed.push({ source, error: (error as Error).message });
  }
}
