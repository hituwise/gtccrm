'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Package,
  Plus,
  Trash2,
  Archive,
  Clock,
  Video,
  Phone,
  Link as LinkIcon,
  Users,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Calendar,
  Sparkles,
  DollarSign,
  Tag,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  TenantProductConfig,
  MeetingLinkMode,
  SupportedBookingMethod,
} from '@/lib/ai/actions/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const APPOINTMENT_TYPES = [
  'Consultation',
  'Demo',
  'Sales Call',
  'Class',
  'Service Appointment',
  'Custom',
];

const MEETING_MODES: { label: string; value: MeetingLinkMode; desc: string }[] = [
  { label: 'Google Meet', value: 'GOOGLE_MEET', desc: 'Auto-generates Google Meet link via connected Google Calendar' },
  { label: 'Zoom Call', value: 'ZOOM', desc: 'Uses your configured Zoom meeting room link' },
  { label: 'Static Meeting Link', value: 'STATIC_MEETING_LINK', desc: 'Sends fixed video link (e.g. Teams, Whereby, personal room)' },
  { label: 'External Booking Page', value: 'BOOKING_PAGE', desc: 'Sends external booking URL (Calendly, Cal.com, custom page)' },
  { label: 'Phone Call', value: 'PHONE_CALL', desc: 'Direct audio call to customer phone number' },
  { label: 'Manual Follow-up', value: 'MANUAL_FOLLOW_UP', desc: 'Team contacts lead directly to schedule manually' },
  { label: 'Direct / In-Person', value: 'NONE', desc: 'No online meeting link needed' },
];

