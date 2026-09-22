import moment from 'moment';

/** Same UTC+7 clock the executor uses to decide whether a schedule is due. */
export const SCHEDULE_LOG_ICT_OFFSET_HOURS = 7;
export const SCHEDULE_LOG_ICT_WALL_FORMAT = 'YYYY-MM-DD HH:mm:ss';

export function ictNow(now?: moment.Moment): moment.Moment {
  return (now ? now.clone() : moment()).utc().add(SCHEDULE_LOG_ICT_OFFSET_HOURS, 'hours');
}

export function normalizeScheduleClock(clock: string | undefined | null): string {
  const parsed = moment(clock || '00:00:00', ['HH:mm:ss', 'HH:mm'], true);
  return parsed.isValid() ? parsed.format('HH:mm:ss') : '00:00:00';
}

/**
 * Naive ICT datetime for tabiot_schedule_log.start_time / end_time.
 * Do not use toISOString() — that tags the ICT clock with Z and breaks TB avg queries.
 */
export function buildScheduleLogIctDateTime(
  clock: string | undefined | null,
  now?: moment.Moment,
): string {
  return `${ictNow(now).format('YYYY-MM-DD')} ${normalizeScheduleClock(clock)}`;
}
