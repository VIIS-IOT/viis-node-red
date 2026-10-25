import { ALARM_KEY_MAX_LENGTH, capAlarmKey } from '../alarm-key';

describe('capAlarmKey', () => {
    test('a key that fits is unchanged', () => {
        expect(capAlarmKey('board_offline:board1')).toBe('board_offline:board1');
        expect(capAlarmKey('x'.repeat(ALARM_KEY_MAX_LENGTH))).toBe('x'.repeat(ALARM_KEY_MAX_LENGTH));
    });

    test('a longer key is cut to the backend limit, keeps its prefix, and two long keys stay distinct', () => {
        const a = capAlarmKey(`schedule_off_failed:${'s'.repeat(200)}a`);
        const b = capAlarmKey(`schedule_off_failed:${'s'.repeat(200)}b`);

        expect(a).toHaveLength(ALARM_KEY_MAX_LENGTH);
        expect(a.startsWith('schedule_off_failed:ssss')).toBe(true);
        expect(a).not.toBe(b);
        expect(capAlarmKey(`schedule_off_failed:${'s'.repeat(200)}a`)).toBe(a);
    });
});
