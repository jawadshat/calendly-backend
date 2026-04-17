"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWeeklySlots = generateWeeklySlots;
const luxon_1 = require("luxon");
function generateWeeklySlots(params) {
    const { hostTimezone, weekly, durationMinutes, rangeStartUtcISO, rangeEndUtcISO, minNoticeMinutes, bufferBeforeMinutes, bufferAfterMinutes, } = params;
    const nowUtc = luxon_1.DateTime.utc();
    const earliestUtc = luxon_1.DateTime.max(nowUtc.plus({ minutes: minNoticeMinutes }), luxon_1.DateTime.fromISO(rangeStartUtcISO, { zone: 'utc' }));
    const endUtc = luxon_1.DateTime.fromISO(rangeEndUtcISO, { zone: 'utc' });
    if (endUtc <= earliestUtc)
        return [];
    const hoursByDow = new Map();
    for (const w of weekly) {
        const list = hoursByDow.get(w.dayOfWeek) ?? [];
        list.push({ startMinute: w.startMinute, endMinute: w.endMinute });
        hoursByDow.set(w.dayOfWeek, list);
    }
    const slots = [];
    const zoneCandidate = luxon_1.DateTime.now().setZone(hostTimezone);
    const safeZone = zoneCandidate.isValid ? hostTimezone : 'UTC';
    // iterate day by day in host timezone, then convert to UTC
    let cursorHost = earliestUtc.setZone(safeZone).startOf('day');
    const endHost = endUtc.setZone(safeZone).startOf('day').plus({ days: 1 });
    while (cursorHost < endHost) {
        // luxon: weekday is 1..7 (Mon..Sun). Convert to 0..6 (Sun..Sat)
        const dow0 = cursorHost.weekday % 7;
        const windows = hoursByDow.get(dow0) ?? [];
        for (const win of windows) {
            let start = cursorHost.plus({ minutes: win.startMinute + bufferBeforeMinutes });
            const lastStart = cursorHost.plus({ minutes: win.endMinute - durationMinutes - bufferAfterMinutes });
            while (start <= lastStart) {
                const slotStartUtc = start.toUTC();
                const slotEndUtc = start.plus({ minutes: durationMinutes }).toUTC();
                if (slotStartUtc >= earliestUtc && slotEndUtc <= endUtc) {
                    slots.push({ startUtcISO: slotStartUtc.toISO(), endUtcISO: slotEndUtc.toISO() });
                }
                start = start.plus({ minutes: durationMinutes });
            }
        }
        cursorHost = cursorHost.plus({ days: 1 });
    }
    return slots;
}
