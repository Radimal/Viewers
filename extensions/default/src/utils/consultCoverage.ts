import type { LatestConsult } from './radimalCaseStatus';

/**
 * Radimal: which series a completed consultation covered. A series is
 * covered when every image in it was acquired before the consultation was
 * completed. Scanner times are the clinic's local wall-clock time, so they
 * are read in the clinic's timezone (from Reporter) unless the image carries
 * its own UTC offset.
 *
 * ponytail: acquisition time, not when we received the image, so a late
 * transfer of an image taken before the consult reads as covered. Swap in
 * medical_images.created_at from Reporter if that matters.
 */

/** Milliseconds the zone is ahead of UTC at `utc`. */
function zoneOffset(utc: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(utc)
      .map(({ type, value }) => [type, Number(value)])
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(utc / 1000) * 1000;
}

/** A wall-clock time in `timeZone` as UTC milliseconds. */
export function zonedTimeToUtc(wallClockAsUtc: number, timeZone: string): number {
  const first = wallClockAsUtc - zoneOffset(wallClockAsUtc, timeZone);
  // Recheck at the result in case a DST change falls in between.
  return wallClockAsUtc - zoneOffset(first, timeZone);
}

/** DICOM DA + TM (+ optional ±HHMM offset) as UTC ms, or null. */
export function dicomDateTimeToUtc(da, tm, timeZone: string, offset?: string): number | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(String(da ?? '').trim());
  const time = /^(\d{2})(\d{2})?(\d{2})?/.exec(String(tm ?? '').trim());
  if (!date || !time) {
    return null;
  }
  const wallClock = Date.UTC(
    +date[1],
    +date[2] - 1,
    +date[3],
    +time[1],
    +(time[2] ?? 0),
    +(time[3] ?? 0)
  );
  const utcOffset = /^([+-])(\d{2})(\d{2})$/.exec(String(offset ?? '').trim());
  if (utcOffset) {
    const sign = utcOffset[1] === '-' ? -1 : 1;
    return wallClock - sign * (+utcOffset[2] * 60 + +utcOffset[3]) * 60000;
  }
  try {
    return zonedTimeToUtc(wallClock, timeZone);
  } catch (e) {
    return zonedTimeToUtc(wallClock, 'America/New_York'); // unknown zone name
  }
}

/** When this image was taken, as UTC ms, or null if it has no usable date/time. */
export function instanceAcquiredAt(instance, timeZone: string): number | null {
  const dt = /^(\d{8})(\d{2,6})(?:\.\d+)?([+-]\d{4})?$/.exec(
    String(instance.AcquisitionDateTime ?? '').trim()
  );
  if (dt) {
    return dicomDateTimeToUtc(dt[1], dt[2], timeZone, dt[3] ?? instance.TimezoneOffsetFromUTC);
  }
  // Some scanners leave acquisition fields blank; fall back to content, series, study.
  const date =
    instance.AcquisitionDate || instance.ContentDate || instance.SeriesDate || instance.StudyDate;
  const time =
    instance.AcquisitionTime || instance.ContentTime || instance.SeriesTime || instance.StudyTime;
  return dicomDateTimeToUtc(date, time, timeZone, instance.TimezoneOffsetFromUTC);
}

/** The latest acquisition time in the series, or null if any image has none. */
export function seriesAcquiredAt(displaySet, timeZone: string): number | null {
  let latest = null;
  for (const instance of displaySet.instances ?? []) {
    const acquiredAt = instanceAcquiredAt(instance, timeZone);
    if (acquiredAt === null) {
      return null;
    }
    latest = Math.max(latest ?? acquiredAt, acquiredAt);
  }
  return latest;
}

export type ConsultCoverage = {
  completedAt: number;
  covered: Set<string>;
  total: number;
  after: number;
};

/**
 * Coverage for one study's image series. null when there is nothing to show:
 * no completed consult, or no series acquired after it (then every series
 * was read, and outlining them all would only be noise).
 */
export function getConsultCoverage(
  displaySets,
  consult: LatestConsult | null | undefined
): ConsultCoverage | null {
  if (!consult) {
    return null;
  }
  const covered = new Set<string>();
  let after = 0;
  displaySets.forEach(displaySet => {
    const acquiredAt = seriesAcquiredAt(displaySet, consult.timeZone);
    if (acquiredAt === null) {
      return;
    }
    if (acquiredAt <= consult.completedAt) {
      covered.add(displaySet.displaySetInstanceUID);
    } else {
      after++;
    }
  });
  return after
    ? { completedAt: consult.completedAt, covered, total: displaySets.length, after }
    : null;
}
