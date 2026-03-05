import type { TripPattern } from './entur-api';
import { MODE_ICONS } from './departures';

export interface CommuteResult {
  leaveAt: Date;
  leaveAtStr: string;
  lineCode: string;
  mode: string;
  lineDisplay: string;
  travelMinutes: number;
}

/**
 * Compute when to leave based on a trip pattern and buffer time.
 * Returns null if no valid trip data.
 */
export function computeLeaveTime(
  trip: TripPattern,
  bufferMinutes: number,
): CommuteResult | null {
  const startTime = new Date(trip.startTime);
  const leaveAt = new Date(startTime.getTime() - bufferMinutes * 60_000);

  const leaveHH = String(leaveAt.getHours()).padStart(2, '0');
  const leaveMM = String(leaveAt.getMinutes()).padStart(2, '0');
  const leaveAtStr = `${leaveHH}:${leaveMM}`;

  // Find first transit leg
  const transitLeg = trip.legs.find((l) => l.line != null);
  const mode = transitLeg?.mode || trip.legs[0]?.mode || 'unknown';
  const lineCode = transitLeg?.line?.publicCode || '';
  const icon = MODE_ICONS[mode] || '';
  const lineDisplay = lineCode ? `${icon} ${lineCode}` : icon || mode;

  const travelMinutes = Math.round(trip.duration / 60);

  return {
    leaveAt,
    leaveAtStr,
    lineCode,
    mode,
    lineDisplay,
    travelMinutes,
  };
}

export interface CommuteTriggerResult {
  shouldFire: boolean;
  dedupKey: string;
  minutesBefore: number;
}

/**
 * Determine if a commute trigger should fire, with deduplication.
 */
export function shouldFireCommuteTrigger(
  leaveAt: Date,
  firedKey: string | null,
): CommuteTriggerResult {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const leaveHH = String(leaveAt.getHours()).padStart(2, '0');
  const leaveMM = String(leaveAt.getMinutes()).padStart(2, '0');
  const leaveAtStr = `${leaveHH}:${leaveMM}`;

  const dedupKey = `${todayKey}|${leaveAtStr}`;
  const minutesBefore = Math.round((leaveAt.getTime() - now.getTime()) / 60_000);

  // Reset deduplication on new day
  const sameDay = firedKey && firedKey.startsWith(todayKey);
  const alreadyFired = firedKey === dedupKey;

  const shouldFire = !alreadyFired
    && (!firedKey || sameDay || !sameDay) // always allow if different day
    && minutesBefore >= 0
    && minutesBefore <= 60;

  return { shouldFire, dedupKey, minutesBefore };
}
