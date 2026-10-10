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
  ShieldCheck,
  Clock,
  Layers,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { GoogleCalendarConfigSafe, CalendarBooking, ProductAppointmentTypeConfig } from '@/types/calendar';

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const DEFAULT_APPOINTMENT_TYPES: ProductAppointmentTypeConfig[] = [];

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
  const [allowAiBooking, setAllowAiBooking] = useState(true);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [workingHoursStart, setWorkingHoursStart] = useState('09:00');
  const [workingHoursEnd, setWorkingHoursEnd] = useState('18:00');
  const [bufferMinutes, setBufferMinutes] = useState('15');

  // Product appointment types - starts empty for new coach accounts
  const [appointmentTypes, setAppointmentTypes] = useState<ProductAppointmentTypeConfig[]>([]);

  const [confirmationTemplate, setConfirmationTemplate] = useState(
    'Perfect 😊 Your {{title}} is booked!\n\n' +
    '📅 {{date_time}}\n' +
    '⏱️ {{duration}} minutes\n' +
    '💻 Google Meet: {{meet_link}}\n\n' +
    'See you there! 🎉 Reply here anytime if you need to reschedule.',
  );

  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);
  const [connectingOauth, setConnectingOauth] = useState(false);
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
      if (!res.ok) {
        console.warn(`Failed to load Google Calendar config: HTTP ${res.status}`);
        return;
      }
      const data: GoogleCalendarConfigSafe = await res.json();

      if (data.configured) {
        setCalendarId(data.calendar_id || 'primary');
        setAuthType(data.auth_type || 'service_account');
        setIsActive(data.is_active);
        setAllowAiBooking(data.allow_ai_booking !== false && data.auto_booking_enabled !== false);
        setTimezone(data.default_timezone || 'Asia/Kolkata');
        setWorkingHoursStart(data.working_hours_start || '09:00');
        setWorkingHoursEnd(data.working_hours_end || '18:00');
        setBufferMinutes(String(data.buffer_between_meetings || 15));
        if (data.confirmation_message_template) {
          setConfirmationTemplate(data.confirmation_message_template);
        }
        if (data.appointment_types && data.appointment_types.length > 0) {
          setAppointmentTypes(data.appointment_types);
        }
        setHasStoredKey(Boolean(data.has_key));
        setServiceAccountEmail(data.service_account_email || null);
        setOauthEmail(data.oauth_email || null);
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
      if (!res.ok) {
        return;
      }
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

  function handleUpdateAppointmentType(index: number, patch: Partial<ProductAppointmentTypeConfig>) {
    setAppointmentTypes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  async function handleSave() {
    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        auth_type: authType,
        calendar_id: calendarId.trim() || 'primary',
        is_active: isActive,
        auto_booking_enabled: allowAiBooking,
        allow_ai_booking: allowAiBooking,
        default_timezone: timezone,
        working_hours_start: workingHoursStart,
        working_hours_end: workingHoursEnd,
        buffer_between_meetings: Number(bufferMinutes) || 15,
        confirmation_message_template: confirmationTemplate.trim(),
        appointment_types: appointmentTypes,
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
      setOauthEmail(null);
      setServiceAccountKey('');
      setIsActive(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleConnectOauth() {
    try {
      setConnectingOauth(true);
      const res = await fetch('/api/calendar/auth', {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to start Google OAuth connection');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Could not initiate Google connection: ${msg}`);
    } finally {
      setConnectingOauth(false);
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
              <CardTitle className="text-xl font-bold">Google Calendar & Appointment Settings</CardTitle>
            </div>
            <CardDescription className="text-sm">
              Connect Google Calendar and govern AI Agent booking permissions, product durations, and confirmation templates.
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

          {/* Setup Guide Toggle */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                How the Verified AI Booking Architecture Works
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowGuide(!showGuide)}
                className="h-7 text-xs text-primary"
              >
                {showGuide ? 'Hide Details' : 'View Architecture'}
              </Button>
            </div>
            {showGuide && (
              <div className="mt-3 space-y-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                <ol className="list-inside list-decimal space-y-1.5">
                  <li>
                    <span className="font-semibold text-foreground">Intent & Product Detection</span>: Inbound messages are evaluated for your configured services and booking intent.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Required Fields Gate</span>: AI Agent collects missing fields (Customer Name, Email, Preferred Slot, Child Age) without duplicate questions.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Real-Time Google Calendar Check</span>: Availability is verified against real Google Calendar free/busy slots.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Real Calendar Event Creation</span>: External Google Calendar event is created with event ID returned as the source of truth.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">CRM Record & Milestones</span>: CRM booking row created, tags applied (DEMO_BOOKED), lead score updated, and internal CRM note logged.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Confirmation Sent</span>: WhatsApp confirmation sent strictly after successful calendar event creation.
                  </li>
                </ol>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SECTION A: Calendar Connection & Credentials */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">A. Calendar Connection & Working Hours</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Choose your connection method and configure schedule boundaries. Credentials are encrypted at rest with AES-256-GCM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Auth Method Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Authentication Method</Label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setAuthType('oauth')}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                  authType === 'oauth'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border/60 hover:border-border'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span>Google Account (OAuth 2.0)</span>
                  <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    Google Meet
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Connect your own Google Account. Generates Google Meet video links and dispatches attendee invites.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAuthType('service_account')}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                  authType === 'service_account'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border/60 hover:border-border'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span>Google Service Account</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Headless server-to-server connection using a JSON Service Account key.
                </span>
              </button>
            </div>
          </div>

          {authType === 'oauth' ? (
            /* OAuth 2.0 Connection View */
            <div className="space-y-3">
              {hasStoredKey && (oauthEmail || authType === 'oauth') ? (
                <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-foreground">Connected Google Account:</span>
                      <code className="truncate rounded bg-background px-2 py-0.5 font-mono text-xs font-semibold">
                        {oauthEmail || 'Connected via OAuth'}
                      </code>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={connectingOauth}
                      onClick={handleConnectOauth}
                      className="h-8 gap-1.5 text-xs"
                    >
                      {connectingOauth ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      Reconnect Account
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ✓ Google Meet links and automatic attendee email invitations are fully supported.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/80 bg-muted/20 p-6 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Video className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold">Connect your Google Calendar</h4>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      Authorize Lead Pilot to access your calendar and automatically generate Google Meet video links for bookings.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={handleConnectOauth}
                    disabled={connectingOauth}
                    className="gap-2"
                  >
                    {connectingOauth ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Sign in with Google
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* Service Account Key Input */
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
                Paste the service account JSON key from Google Cloud Console &rarr; Service Accounts &rarr; Keys.
              </p>
            </div>
          )}

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
                Use <code className="font-semibold">primary</code> for your default calendar or your Google Calendar email address.
              </p>
            </div>

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
                Canonical timezone for booking calculations and customer slot presentation.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* Working Hours Start */}
            <div className="space-y-2">
              <Label htmlFor="workingHoursStart" className="text-sm font-medium">
                Working Hours Start
              </Label>
              <Input
                id="workingHoursStart"
                type="time"
                value={workingHoursStart}
                onChange={(e) => setWorkingHoursStart(e.target.value)}
              />
            </div>

            {/* Working Hours End */}
            <div className="space-y-2">
              <Label htmlFor="workingHoursEnd" className="text-sm font-medium">
                Working Hours End
              </Label>
              <Input
                id="workingHoursEnd"
                type="time"
                value={workingHoursEnd}
                onChange={(e) => setWorkingHoursEnd(e.target.value)}
              />
            </div>

            {/* Buffer between meetings */}
            <div className="space-y-2">
              <Label htmlFor="bufferMinutes" className="text-sm font-medium">
                Buffer Between Slots (mins)
              </Label>
              <Input
                id="bufferMinutes"
                type="number"
                min="0"
                max="60"
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION B: AI Booking Permission & Governance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">B. AI Booking Permission & Governance</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Control whether the AI Agent has permission to reserve slots and book Google Calendar events.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between rounded-lg border border-border/60 bg-muted/20 p-4">
            <div className="space-y-1">
              <Label htmlFor="allowAiBooking" className="text-sm font-semibold cursor-pointer">
                Allow AI Agent to Book Calendar Appointments
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, the AI Agent can check calendar availability and create appointments after all required booking information has been collected.
              </p>
              <p className="text-[11px] text-muted-foreground/80 pt-1">
                When disabled, the AI Agent collects inquiry details and routes the lead to human agents for manual scheduling.
              </p>
            </div>
            <input
              id="allowAiBooking"
              type="checkbox"
              checked={allowAiBooking}
              onChange={(e) => setAllowAiBooking(e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
            />
          </div>

          <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Verified Safeguard: No Email-Only Auto Booking
            </div>
            <p className="mt-1">
              The AI Agent is the sole decision-maker for booking. It strictly validates contact name, email, preferred slot, and program details before verifying availability. Sharing an email alone will never trigger an automatic booking.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SECTION C: Product-Specific Appointment Types */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">C. Product Appointment Types & Durations</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Configure appointment types, slot durations, and Google Calendar event title templates per product line.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="divide-y divide-border/60 rounded-lg border border-border/60">
            {appointmentTypes.map((item, index) => (
              <div key={item.productKey} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {item.name || item.productKey}
                    </Badge>
                    {item.meetingMode && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.meetingMode.replace(/_/g, ' ')}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      Assigned to: <strong className="text-foreground">{item.teamName}</strong>
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {item.ctaType}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {/* Appointment Type Name */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Appointment Type Name</Label>
                    <Input
                      value={item.appointmentType}
                      onChange={(e) => handleUpdateAppointmentType(index, { appointmentType: e.target.value })}
                      placeholder="e.g. Free Consultation"
                      className="h-8 text-xs"
                    />
                  </div>

                  {/* Duration Minutes */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Duration (minutes)</Label>
                    <select
                      value={item.durationMinutes}
                      onChange={(e) => handleUpdateAppointmentType(index, { durationMinutes: Number(e.target.value) || 45 })}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="45">45 minutes</option>
                      <option value="60">60 minutes</option>
                      <option value="90">90 minutes</option>
                    </select>
                  </div>

                  {/* Event Title Template */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Event Title Template</Label>
                    <Input
                      value={item.eventTitleTemplate || `{{name}} - ${item.appointmentType}`}
                      onChange={(e) => handleUpdateAppointmentType(index, { eventTitleTemplate: e.target.value })}
                      placeholder="e.g. {{name}} - Consultation"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SECTION D: Confirmation Message Template */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-semibold">D. WhatsApp Confirmation Message Template</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Template sent to the customer strictly after real Google Calendar appointment creation succeeds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            id="confirmationTemplate"
            value={confirmationTemplate}
            onChange={(e) => setConfirmationTemplate(e.target.value)}
            rows={5}
            className="text-xs font-normal"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <span>Insert placeholders:</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => insertToken('{{title}}')}
              className="h-6 px-1.5 font-mono text-[11px]"
            >
              + &#123;&#123;title&#125;&#125;
            </Button>
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
              onClick={() => insertToken('{{duration}}')}
              className="h-6 px-1.5 font-mono text-[11px]"
            >
              + &#123;&#123;duration&#125;&#125;
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => insertToken('{{meet_link}}')}
              className="h-6 px-1.5 font-mono text-[11px]"
            >
              + &#123;&#123;meet_link&#125;&#125;
            </Button>
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
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin mr-1.5" />}
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
              Verified appointments confirmed via the AI Agent pipeline or scheduled by your team.
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
                Appointments confirmed on Google Calendar will appear here.
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
