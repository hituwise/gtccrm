'use client';

import { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Video,
  Clock,
  Mail,
  Loader2,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Contact } from '@/types';
import type { CalendarBooking } from '@/types/calendar';
import { addDays, format, setHours, setMinutes, setSeconds, isWeekend } from 'date-fns';

interface BookMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  conversationId?: string;
  onBookingCreated?: (booking: CalendarBooking) => void;
}

export function BookMeetingDialog({
  open,
  onOpenChange,
  contact,
  conversationId,
  onBookingCreated,
}: BookMeetingDialogProps) {
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [sendWhatsAppConfirmation, setSendWhatsAppConfirmation] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Initialize or prefill fields whenever dialog opens or contact changes
  useEffect(() => {
    if (open && contact) {
      setEmail(contact.email || '');
      setTitle(`LeadPilot Demo Call: ${contact.name || contact.phone || 'Client'}`);

      // Default slot: tomorrow 11:00 AM (or next Monday if weekend)
      let nextDay = addDays(new Date(), 1);
      while (isWeekend(nextDay)) {
        nextDay = addDays(nextDay, 1);
      }
      const defaultStart = setSeconds(setMinutes(setHours(nextDay, 11), 0), 0);
      setDateTime(format(defaultStart, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [open, contact]);

  function applyQuickSlot(daysFromNow: number, hour: number) {
    let target = addDays(new Date(), daysFromNow);
    if (isWeekend(target)) {
      while (isWeekend(target)) {
        target = addDays(target, 1);
      }
    }
    const slot = setSeconds(setMinutes(setHours(target, hour), 0), 0);
    setDateTime(format(slot, "yyyy-MM-dd'T'HH:mm"));
  }

  async function handleBook() {
    if (!email.trim() || !email.includes('@')) {
      toast.error('Please enter a valid client email address');
      return;
    }
    if (!dateTime) {
      toast.error('Please select a meeting date and time');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/calendar/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.id,
          conversationId,
          email: email.trim().toLowerCase(),
          startTime: new Date(dateTime).toISOString(),
          title: title.trim() || `Demo Call: ${contact.name || 'Client'}`,
          durationMinutes: Number(duration) || 30,
          sendConfirmation: sendWhatsAppConfirmation,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to schedule booking');
      }

      toast.success(
        data.meetLink
          ? 'Demo call booked with Google Meet link & WhatsApp confirmation!'
          : 'Demo call scheduled successfully!',
      );

      if (onBookingCreated && data.booking) {
        onBookingCreated(data.booking);
      }

      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarIcon className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">Schedule Google Calendar Demo</DialogTitle>
              <DialogDescription className="text-xs">
                Books an event on Google Calendar, creates a Google Meet link, and sends confirmation.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Client Email Input */}
          <div className="space-y-1.5">
            <Label htmlFor="clientEmail" className="flex items-center gap-1.5 text-xs font-semibold">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Client Email Address <span className="text-destructive">*</span>
            </Label>
            <Input
              id="clientEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. client@company.com"
              className="text-sm"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Google Calendar invitation &amp; meeting link will be emailed to this address.
            </p>
          </div>

          {/* Quick Slot Presets */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" />
              Quick Slots:
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyQuickSlot(1, 10)}
                className="h-6 px-2 text-[11px]"
              >
                Tomorrow 10 AM
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyQuickSlot(1, 15)}
                className="h-6 px-2 text-[11px]"
              >
                Tomorrow 3 PM
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyQuickSlot(2, 11)}
                className="h-6 px-2 text-[11px]"
              >
                In 2 Days 11 AM
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyQuickSlot(3, 14)}
                className="h-6 px-2 text-[11px]"
              >
                In 3 Days 2 PM
              </Button>
            </div>
          </div>

          {/* Date & Time Picker */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dateTime" className="flex items-center gap-1.5 text-xs font-semibold">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Date &amp; Time
              </Label>
              <Input
                id="dateTime"
                type="datetime-local"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
                className="text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="duration" className="flex items-center gap-1.5 text-xs font-semibold">
                <Video className="h-3.5 w-3.5 text-muted-foreground" />
                Duration
              </Label>
              <select
                id="duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>
          </div>

          {/* Meeting Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-xs font-semibold">
              Event Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Demo Call"
              className="text-sm"
            />
          </div>

          {/* WhatsApp Confirmation Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                Send WhatsApp Confirmation
              </span>
              <p className="text-[11px] text-muted-foreground">
                Instantly sends the date, time, and Google Meet link into this WhatsApp chat.
              </p>
            </div>
            <input
              type="checkbox"
              checked={sendWhatsAppConfirmation}
              onChange={(e) => setSendWhatsAppConfirmation(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleBook} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Book with Google Meet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
