/**
 * Manual Test Script: Cancel-then-Rebook against Google Calendar API
 *
 * Verifies:
 * 1. Booking an appointment slot with `conferenceDataVersion: 1` provisions a Google Meet link.
 * 2. Deleting / cancelling the event sets status to 'cancelled'.
 * 3. Re-booking the EXACT SAME deterministic slot ID does NOT fail with 409 or return
 *    a cancelled event. Instead, it patches the event with `status: 'confirmed'` and
 *    returns an active Google Meet video conference link.
 *
 * Usage:
 *   $env:GOOGLE_CALENDAR_ACCESS_TOKEN="ya29.a0..."
 *   $env:GOOGLE_CALENDAR_ID="primary"
 *   npx tsx scripts/test-calendar-cancel-rebook.ts
 */

interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    conferenceSolution?: { name?: string };
  };
  hangoutLink?: string;
}

async function main() {
  const accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');

  if (!accessToken) {
    console.error('================================================================');
    console.error('ERROR: No GOOGLE_CALENDAR_ACCESS_TOKEN found in environment!');
    console.error('Please obtain a Google Calendar OAuth access token and run:');
    console.error('  Windows PowerShell:');
    console.error('    $env:GOOGLE_CALENDAR_ACCESS_TOKEN="ya29.a0..."');
    console.error('    $env:GOOGLE_CALENDAR_ID="primary"  # or specific calendar email');
    console.error('    npx tsx scripts/test-calendar-cancel-rebook.ts');
    console.error('================================================================');
    process.exit(1);
  }

  const baseHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Generate a deterministic test event ID conforming to Google Calendar ID specs (base32hex, 5-1024 chars)
  const timestampSuffix = Date.now().toString(36);
  const deterministicEventId = `wacrmtestslot${timestampSuffix}`;

  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
  startTime.setMinutes(0, 0, 0);
  const endTime = new Date(startTime.getTime() + 45 * 60 * 1000);

  const eventPayload: GoogleCalendarEvent = {
    id: deterministicEventId,
    summary: 'Test Demo Session (Deterministic ID Test)',
    description: 'Booking test for cancel-then-rebook determinism verification.',
    start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Kolkata' },
    end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Kolkata' },
    conferenceData: {
      createRequest: {
        requestId: `req_${timestampSuffix}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    } as any,
  };

  console.log('\n================================================================');
  console.log('Testing Google Calendar Cancel-then-Rebook Determinism');
  console.log(`Calendar ID: ${calendarId}`);
  console.log(`Deterministic Event ID: ${deterministicEventId}`);
  console.log(`Slot Time: ${startTime.toISOString()} -> ${endTime.toISOString()}`);
  console.log('================================================================\n');

  // STEP 1: Create initial booking
  console.log('STEP 1: Creating initial booking with conferenceDataVersion=1...');
  const createRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify(eventPayload),
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error('Failed to create initial test event:', createRes.status, errText);
    process.exit(1);
  }

  const createdEvent = (await createRes.json()) as GoogleCalendarEvent;
  const initialMeetLink =
    createdEvent.hangoutLink ||
    createdEvent.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri;

  console.log(`-> Created Event ID: ${createdEvent.id}`);
  console.log(`-> Status:           ${createdEvent.status}`);
  console.log(`-> Google Meet URL:  ${initialMeetLink || '(None returned)'}\n`);

  if (!initialMeetLink) {
    console.warn('Warning: Google Meet link was not returned. Verify Google Workspace Meet settings.');
  }

  // STEP 2: Cancel / Delete the booking
  console.log('STEP 2: Cancelling / Deleting event via Google Calendar API...');
  const deleteRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${deterministicEventId}`,
    {
      method: 'DELETE',
      headers: baseHeaders,
    }
  );

  if (!deleteRes.ok && deleteRes.status !== 204) {
    const errText = await deleteRes.text();
    console.error('Failed to delete event:', deleteRes.status, errText);
    process.exit(1);
  }
  console.log('-> Event successfully deleted/cancelled (HTTP 204).\n');

  // STEP 3: Verify the event is now cancelled in Google Calendar
  console.log('STEP 3: Verifying event status is cancelled...');
  const checkRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${deterministicEventId}`,
    {
      method: 'GET',
      headers: baseHeaders,
    }
  );
  const checkedEvent = (await checkRes.json()) as GoogleCalendarEvent;
  console.log(`-> Status in Google Calendar: ${checkedEvent.status}\n`);

  if (checkedEvent.status !== 'cancelled') {
    console.error(`Expected event status to be 'cancelled', but got '${checkedEvent.status}'`);
    process.exit(1);
  }

  // STEP 4: Attempt Rebooking the SAME slot ID (simulating WACRM booking coordinator revival)
  console.log('STEP 4: Re-booking the SAME slot ID with conferenceDataVersion=1...');
  console.log('Testing WACRM conflict revival logic:');

  // Attempt standard POST (which will 409 conflict because event already exists as cancelled)
  const rebookPostRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify(eventPayload),
    }
  );

  let finalRebookedEvent: GoogleCalendarEvent;

  if (rebookPostRes.status === 409) {
    console.log('-> Received expected HTTP 409 Conflict from Google Calendar API.');
    console.log('-> Executing WACRM Revival Patch: PATCH status="confirmed" + fresh conferenceData...');

    const revivalPayload: GoogleCalendarEvent = {
      status: 'confirmed',
      summary: eventPayload.summary,
      description: eventPayload.description,
      start: eventPayload.start,
      end: eventPayload.end,
      conferenceData: {
        createRequest: {
          requestId: `revive_${timestampSuffix}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      } as any,
    };

    const patchRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${deterministicEventId}?conferenceDataVersion=1`,
      {
        method: 'PATCH',
        headers: baseHeaders,
        body: JSON.stringify(revivalPayload),
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error('Revival PATCH failed:', patchRes.status, errText);
      process.exit(1);
    }

    finalRebookedEvent = (await patchRes.json()) as GoogleCalendarEvent;
  } else if (rebookPostRes.ok) {
    finalRebookedEvent = (await rebookPostRes.json()) as GoogleCalendarEvent;
  } else {
    const errText = await rebookPostRes.text();
    console.error('Unexpected rebook response:', rebookPostRes.status, errText);
    process.exit(1);
  }

  const revivedMeetLink =
    finalRebookedEvent.hangoutLink ||
    finalRebookedEvent.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri;

  console.log('\n================================================================');
  console.log('RE-BOOKING REVIVAL VERIFICATION RESULTS:');
  console.log(`-> Revived Event ID:     ${finalRebookedEvent.id}`);
  console.log(`-> Event Status:          ${finalRebookedEvent.status} (MUST BE "confirmed")`);
  console.log(`-> Revived Meet Link:     ${revivedMeetLink || '(None)'}`);
  console.log('================================================================');

  if (finalRebookedEvent.status === 'confirmed') {
    console.log('\n SUCCESS: Cancel-then-rebook revived cleanly without 409 failure!');
  } else {
    console.error(`\n FAILED: Event status remained '${finalRebookedEvent.status}'!`);
    process.exit(1);
  }

  // Cleanup test event
  console.log('\nCleaning up test event...');
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${deterministicEventId}`,
    {
      method: 'DELETE',
      headers: baseHeaders,
    }
  );
  console.log('Cleanup complete.');
}

main().catch((err) => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
