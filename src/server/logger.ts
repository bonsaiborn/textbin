export type LogDetailValue = string | number | boolean | null | undefined;

const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[90m";

function now(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", " UTC");
}

function clean(value: LogDetailValue): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function formatDetails(details: Record<string, LogDetailValue>): string {
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${clean(value)}`);

  return parts.length > 0 ? ` | ${parts.join(" ")}` : "";
}

export function logInfo(event: string, details: Record<string, LogDetailValue> = {}): void {
  console.log(`${DIM}[${now()}]${RESET} ${CYAN}INFO${RESET} ${event}${formatDetails(details)}`);
}

export function logWarn(event: string, details: Record<string, LogDetailValue> = {}): void {
  console.warn(`${DIM}[${now()}]${RESET} ${YELLOW}WARN${RESET} ${event}${formatDetails(details)}`);
}

export function logError(event: string, details: Record<string, LogDetailValue> = {}): void {
  console.error(`${DIM}[${now()}]${RESET} ${RED}ERROR${RESET} ${event}${formatDetails(details)}`);
}
