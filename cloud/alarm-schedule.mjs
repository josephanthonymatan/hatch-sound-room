const formatters = new Map();
function localParts(instant, timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return Object.fromEntries(formatters.get(timeZone).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}
export function alarmLocalTime(instant, timeZone) {
  const parts = localParts(instant, timeZone);
  return [parts.hour, parts.minute].map(value => String(value).padStart(2, '0')).join(':');
}

// Resolve by observed zone offsets, then verify the exact calendar fields. A
// nonexistent spring-forward time is skipped; a fall-back time runs only once,
// at its earlier instant, even when the later copy would still be in the future.
function localInstant(date, hour, minute, timeZone) {
  const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  const offsets = new Set();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = wall + delta * 3600000, p = localParts(sample, timeZone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sample);
  }
  return [...offsets].map(offset => wall - offset).filter(instant => {
    const p = localParts(instant, timeZone);
    return p.year === date.getUTCFullYear() && p.month === date.getUTCMonth() + 1 && p.day === date.getUTCDate() && p.hour === hour && p.minute === minute;
  }).sort((a, b) => a - b)[0];
}
export function nextAlarmInstant({ localTime, timeZone, repeatDays = [] }, minimum) {
  const p = localParts(minimum, timeZone), [hour, minute] = localTime.split(':').map(Number);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  for (let days = 0; days < 370; days++, date.setUTCDate(date.getUTCDate() + 1)) {
    if (repeatDays.length && !repeatDays.includes(date.getUTCDay())) continue;
    const instant = localInstant(date, hour, minute, timeZone);
    if (instant !== undefined && instant >= minimum) return new Date(instant).toISOString();
  }
  throw new Error('No valid alarm occurrence was found.');
}
