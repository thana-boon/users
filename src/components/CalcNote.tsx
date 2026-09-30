/**
 * A value worked out from what was typed — อายุ from วันเกิด, อายุงาน from
 * เดือน/ปีที่เข้าทำงาน — shown under the field as a tinted pill, so it reads as
 * "the system counted this for you", not as something to fill in.
 */
export function CalcNote({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <p className="calc-note" aria-live="polite">{text}</p>;
}
