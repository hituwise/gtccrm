'use client';

import { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertCircle,
  Video,
  Key,
  Sparkles,
  ExternalLink,
  Loader2,
  Trash2,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { GoogleCalendarConfigSafe, CalendarBooking } from '@/types/calendar';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function GoogleCalendarConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Form state
  const [calendarId, setCalendarId] = useState('primary');
  const [authType, setAuthType] = useState<'service_account' | 'oauth'>('service_account');
  const [serviceAccountKey, setServiceAccountKey] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [autoBookingEnabled, setAutoBookingEnabled] = useState(true);
  const [meetingTitle, setMeetingTitle] = useState('LeadPilot Demo Call');
  const [meetingDuration, setMeetingDuration] = useState('30');
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [confirmationTemplate, setConfirmationTemplate] = useState(
    '🎉 Great news! Your demo call has been scheduled.\n\n' +
    '📅 Date & Time: {{date_time}}\n' +
    '📧 Calendar invite sent to: {{email}}\n' +
    '📹 Google Meet: {{meet_link}}\n\n' +
    'We look forward to speaking with you! Reply here anytime if you need to reschedule.',
  );

  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Load config on mount
  useEffect(() => {
    loadConfig();
    loadRecentBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadConfig() {
    try {
      setLoading(true);
      const res = await fetch('/api/calendar/config');
      const data: GoogleCalendarConfigSafe = await res.json();

      if (data.configured) {
        setCalendarId(data.calendar_id || 'primary');
        setAuthType(data.auth_type || 'service_account');
        setIsActive(data.is_active);
        setAutoBookingEnabled(data.auto_booking_enabled !== false);
        setMeetingTitle(data.default_meeting_title || 'LeadPilot Demo Call');
        setMeetingDuration(String(data.default_meeting_duration || 30));
        setTimezone(data.default_timezone || timezone);
        if (data.confirmation_message_template) {
          setConfirmationTemplate(data.confirmation_message_template);
        }
        setHasStoredKey(Boolean(data.has_key));
        setServiceAccountEmail(data.service_account_email || null);
      }
    } catch (err) {
      console.error('Failed to load Google Calendar config:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentBookings() {
    try {
      setLoadingBookings(true);
      const res = await fetch('/api/calendar/bookings?limit=10');
      const data = await res.json();
      if (Array.isArray(data.bookings)) {
        setBookings(data.bookings);
      }
    } catch (err) {
      console.error('Failed to load bookings:', err);
    } finally {
      setLoadingBookings(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        auth_type: authType,
        calendar_id: calendarId.trim() || 'primary',
        is_active: isActive,
        auto_booking_enabled: autoBookingEnabled,
        default_meeting_title: meetingTitle.trim(),
        default_meeting_duration: Number(meetingDuration) || 30,
        default_timezone: timezone,
        confirmation_message_template: confirmationTemplate.trim(),
      };

      if (serviceAccountKey.trim()) {
        payload.service_account_key = serviceAccountKey.trim();
      }

      const res = await fetch('/api/calendar/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      toast.success('Google Calendar settings saved successfully');
      setServiceAccountKey('');
      loadConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const payload: Record<string, unknown> = {
        auth_type: authType,
        calendar_id: calendarId.trim() || 'primary',
      };
      if (serviceAccountKey.trim()) {
        payload.service_account_key = serviceAccountKey.trim();
      }

      const res = await fetch('/api/calendar/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(
          `Connected successfully to "${data.summary || data.calendarId}" (${data.timeZone})`,
        );
        if (data.serviceAccountEmail) {
          setServiceAccountEmail(data.serviceAccountEmail);
        }
      } else {
        toast.error(`Connection failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Connection test error: ${msg}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect Google Calendar?')) return;
    try {
      setDisconnecting(true);
      const res = await fetch('/api/calendar/config', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('Google Calendar disconnected');
      setHasStoredKey(false);
      setServiceAccountEmail(null);
      setServiceAccountKey('');
      setIsActive(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setDisconnecting(false);
    }
  }

  const copyServiceAccountEmail = () => {
    if (!serviceAccountEmail) return;
    navigator.clipboard.writeText(serviceAccountEmail);
    setCopiedEmail(true);
    toast.success('Service account email copied to clipboard');
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const insertToken = (token: string) => {
    setConfirmationTemplate((prev) => `${prev} ${token}`);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <Card className="border-border/60 bg-gradient-to-br from-card to-card/50">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <CardTitle className="text-xl font-bold">Google Calendar & Demo Booking</CardTitle>
            </div>
            <CardDescription className="text-sm">
              Connect Google Calendar to automate client demo and call scheduling directly over WhatsApp with instant Google Meet links.
            </CardDescription>
          </div>
          <div>
            {hasStoredKey && isActive ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Connected & Active
              </Badge>
            ) : hasStoredKey ? (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                Paused
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not Connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {serviceAccountEmail && (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Calendar Service Account:</span>
                <code className="truncate rounded bg-background px-1.5 py-0.5 font-mono text-xs font-semibold">
                  {serviceAccountEmail}
                </code>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyServiceAccountEmail}
                className="h-7 gap-1 px-2 text-xs"
              >
                {copiedEmail ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copiedEmail ? 'Copied' : 'Copy Email'}
              </Button>
            </div>
          )}

          {/* Quick Setup Guide Toggle */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                How Google Calendar Demo Booking Works
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowGuide(!showGuide)}
                className="h-7 text-xs text-primary"
              >
                {showGuide ? 'Hide Guide' : 'View Setup Steps'}
              </Button>
            </div>
            {showGuide && (
              <div className="mt-3 space-y-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                <ol className="list-inside list-decimal space-y-1.5">
                  <li>
                    <span className="font-semibold text-foreground">Client expresses intent</span>: In WhatsApp chat, the client asks to book a call or demo.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Collects Email ID</span>: AI or agent asks for their email address (and preferred date/time if any).
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Automatic Google Calendar Booking</span>: The system creates an event on your calendar with an automatic Google Meet video link and invites their email.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Instant WhatsApp Confirmation</span>: The client immediately receives a confirmation message with the date, time, and Google Meet URL.
                  </li>
                </ol>
                <div className="mt-2 text-[11px] text-muted-foreground/80">
                  To connect: Create a Service Account in Google Cloud, enable &quot;Google Calendar API&quot;, paste the JSON key below, and share your calendar with the service account email.
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Calendar Connection & Credentials</CardTitle>
          <CardDescription className="text-sm">
            Provide your Google Service Account JSON key. Credentials are encrypted at rest with AES-256-GCM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Service Account Key Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="serviceAccountKey" className="text-sm font-medium">
                Google Service Account JSON Key
              </Label>
              {hasStoredKey && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ Credentials configured
                </span>
              )}
            </div>
            <Textarea
              id="serviceAccountKey"
              value={serviceAccountKey}
              onChange={(e) => setServiceAccountKey(e.target.value)}
              placeholder={
                hasStoredKey
                  ? '•••••••••••••••••••••••••••••••••••••••••••••••••••••••••• (Paste new JSON to replace)'
                  : '{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "...",\n  "client_email": "..."\n}'
              }
              rows={4}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Paste the entire JSON file generated from Google Cloud Console &rarr; Service Accounts &rarr; Keys.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Calendar ID */}
            <div className="space-y-2">
              <Label htmlFor="calendarId" className="text-sm font-medium">
                Google Calendar ID
              </Label>
              <Input
                id="calendarId"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                placeholder="primary"
              />
              <p className="text-xs text-muted-foreground">
                Use <code className="font-semibold">primary</code> for your default calendar, or paste your calendar email ID.
              </p>
            </div>

            {/* Default Duration */}
            <div className="space-y-2">
              <Label htmlFor="duration" className="text-sm font-medium">
                Demo / Call Duration
              </Label>
              <select
                id="duration"
                value={meetingDuration}
                onChange={(e) => setMeetingDuration(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Length of the booked Google Meet calendar slot.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Timezone */}
            <div className="space-y-2">
              <Label htmlFor="timezone" className="text-sm font-medium">
                Default Timezone
              </Label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Timezone used when displaying and scheduling meeting slots.
              </p>
            </div>

            {/* Meeting Title Prefix */}
            <div className="space-y-2">
              <Label htmlFor="meetingTitle" className="text-sm font-medium">
                Default Event Title
              </Label>
              <Input
                id="meetingTitle"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="LeadPilot Demo Call"
              />
              <p className="text-xs text-muted-foreground">
                Prefixed to the client&apos;s name on Google Calendar.
              </p>
            </div>
          </div>

          {/* AI Auto-Booking Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-4">
            <div className="space-y-0.5">
              <Label htmlFor="autoBooking" className="text-sm font-semibold">
                AI Automated Booking via WhatsApp
              </Label>
              <p className="text-xs text-muted-foreground">
                When a customer shares their email for a demo/call, automatically book the Google Calendar event and reply with confirmation.
              </p>
            </div>
            <input
              id="autoBooking"
              type="checkbox"
              checked={autoBookingEnabled}
              onChange={(e) => setAutoBookingEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
          </div>

          {/* Confirmation Message Template */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="confirmationTemplate" className="text-sm font-medium">
                WhatsApp Confirmation Message Template
              </Label>
            </div>
            <Textarea
              id="confirmationTemplate"
              value={confirmationTemplate}
              onChange={(e) => setConfirmationTemplate(e.target.value)}
              rows={4}
              className="text-xs font-normal"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <span>Insert tags:</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertToken('{{date_time}}')}
                className="h-6 px-1.5 font-mono text-[11px]"
              >
                + &#123;&#123;date_time&#125;&#125;
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertToken('{{email}}')}
                className="h-6 px-1.5 font-mono text-[11px]"
              >
                + &#123;&#123;email&#125;&#125;
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertToken('{{meet_link}}')}
                className="h-6 px-1.5 font-mono text-[11px]"
              >
                + &#123;&#123;meet_link&#125;&#125;
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertToken('{{name}}')}
                className="h-6 px-1.5 font-mono text-[11px]"
              >
                + &#123;&#123;name&#125;&#125;
              </Button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testing || (!hasStoredKey && !serviceAccountKey.trim())}
            >
              {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Test Connection
            </Button>
            {hasStoredKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {disconnecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                Disconnect
              </Button>
            )}
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Configuration
          </Button>
        </CardFooter>
      </Card>

      {/* Recent Bookings Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Recent Scheduled Demos & Calls</CardTitle>
            <CardDescription className="text-sm">
              Appointments scheduled automatically via WhatsApp or manually by your team.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadRecentBookings} disabled={loadingBookings}>
            {loadingBookings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent>
          {bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <CalendarIcon className="h-10 w-10 stroke-[1.5] text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No bookings yet</p>
              <p className="text-xs">
                When clients provide their email on WhatsApp, booked demo calls will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {bookings.map((b) => (
                <div key={b.id} className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{b.title}</span>
                      <Badge
                        variant="secondary"
                        className={
                          b.status === 'confirmed'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {b.status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        via {b.booked_by.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>👤 {b.attendee_name || 'Customer'}</span>
                      <span>📧 {b.attendee_email}</span>
                      <span>📅 {new Date(b.start_time).toLocaleString()}</span>
                    </div>
                  </div>
                  {b.meet_link && b.meet_link.startsWith('http') && (
                    <div className="flex items-center gap-2">
                      <a
                        href={b.meet_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                      >
                        <Video className="h-3.5 w-3.5" />
                        Join Meet
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
