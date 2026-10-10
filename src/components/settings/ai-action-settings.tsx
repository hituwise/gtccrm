'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type ProductActionConfig,
  type MeetingLinkMode,
} from '@/lib/ai/actions/types';
import type { AccountMember } from '@/types';
import { memberLabel } from '@/lib/account/members';
import {
  Sparkles,
  ShieldCheck,
  Tag,
  Plus,
  Trash2,
  Video,
  Clock,
  Link as LinkIcon,
  CheckCircle2,
  Layers,
} from 'lucide-react';

interface AiActionSettingsProps {
  canEdit: boolean;
  actionSystemEnabled: boolean;
  onToggleActionSystem: (val: boolean) => void;
  productConfigs: Record<string, ProductActionConfig>;
  onChangeProductConfigs: (configs: Record<string, ProductActionConfig>) => void;
  members: AccountMember[];
}

export function AiActionSettingsCard({
  canEdit,
  actionSystemEnabled,
  onToggleActionSystem,
  productConfigs,
  onChangeProductConfigs,
  members,
}: AiActionSettingsProps) {
  const productKeys = Object.keys(productConfigs);
  const [selectedProduct, setSelectedProduct] = useState<string>(() => {
    return productKeys[0] || 'service_1';
  });

  // Keep selectedProduct pointing to a valid product if possible
  const activeKey = productKeys.includes(selectedProduct)
    ? selectedProduct
    : productKeys[0] || '';

  const currentCfg: ProductActionConfig | undefined = productConfigs[activeKey];

  const updateCurrentConfig = (patch: Partial<ProductActionConfig>) => {
    if (!activeKey || !currentCfg) return;
    const updated = {
      ...productConfigs,
      [activeKey]: {
        ...currentCfg,
        ...patch,
      },
    };
    onChangeProductConfigs(updated);
  };

  const handleAddProduct = () => {
    const timestamp = Date.now();
    const newKey = `service_${timestamp}`;
    const newProduct: ProductActionConfig = {
      productKey: newKey,
      productServiceId: newKey,
      name: 'New Service',
      description: 'Description of your service or offer',
      category: 'Coaching / Consulting',
      appointmentType: 'Consultation Call',
      durationMinutes: 30,
      meetingMode: 'PHONE_CALL',
      meetingLink: null,
      tagName: `SERVICE_${timestamp.toString().slice(-4)}_INTEREST`,
      ctaType: 'Call',
      teamName: 'General',
      eventTitleTemplate: '{{name}} - Consultation',
      enabled: true,
      requiredFields: ['name'],
      optionalFields: ['email', 'phone'],
      tags: {
        interestTag: `SERVICE_${timestamp.toString().slice(-4)}_INTEREST`,
        bookedTag: `SERVICE_${timestamp.toString().slice(-4)}_BOOKED`,
      },
    };

    const updated = {
      ...productConfigs,
      [newKey]: newProduct,
    };
    onChangeProductConfigs(updated);
    setSelectedProduct(newKey);
  };

  const handleDeleteProduct = (keyToDelete: string) => {
    if (!confirm('Are you sure you want to remove this product/service?')) return;
    const nextConfigs = { ...productConfigs };
    delete nextConfigs[keyToDelete];
    onChangeProductConfigs(nextConfigs);
    const remainingKeys = Object.keys(nextConfigs);
    if (remainingKeys.length > 0) {
      setSelectedProduct(remainingKeys[0]);
    }
  };

  const isEmailRequired = (currentCfg?.requiredFields || []).includes('email');
  const toggleEmailRequired = (required: boolean) => {
    const prevRequired = currentCfg?.requiredFields || ['name'];
    let nextRequired: string[];
    let nextOptional = currentCfg?.optionalFields || ['email', 'phone'];

    if (required) {
      nextRequired = Array.from(new Set([...prevRequired, 'email']));
      nextOptional = nextOptional.filter((f) => f !== 'email');
    } else {
      nextRequired = prevRequired.filter((f) => f !== 'email');
      nextOptional = Array.from(new Set([...nextOptional, 'email']));
    }

    updateCurrentConfig({
      requiredFields: nextRequired,
      optionalFields: nextOptional,
    });
  };

  return (
    <Card className="border border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              <CardTitle className="text-lg">AI Sales & Booking Architecture</CardTitle>
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                Multi-Tenant Catalogue
              </Badge>
            </div>
            <CardDescription>
              Configure your business&apos;s dynamic products, services, durations, meeting modes, and CRM tags.
              The AI Agent detects matching services and books appointments according to your rules.
            </CardDescription>
          </div>
          <Switch
            checked={actionSystemEnabled}
            onCheckedChange={onToggleActionSystem}
            disabled={!canEdit}
          />
        </div>
      </CardHeader>

      {actionSystemEnabled && (
        <CardContent className="space-y-6 pt-2">
          {/* Product selector chips + Add Button */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your Products & Services ({productKeys.length})
              </Label>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddProduct}
                  className="h-7 gap-1 px-2.5 text-xs text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Product / Service
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {productKeys.map((key) => {
                const item = productConfigs[key];
                const isSelected = activeKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedProduct(key)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span>{item?.name || key}</span>
                    {item?.enabled === false && (
                      <span className="text-[10px] opacity-70">(Paused)</span>
                    )}
                  </button>
                );
              })}
              {productKeys.length === 0 && (
                <div className="text-xs text-muted-foreground py-2">
                  No products configured yet. Click &quot;Add Product / Service&quot; above to add your first offer.
                </div>
              )}
            </div>
          </div>

          {/* Active Product Details Card */}
          {currentCfg && (
            <div className="rounded-xl border border-muted bg-muted/20 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm">
                      {currentCfg.name || activeKey}
                    </h4>
                    <Badge variant="outline" className="text-[11px] font-mono">
                      {currentCfg.category || 'Service'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {currentCfg.description || 'No description provided'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 mr-2">
                    <Label htmlFor="product-enabled" className="text-xs text-muted-foreground">Active</Label>
                    <Switch
                      id="product-enabled"
                      checked={currentCfg.enabled !== false}
                      onCheckedChange={(val) => updateCurrentConfig({ enabled: val })}
                      disabled={!canEdit}
                    />
                  </div>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProduct(activeKey)}
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                      title="Delete Product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Product Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Product / Service Name</Label>
                  <Input
                    value={currentCfg.name}
                    onChange={(e) => updateCurrentConfig({ name: e.target.value })}
                    disabled={!canEdit}
                    placeholder="e.g. 1-on-1 Business Coaching"
                  />
                </div>

                {/* Category */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Input
                    value={currentCfg.category || ''}
                    onChange={(e) => updateCurrentConfig({ category: e.target.value })}
                    disabled={!canEdit}
                    placeholder="e.g. Fitness, Coaching, Academy"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs">Description (Used by AI for Intent Detection)</Label>
                  <Input
                    value={currentCfg.description || ''}
                    onChange={(e) => updateCurrentConfig({ description: e.target.value })}
                    disabled={!canEdit}
                    placeholder="e.g. Personalized weight training and nutrition guidance for busy professionals"
                  />
                </div>

                {/* Appointment Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Appointment Type Title</Label>
                  <Input
                    value={currentCfg.appointmentType}
                    onChange={(e) => updateCurrentConfig({ appointmentType: e.target.value })}
                    disabled={!canEdit}
                    placeholder="e.g. Consultation Session"
                  />
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Duration (Minutes)</Label>
                  <Input
                    type="number"
                    min={5}
                    max={240}
                    value={currentCfg.durationMinutes}
                    onChange={(e) =>
                      updateCurrentConfig({ durationMinutes: parseInt(e.target.value, 10) || 30 })
                    }
                    disabled={!canEdit}
                  />
                </div>

                {/* Meeting Link Mode */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Video className="h-3.5 w-3.5 text-primary" />
                    Meeting Provider Mode
                  </Label>
                  <Select
                    value={currentCfg.meetingMode || 'GOOGLE_MEET'}
                    onValueChange={(val) => {
                      if (val) updateCurrentConfig({ meetingMode: val as MeetingLinkMode });
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GOOGLE_MEET">Google Meet (Dynamic calendar link)</SelectItem>
                      <SelectItem value="ZOOM">Zoom (Dynamic or Static Zoom room)</SelectItem>
                      <SelectItem value="STATIC_MEETING_LINK">Static Meeting URL (Direct link)</SelectItem>
                      <SelectItem value="BOOKING_PAGE">Booking Page (Self-scheduling URL)</SelectItem>
                      <SelectItem value="NONE">Phone / In-Person (No video link)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Static Link / Booking Page URL */}
                {currentCfg.meetingMode !== 'GOOGLE_MEET' && currentCfg.meetingMode !== 'NONE' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1">
                      <LinkIcon className="h-3.5 w-3.5 text-primary" />
                      Meeting / Booking Page URL
                    </Label>
                    <Input
                      value={currentCfg.meetingLink || ''}
                      onChange={(e) => updateCurrentConfig({ meetingLink: e.target.value })}
                      disabled={!canEdit}
                      placeholder="https://zoom.us/j/... or https://cal.com/..."
                    />
                  </div>
                )}

                {/* Call to Action Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Call to Action (CTA)</Label>
                  <Select
                    value={currentCfg.ctaType}
                    onValueChange={(val) => {
                      if (val === 'Demo' || val === 'Call' || val === 'Demo/Call') {
                        updateCurrentConfig({ ctaType: val });
                      }
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Demo">Demo</SelectItem>
                      <SelectItem value="Call">Call</SelectItem>
                      <SelectItem value="Demo/Call">Demo / Call</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Routing Team / Member */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Routing Team / Staff Member</Label>
                  <Select
                    value={currentCfg.assignedAgentId || '__team__'}
                    onValueChange={(val) =>
                      updateCurrentConfig({ assignedAgentId: val === '__team__' ? null : val })
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={currentCfg.teamName || 'Select agent'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__team__">
                        Default Team ({currentCfg.teamName || 'General'})
                      </SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {memberLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* CRM Interest Tag */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    CRM Interest Tag
                  </Label>
                  <Input
                    value={currentCfg.tags?.interestTag || currentCfg.tagName}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateCurrentConfig({
                        tagName: val,
                        tags: {
                          interestTag: val,
                          bookedTag: currentCfg.tags?.bookedTag || `${val}_BOOKED`,
                        },
                      });
                    }}
                    disabled={!canEdit}
                    placeholder="e.g. FITNESS_INTEREST"
                    className="font-mono text-xs"
                  />
                </div>

                {/* CRM Booked Tag */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    CRM Booked Tag
                  </Label>
                  <Input
                    value={currentCfg.tags?.bookedTag || `${currentCfg.tagName}_BOOKED`}
                    onChange={(e) => {
                      updateCurrentConfig({
                        tags: {
                          interestTag: currentCfg.tags?.interestTag || currentCfg.tagName,
                          bookedTag: e.target.value,
                        },
                      });
                    }}
                    disabled={!canEdit}
                    placeholder="e.g. FITNESS_BOOKED"
                    className="font-mono text-xs"
                  />
                </div>

                {/* Email Required Toggle */}
                <div className="space-y-1.5 md:col-span-2 rounded-lg border border-border/60 bg-background/50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold">Require Email for Booking</div>
                      <p className="text-[11px] text-muted-foreground">
                        {isEmailRequired
                          ? 'AI will require customer email before confirming appointment.'
                          : 'Email is optional. AI will book via WhatsApp/phone without blocking on email.'}
                      </p>
                    </div>
                    <Switch
                      checked={isEmailRequired}
                      onCheckedChange={toggleEmailRequired}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Lead Scoring Summary */}
          <div className="rounded-xl border border-muted bg-muted/10 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-semibold">CRM Milestones & Lead Progression</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border bg-background p-2">
                <span className="block font-semibold text-muted-foreground">Inquiry</span>
                <span className="text-xs text-muted-foreground">Interest Tag Applied</span>
              </div>
              <div className="rounded-md border bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
                <span className="block font-semibold">Slot Verified</span>
                <span className="text-xs">Calendar Check</span>
              </div>
              <div className="rounded-md border bg-emerald-500/10 p-2 text-emerald-800 dark:text-emerald-300">
                <span className="block font-semibold">Confirmed</span>
                <span className="text-xs">Booked Tag + WhatsApp Sent</span>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
