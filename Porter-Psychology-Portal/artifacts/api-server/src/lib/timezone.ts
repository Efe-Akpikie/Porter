export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

export function assertTimeZone(timeZone: string) {
  formatter(timeZone).format(new Date());
  return timeZone;
}

export function getZonedParts(
  value: Date | string,
  timeZone: string,
): ZonedDateParts {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetAt(instant: Date, timeZone: string) {
  const part = getZonedParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour,
    part.minute,
    part.second,
  );
  return representedAsUtc - instant.getTime();
}

export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = localAsUtc - offsetAt(new Date(localAsUtc), timeZone);
  result = localAsUtc - offsetAt(new Date(result), timeZone);
  return new Date(result);
}

export function zonedDateKey(value: Date | string, timeZone: string) {
  const part = getZonedParts(value, timeZone);
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

export function weekdayForDate(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function timeWindowForInstant(value: Date | string, timeZone: string) {
  const hour = getZonedParts(value, timeZone).hour;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function localDayBounds(date: string, timeZone: string) {
  const start = zonedDateTimeToUtc(date, "00:00:00", timeZone);
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return {
    start,
    end: zonedDateTimeToUtc(nextDate, "00:00:00", timeZone),
  };
}
