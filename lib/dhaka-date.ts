export function getDhakaDate(dayOffset = 0): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const now = new Date();
  const dhakaParts = formatter.formatToParts(now);
  const year = Number(dhakaParts.find((part) => part.type === "year")?.value);
  const month = Number(dhakaParts.find((part) => part.type === "month")?.value);
  const day = Number(dhakaParts.find((part) => part.type === "day")?.value);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

