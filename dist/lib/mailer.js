"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendBookingEmails = sendBookingEmails;
const luxon_1 = require("luxon");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
function canSendEmail() {
    return Boolean(RESEND_API_KEY && EMAIL_FROM);
}
function logDevEmail(params) {
    // Simple terminal preview so booking-email flow can be tested without SMTP.
    // eslint-disable-next-line no-console
    console.log('\n=== DEV EMAIL PREVIEW START ===');
    // eslint-disable-next-line no-console
    console.log(`TO: ${params.to}`);
    // eslint-disable-next-line no-console
    console.log(`SUBJECT: ${params.subject}`);
    // eslint-disable-next-line no-console
    console.log(params.text);
    // eslint-disable-next-line no-console
    console.log('=== DEV EMAIL PREVIEW END ===\n');
}
function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function emailHtml(params) {
    return `
  <div style="font-family:Arial,sans-serif;background:#f6f8ff;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,23,42,0.1);border-radius:14px;padding:20px;">
      <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:8px;">${params.heading}</div>
      <div style="color:#475569;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 8px 0;">${params.line1}</p>
        <p style="margin:0 0 8px 0;">${params.line2}</p>
        <p style="margin:0;">${params.line3}</p>
      </div>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
        Scheduled meeting confirmation
      </div>
    </div>
  </div>
  `.trim();
}
async function sendBookingEmails(params) {
    try {
        const startUtc = luxon_1.DateTime.fromISO(params.startUtcISO, { zone: 'utc' });
        const endUtc = luxon_1.DateTime.fromISO(params.endUtcISO, { zone: 'utc' });
        if (!startUtc.isValid || !endUtc.isValid) {
            // eslint-disable-next-line no-console
            console.warn('Skipping booking emails due to invalid booking date values');
            return;
        }
        if (!isValidEmail(params.inviteeEmail) || !isValidEmail(params.hostEmail)) {
            // eslint-disable-next-line no-console
            console.warn('Skipping booking emails due to invalid recipient email');
            return;
        }
        const hostStart = startUtc.setZone(params.hostTimezone);
        const hostEnd = endUtc.setZone(params.hostTimezone);
        const inviteeStart = startUtc.setZone(params.inviteeTimezone);
        const inviteeEnd = endUtc.setZone(params.inviteeTimezone);
        const hostLine = `${hostStart.toFormat('cccc, LLL d, yyyy • h:mm a')} - ${hostEnd.toFormat('h:mm a')} (${params.hostTimezone})`;
        const inviteeLine = `${inviteeStart.toFormat('cccc, LLL d, yyyy • h:mm a')} - ${inviteeEnd.toFormat('h:mm a')} (${params.inviteeTimezone})`;
        const subject = `Meeting scheduled: ${params.eventTitle}`;
        const hostText = `Hi ${params.hostName},\n\n` +
            `A new meeting has been scheduled.\n\n` +
            `Event: ${params.eventTitle}\n` +
            `Invitee: ${params.inviteeName} (${params.inviteeEmail})\n` +
            `Time: ${hostLine}\n\n` +
            `Thanks,\nCalendly Clone`;
        const inviteeText = `Hi ${params.inviteeName},\n\n` +
            `Your meeting has been scheduled.\n\n` +
            `Event: ${params.eventTitle}\n` +
            `Host: ${params.hostName} (${params.hostEmail})\n` +
            `Time: ${inviteeLine}\n\n` +
            `Thanks,\nCalendly Clone`;
        const hostHtml = emailHtml({
            heading: 'New meeting scheduled',
            line1: `Hi ${params.hostName},`,
            line2: `Invitee: ${params.inviteeName} (${params.inviteeEmail})`,
            line3: `Time: ${hostLine}`,
        });
        const inviteeHtml = emailHtml({
            heading: 'Your meeting is confirmed',
            line1: `Hi ${params.inviteeName},`,
            line2: `Host: ${params.hostName} (${params.hostEmail})`,
            line3: `Time: ${inviteeLine}`,
        });
        if (!canSendEmail()) {
            logDevEmail({ to: params.hostEmail, subject, text: hostText });
            logDevEmail({ to: params.inviteeEmail, subject, text: inviteeText });
            return;
        }
        async function sendViaResend(to, text, html) {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: EMAIL_FROM,
                    to: [to],
                    subject,
                    text,
                    html,
                }),
            });
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`Resend email failed: ${response.status} ${body}`);
            }
        }
        await Promise.all([
            sendViaResend(params.hostEmail, hostText, hostHtml),
            sendViaResend(params.inviteeEmail, inviteeText, inviteeHtml),
        ]);
    }
    catch (err) {
        // Email delivery must never crash API responses.
        // eslint-disable-next-line no-console
        console.error('sendBookingEmails failed:', err);
    }
}
