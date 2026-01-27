export function nowToTimeParts(nowMs: number, timeZone: string): { dow: string; hhmm: string } {
  // Dow: mon/tue/...
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(nowMs));
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "Mon";
  const hour = parts.find(p => p.type === "hour")?.value ?? "00";
  const minute = parts.find(p => p.type === "minute")?.value ?? "00";

  const dow = weekday.toLowerCase().slice(0, 3); // "mon"
  return { dow, hhmm: `${hour}:${minute}` };
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  const hh = Number(h);
  const mm = Number(m);
  return hh * 60 + mm;
}