export function ProductsManager() {
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<TenantProductConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [hasGoogleCalendar, setHasGoogleCalendar] = useState<boolean>(false);

  // Form edit state for currently selected product
  const [formData, setFormData] = useState<Partial<TenantProductConfig>>({});

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json();
        const list: TenantProductConfig[] = Array.isArray(data.products) ? data.products : [];
        setProducts(list);
        if (list.length > 0) {
          setSelectedId((prev) => {
            if (prev && list.some((p) => p.productServiceId === prev)) {
              return prev;
            }
            return list[0].productServiceId;
          });
          setFormData((prev) => {
            if (prev?.productServiceId && list.some((p) => p.productServiceId === prev.productServiceId)) {
              return list.find((p) => p.productServiceId === prev.productServiceId) || list[0];
            }
            return list[0];
          });
          setIsCreatingNew(false);
        } else {
          // If the list is empty, only clear selectedId if we are not actively creating a new service
          setSelectedId((prev) => (prev && prev.startsWith('service_') ? prev : null));
        }
      }
    } catch {
      toast.error('Failed to load products & services');
    } finally {
      setLoading(false);
    }
  }, []);

  // Check Google Calendar connection status
  useEffect(() => {
    async function checkCalendar() {
      try {
        const res = await fetch('/api/calendar/config');
        if (res.ok) {
          const data = await res.json();
          setHasGoogleCalendar(Boolean(data?.is_active));
        }
      } catch {
        // ignore
      }
    }
    checkCalendar();
  }, [accountId]);

  // Fetch team members for lead assignment
  useEffect(() => {
    fetchAccountMembers()
      .then(setMembers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleSelectProduct = (prod: TenantProductConfig) => {
    setIsCreatingNew(false);
    setSelectedId(prod.productServiceId);
    setFormData({ ...prod });
  };

  const handleCreateNew = () => {
    const timestamp = Date.now();
    const newId = `service_${timestamp.toString().slice(-6)}`;
    const newProduct: TenantProductConfig = {
      productServiceId: newId,
      productKey: newId,
      name: 'New Coaching Service',
      description: 'Comprehensive 1-on-1 coaching program designed to achieve tangible outcomes.',
      category: 'Coaching',
      targetAudience: 'Professionals & Students',
      appointmentType: 'Consultation',
      durationMinutes: 45,
      price: null,
      currency: 'INR',
      isFree: false,
      workingHoursStart: '09:00',
      workingHoursEnd: '18:00',
      availabilityDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      meetingMode: hasGoogleCalendar ? 'GOOGLE_MEET' : 'PHONE_CALL',
      meetingLink: null,
      requiredFields: ['name', 'date', 'time'],
      optionalFields: ['email', 'notes'],
      tags: {
        interestTag: `${newId.toUpperCase()}_INTEREST`,
        bookedTag: `${newId.toUpperCase()}_BOOKED`,
      },
      ctaType: 'Call',
      teamName: 'General',
      enabled: true,
      archived: false,
      keywords: [],
      qualificationQuestions: [],
      followUpInstructions: 'Send welcome packet and follow up within 24 hours.',
    };

    setIsCreatingNew(true);
    setFormData(newProduct);
    setSelectedId(newId);
  };

  const handleCancelCreate = () => {
    setIsCreatingNew(false);
    if (products.length > 0) {
      setSelectedId(products[0].productServiceId);
      setFormData(products[0]);
    } else {
      setSelectedId(null);
      setFormData({});
    }
  };

  const handleSaveProduct = async () => {
    if (!formData.name || !formData.name.trim()) {
      toast.error('Service name is required');
      return;
    }
    if (!formData.productServiceId) {
      toast.error('Service ID is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save service');
      }

      const resData = await res.json().catch(() => ({}));
      const savedProd = resData.product || formData;

      toast.success('Product / Service saved successfully!');
      setIsCreatingNew(false);
      setSelectedId(savedProd.productServiceId || formData.productServiceId);
      await loadProducts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (serviceId: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
      const res = await fetch(`/api/products/${serviceId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Service deleted');
      await loadProducts();
    } catch {
      toast.error('Failed to delete product');
    }
  };

  const handleToggleArchive = async () => {
    const nextArchived = !formData.archived;
    setFormData((prev) => ({
      ...prev,
      archived: nextArchived,
      enabled: nextArchived ? false : prev.enabled,
    }));
  };

  const toggleDay = (day: string) => {
    const currentDays = formData.availabilityDays || [];
    const exists = currentDays.includes(day);
    const updated = exists ? currentDays.filter((d) => d !== day) : [...currentDays, day];
    setFormData((prev) => ({ ...prev, availabilityDays: updated }));
  };

  const toggleRequiredField = (field: 'email' | 'name') => {
    const req = formData.requiredFields || ['name', 'date', 'time'];
    const opt = formData.optionalFields || ['email', 'notes'];
    if (req.includes(field)) {
      setFormData((prev) => ({
        ...prev,
        requiredFields: req.filter((f) => f !== field),
        optionalFields: Array.from(new Set([...opt, field])),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        requiredFields: Array.from(new Set([...req, field])),
        optionalFields: opt.filter((f) => f !== field),
      }));
    }
  };

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Loading your products and services catalog...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Products & Services Manager
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure your business&apos;s services, appointment types, pricing, working hours, and meeting delivery modes.
            The AI Agent will represent strictly these services.
          </p>
        </div>

        {canEdit && (
          <Button onClick={handleCreateNew} size="sm" className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Add Product or Service
          </Button>
        )}
      </div>

      {/* Empty State */}
      {products.length === 0 && !isCreatingNew && !selectedId ? (
        <Card className="border-dashed border-2 border-border/80 bg-muted/10">
          <CardContent className="flex flex-col items-center justify-center text-center p-12 space-y-4">
            <div className="rounded-full bg-primary/10 p-4 text-primary">
              <Package className="h-10 w-10" />
            </div>
            <div className="max-w-md space-y-1.5">
              <h3 className="font-semibold text-lg text-foreground">No Products or Services Configured</h3>
              <p className="text-sm text-muted-foreground">
                Your catalog is currently empty. New accounts start with zero predefined services so you have complete control over your offerings.
              </p>
            </div>
            {canEdit && (
              <Button onClick={handleCreateNew} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Your First Service
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Services List Sidebar */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
              <span>Configured Services ({products.length + (isCreatingNew ? 1 : 0)})</span>
              <button
                type="button"
                onClick={loadProducts}
                className="hover:text-foreground flex items-center gap-1"
                title="Refresh catalog"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>

            <div className="space-y-2">
              {isCreatingNew && (
                <div
                  className="cursor-pointer rounded-xl border p-3.5 transition-all text-left border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {formData.name || 'New Coaching Service'}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 border-blue-400 bg-blue-50 text-blue-700">
                      Draft
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-1">
                    {formData.description || 'Drafting new service...'}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formData.durationMinutes || 45}m
                    </span>
                    <span>•</span>
                    <span>{formData.meetingMode || 'Phone Call'}</span>
                  </div>
                </div>
              )}

              {products.map((item) => {
                const isSelected = selectedId === item.productServiceId;
                return (
                  <div
                    key={item.productServiceId}
                    onClick={() => handleSelectProduct(item)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all text-left ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                        : 'border-border/60 bg-card hover:bg-muted/40 hover:border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-foreground truncate">
                        {item.name}
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${
                          item.archived
                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                            : item.enabled
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-muted-foreground/30 text-muted-foreground'
                        }`}
                      >
                        {item.archived ? 'Archived' : item.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>

                    <div className="mt-1 text-xs text-muted-foreground line-clamp-1">
                      {item.description || 'No description'}
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.durationMinutes}m
                      </span>
                      <span>•</span>
                      <span>
                        {item.isFree ? 'Free' : item.price !== null ? `${item.currency || 'INR'} ${item.price}` : 'Unpriced'}
                      </span>
                      <span>•</span>
                      <span className="truncate max-w-[110px]">
                        {item.meetingMode || 'Phone Call'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Service Editor Form */}
          <div className="lg:col-span-8">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="border-b pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span>{formData.name || 'Service Details'}</span>
                      {formData.archived && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 text-xs">
                          Archived
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Service ID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{formData.productServiceId}</code>
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 mr-2">
                      <Label htmlFor="service-active" className="text-xs text-muted-foreground">Active</Label>
                      <Switch
                        id="service-active"
                        checked={formData.enabled !== false && !formData.archived}
                        onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, enabled: checked }))}
                        disabled={!canEdit || formData.archived}
                      />
                    </div>

                    {canEdit && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleToggleArchive}
                          className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                          title={formData.archived ? 'Restore service' : 'Archive service'}
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {formData.archived ? 'Restore' : 'Archive'}
                        </Button>

                        {formData.productServiceId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteProduct(formData.productServiceId!)}
                            className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                            title="Delete service"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                {/* 1. Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Service Name *</Label>
                    <Input
                      value={formData.name || ''}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="e.g. 1-on-1 Strategy Coaching"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Unique Service ID / Slug</Label>
                    <Input
                      value={formData.productServiceId || ''}
                      onChange={(e) => setFormData((prev) => ({ ...prev, productServiceId: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="e.g. strategy_coaching"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Category</Label>
                    <Input
                      value={formData.category || ''}
                      onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="e.g. Executive Coaching, Fitness, Tutoring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Target Audience</Label>
                    <Input
                      value={formData.targetAudience || ''}
                      onChange={(e) => setFormData((prev) => ({ ...prev, targetAudience: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="e.g. Founders, Parents of kids aged 6-12"
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs font-semibold">Description (Used by AI Agent)</Label>
                    <Textarea
                      rows={2}
                      value={formData.description || ''}
                      onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="Detailed explanation of what this service includes and who it is for"
                    />
                  </div>
                </div>

                {/* 2. Pricing & Appointment Type */}
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5" />
                    Pricing & Appointment Type
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Appointment Type</Label>
                      <Select
                        value={formData.appointmentType || 'Consultation'}
                        onValueChange={(val) => setFormData((prev) => ({ ...prev, appointmentType: val || 'Consultation' }))}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPOINTMENT_TYPES.map((t) => (
                            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Duration (Minutes)</Label>
                      <Input
                        type="number"
                        min={5}
                        max={480}
                        value={formData.durationMinutes || 45}
                        onChange={(e) => setFormData((prev) => ({ ...prev, durationMinutes: Number(e.target.value) }))}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Price & Currency</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="0 or amount"
                          value={formData.price !== null && formData.price !== undefined ? formData.price : ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : Number(e.target.value);
                            setFormData((prev) => ({ ...prev, price: val, isFree: val === 0 }));
                          }}
                          disabled={!canEdit || formData.isFree}
                          className="w-2/3"
                        />
                        <Input
                          value={formData.currency || 'INR'}
                          onChange={(e) => setFormData((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                          disabled={!canEdit || formData.isFree}
                          className="w-1/3 uppercase font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      id="is-free"
                      checked={Boolean(formData.isFree)}
                      onCheckedChange={(checked) => setFormData((prev) => ({
                        ...prev,
                        isFree: checked,
                        price: checked ? 0 : prev.price,
                      }))}
                      disabled={!canEdit}
                    />
                    <Label htmlFor="is-free" className="text-xs font-medium cursor-pointer">
                      Free Consultation or Trial Session (No fee charged)
                    </Label>
                  </div>
                </div>

                {/* 3. Schedule & Working Hours */}
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Availability & Schedule (Grounded AI Answers)
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Working Hours Start</Label>
                      <Input
                        type="time"
                        value={formData.workingHoursStart || '09:00'}
                        onChange={(e) => setFormData((prev) => ({ ...prev, workingHoursStart: e.target.value }))}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Working Hours End</Label>
                      <Input
                        type="time"
                        value={formData.workingHoursEnd || '18:00'}
                        onChange={(e) => setFormData((prev) => ({ ...prev, workingHoursEnd: e.target.value }))}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Timezone</Label>
                      <Input
                        value={formData.timezone || 'Asia/Kolkata'}
                        onChange={(e) => setFormData((prev) => ({ ...prev, timezone: e.target.value }))}
                        disabled={!canEdit}
                        placeholder="e.g. Asia/Kolkata"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs">Available Days</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS_OF_WEEK.map((day) => {
                        const active = (formData.availabilityDays || []).includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleDay(day)}
                            disabled={!canEdit}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-all ${
                              active
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-border hover:bg-muted'
                            }`}
                          >
                            {day.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 4. Booking Method & Meeting Delivery */}
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Video className="h-3.5 w-3.5" />
                    Delivery Mode & Meeting Configuration
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Meeting Mode</Label>
                      <Select
                        value={formData.meetingMode || 'PHONE_CALL'}
                        onValueChange={(val) => setFormData((prev) => ({ ...prev, meetingMode: (val || 'PHONE_CALL') as MeetingLinkMode }))}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEETING_MODES.map((m) => (
                            <SelectItem key={m.value} value={m.value} className="text-xs">
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {MEETING_MODES.find((m) => m.value === formData.meetingMode)?.desc}
                      </p>
                    </div>

                    {(formData.meetingMode === 'STATIC_MEETING_LINK' ||
                      formData.meetingMode === 'ZOOM' ||
                      formData.meetingMode === 'BOOKING_PAGE') && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Meeting URL / Link</Label>
                        <Input
                          value={formData.meetingLink || ''}
                          onChange={(e) => setFormData((prev) => ({ ...prev, meetingLink: e.target.value }))}
                          disabled={!canEdit}
                          placeholder="https://zoom.us/j/... or https://meet.example.com/..."
                        />
                      </div>
                    )}
                  </div>

                  {formData.meetingMode === 'GOOGLE_MEET' && !hasGoogleCalendar && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                      <div>
                        <strong>Google Calendar Not Connected:</strong> You have selected Google Meet, but this account has not connected Google Calendar yet.
                        The AI will not promise Meet links until Google Calendar is connected in Settings &gt; Google Calendar.
                      </div>
                    </div>
                  )}
                </div>

                {/* 5. Customer Fields & Team Assignment */}
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Customer Details & Lead Assignment
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Required Customer Details</Label>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="req-email"
                            checked={(formData.requiredFields || []).includes('email')}
                            onCheckedChange={() => toggleRequiredField('email')}
                            disabled={!canEdit}
                          />
                          <Label htmlFor="req-email" className="text-xs cursor-pointer">
                            Require Customer Email (If off, bookings proceed without asking repeatedly)
                          </Label>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Assigned Team / Queue</Label>
                      <Input
                        value={formData.teamName || 'General'}
                        onChange={(e) => setFormData((prev) => ({ ...prev, teamName: e.target.value }))}
                        disabled={!canEdit}
                        placeholder="e.g. Sales, Admissions, Coaching"
                      />
                    </div>
                  </div>
                </div>

                {/* Save CTA */}
                {canEdit && (
                  <div className="flex items-center justify-end gap-3 pt-4 border-t">
                    {isCreatingNew && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelCreate}
                        disabled={saving}
                        className="text-xs"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      onClick={handleSaveProduct}
                      disabled={saving}
                      className="gap-2 shadow-sm min-w-[140px]"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Save Service
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
