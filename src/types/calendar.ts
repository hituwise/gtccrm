export type CalendarAuthType = 'service_account' | 'oauth';
export type BookingStatus = 'confirmed' | 'cancelled' | 'rescheduled';
export type BookedBy = 'ai' | 'agent' | 'flow' | 'manual';

export interface ServiceAccountKey {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
}

export interface OAuthCredentials {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
}

export interface GoogleCalendarConfig {
  id: string;
  account_id: string;
  created_by?: string | null;
  calendar_id: string;
  auth_type: CalendarAuthType;
  service_account_key?: string | null;
  oauth_credentials?: string | null;
  is_active: boolean;
  auto_booking_enabled: boolean;
  default_meeting_title: string;
  default_meeting_duration: number; // minutes
  default_timezone: string;
  working_hours_start: string;
  working_hours_end: string;
  buffer_between_meetings: number;
  confirmation_message_template: string;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarConfigSafe {
  configured: boolean;
  has_key?: boolean;
  calendar_id: string;
  auth_type: CalendarAuthType;
  is_active: boolean;
  auto_booking_enabled: boolean;
  default_meeting_title: string;
  default_meeting_duration: number;
  default_timezone: string;
  working_hours_start: string;
  working_hours_end: string;
  buffer_between_meetings: number;
  confirmation_message_template: string;
  service_account_email?: string | null;
  updated_at?: string;
}

export interface CalendarBooking {
  id: string;
  account_id: string;
  contact_id: string;
  conversation_id?: string | null;
  created_by?: string | null;
  booked_by: BookedBy;
  google_event_id?: string | null;
  google_calendar_id?: string | null;
  title: string;
  description?: string | null;
  attendee_email: string;
  attendee_name?: string | null;
  attendee_phone?: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  meet_link?: string | null;
  html_link?: string | null;
  status: BookingStatus;
  confirmation_sent: boolean;
  confirmation_sent_at?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateBookingPayload {
  contactId: string;
  conversationId?: string;
  email: string;
  name?: string;
  phone?: string;
  startTime?: string;
  title?: string;
  durationMinutes?: number;
  sendConfirmation?: boolean;
  notes?: string;
}

export interface BookingResult {
  success: boolean;
  booking?: CalendarBooking;
  confirmationMessage?: string;
  meetLink?: string | null;
  googleEventId?: string | null;
  readableDateTime?: string;
  error?: string;
}
