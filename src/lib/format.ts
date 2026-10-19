// Display formatting. Times are stored in UTC and shown in Africa/Lagos. Unknown stays unknown.
import type { ValueScale } from "./indicators";

const TZ = "Africa/Lagos";

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: Date | string | null | undefined): string {
  const d = toDate(v);
  return d ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d) : "—";
}

export function formatDateTime(v: Date | string | null | undefined): string {
  const d = toDate(v);
  return d
    ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) + " WAT"
    : "—";
}

/** A calendar date (no time zone) such as a due date or period boundary. */
export function formatCalendarDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(Date.UTC(y, m - 1, d));
}

const SCALE_WORD: Record<ValueScale, string> = { units: "", thousands: " thousand", millions: " million", billions: " billion" };

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * A stored decimal written for reading: integer digits grouped with commas, every stored fraction
 * digit kept ("4250.50" → "4,250.50"). Works on the text, never through a float, so the figure
 * shown is the figure stored. null when the input is not a plain decimal.
 */
export function groupDecimal(value: string | number): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // A number already went through a float (e.g. JSON); write it out in full, not as 1e+21.
    text = /e/i.test(String(value))
      ? new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 20 }).format(value)
      : String(value);
  } else {
    text = value.trim();
  }
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  const int = m[2].replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+$)/g, ",");
  return `${m[1]}${int}${m[3] !== undefined ? `.${m[3]}` : ""}`;
}

/** Shows the amount exactly as stored with its scale kept explicit. null → "Not stated". */
export function formatAmount(amount: string | number | null | undefined, scale: ValueScale | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "Not stated";
  const num = groupDecimal(amount);
  if (num === null) return String(amount);
  const sym = currency === "NGN" ? "₦" : currency ? `${currency} ` : "";
  return `${sym}${num}${scale ? SCALE_WORD[scale] : ""}`;
}

export function formatCount(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "Not stated";
  const v = Number(n);
  return Number.isFinite(v) ? new Intl.NumberFormat("en-NG").format(v) : "Not stated";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
