import { google } from 'googleapis';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? '';

export function isGoogleCalendarConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

export function createGoogleOAuthClient() {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('Google Calendar is not configured on server');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function buildGoogleConnectUrl(state: string) {
  const client = createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar'],
    state,
  });
}

export async function exchangeGoogleCode(code: string) {
  const client = createGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function fetchGoogleProfileEmail(params: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
}) {
  const client = createGoogleOAuthClient();
  client.setCredentials({
    access_token: params.accessToken ?? undefined,
    refresh_token: params.refreshToken ?? undefined,
    expiry_date: params.expiryDate ?? undefined,
  });
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const profile = await oauth2.userinfo.get();
  return profile.data.email ?? undefined;
}

function buildCalendarClient(params: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
}) {
  const client = createGoogleOAuthClient();
  client.setCredentials({
    access_token: params.accessToken ?? undefined,
    refresh_token: params.refreshToken ?? undefined,
    expiry_date: params.expiryDate ?? undefined,
  });
  return {
    auth: client,
    calendar: google.calendar({ version: 'v3', auth: client }),
  };
}

export async function getGoogleBusyRanges(params: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  timeMin: string;
  timeMax: string;
}) {
  const { calendar } = buildCalendarClient(params);
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      items: [{ id: 'primary' }],
    },
  });
  const busy = res.data.calendars?.primary?.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: b.start as string, end: b.end as string }));
}

export async function createGoogleCalendarEvent(params: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  summary: string;
  description: string;
  startUtcISO: string;
  endUtcISO: string;
  hostTimezone: string;
  inviteeEmail: string;
  inviteeName: string;
}) {
  const { calendar } = buildCalendarClient(params);
  await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: 'all',
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startUtcISO, timeZone: 'UTC' },
      end: { dateTime: params.endUtcISO, timeZone: 'UTC' },
      attendees: [{ email: params.inviteeEmail, displayName: params.inviteeName }],
      reminders: { useDefault: true },
    },
  });
}
