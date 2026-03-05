import type { EstimatedCall } from './entur-api';

export const MODE_ICONS: Record<string, string> = {
  bus: '\u{1F68C}',
  metro: '\u{1F687}',
  tram: '\u{1F68A}',
  rail: '\u{1F682}',
  water: '\u26F4\uFE0F',
  air: '\u2708\uFE0F',
  coach: '\u{1F68C}',
};

export interface DepartureTime {
  time: string;
  diffMin: number;
}

/**
 * Format a departure time as "now", "N min", or "HH:MM".
 * The threshold parameter controls when to switch from relative to absolute time.
 */
export function formatDepartureTime(
  expectedDepartureTime: string,
  thresholdMin = 60,
): DepartureTime {
  const now = Date.now();
  const departureMs = new Date(expectedDepartureTime).getTime();
  const diffMin = Math.round((departureMs - now) / 60_000);

  let time: string;
  if (diffMin < 1) {
    time = 'now';
  } else if (diffMin < thresholdMin) {
    time = `${diffMin} min`;
  } else {
    const d = new Date(expectedDepartureTime);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    time = `${hh}:${mm}`;
  }

  return { time, diffMin };
}

export interface TriggerEvent {
  type: 'departure_leaving_soon' | 'line_leaving_soon';
  triggerKey: string;
  lineCode: string;
  destination: string;
  mode: string;
  minutesUntil: number;
  lineId: string;
}

/**
 * Evaluate departures for trigger events, managing deduplication.
 * Returns an array of trigger events that should be fired.
 * Cleans expired entries from firedSet automatically.
 */
export function evaluateDepartureTriggers(
  departures: EstimatedCall[],
  firedSet: Set<string>,
): TriggerEvent[] {
  const now = Date.now();
  const events: TriggerEvent[] = [];

  // Clean expired entries
  for (const key of firedSet) {
    const aimedTime = key.split('|')[0];
    if (new Date(aimedTime).getTime() < now) {
      firedSet.delete(key);
    }
  }

  for (const dep of departures) {
    const lineCode = dep.serviceJourney.line.publicCode;
    const dest = dep.destinationDisplay.frontText;
    const mode = dep.serviceJourney.line.transportMode;
    const departureMs = new Date(dep.expectedDepartureTime).getTime();
    const minutesUntil = Math.round((departureMs - now) / 60_000);

    if (minutesUntil < 0) continue;

    const triggerKey = `${dep.aimedDepartureTime}|${lineCode}|${dest}`;
    if (firedSet.has(triggerKey)) continue;

    // Only fire if within the maximum possible threshold (60 min)
    if (minutesUntil > 60) continue;

    firedSet.add(triggerKey);

    const lineId = `${lineCode}|${dest}`;

    events.push({
      type: 'departure_leaving_soon',
      triggerKey,
      lineCode,
      destination: dest,
      mode,
      minutesUntil,
      lineId,
    });

    events.push({
      type: 'line_leaving_soon',
      triggerKey,
      lineCode,
      destination: dest,
      mode,
      minutesUntil,
      lineId,
    });
  }

  return events;
}

/**
 * Check if a specific line departs within N minutes.
 */
export function checkLineDepartsWithin(
  departures: EstimatedCall[],
  lineId: string,
  minutes: number,
): boolean {
  const now = Date.now();
  const thresholdMs = minutes * 60_000;
  return departures.some((d) => {
    const diff = new Date(d.expectedDepartureTime).getTime() - now;
    const id = `${d.serviceJourney.line.publicCode}|${d.destinationDisplay.frontText}`;
    return id === lineId && diff >= 0 && diff <= thresholdMs;
  });
}

/**
 * Check if the next departure is of a specific transport mode.
 */
export function checkNextDepartureIsMode(
  departures: EstimatedCall[],
  mode: string,
): boolean {
  const next = departures[0];
  if (!next) return false;
  return next.serviceJourney.line.transportMode === mode;
}
