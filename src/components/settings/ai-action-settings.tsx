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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_PRODUCT_CONFIGS,
  type ProductKey,
  type ProductActionConfig,
} from '@/lib/ai/actions/types';
import type { AccountMember } from '@/types';
import { memberLabel } from '@/lib/account/members';
import { Sparkles, Calendar, Users, ShieldCheck, Tag } from 'lucide-react';

interface AiActionSettingsProps {
  canEdit: boolean;
  actionSystemEnabled: boolean;
  onToggleActionSystem: (val: boolean) => void;
  productConfigs: Record<ProductKey, ProductActionConfig>;
  onChangeProductConfigs: (configs: Record<ProductKey, ProductActionConfig>) => void;
  members: AccountMember[];
}

const PRODUCT_LABELS: Record<ProductKey, { name: string; desc: string }> = {
  ABACUS_KIDS: {
    name: 'Abacus Kids',
    desc: 'Mental Math program for children (5–14 yrs)',
  },
  GTC: {
    name: 'GTC Teacher Training',
    desc: 'Teacher certification and academy startup course',
  },
  RUBIKS_CUBE: {
    name: "Rubik's Cube",
    desc: 'Speedcubing and cube solving classes',
  },
  GOLD: {
    name: 'Gold Business Growth',
    desc: 'Coaching scaling, leads & sales acceleration',
  },
  MAA: {
    name: 'MAA Academy Software',
    desc: 'Software for student, fee, and academy management',
  },
  LEAD_PILOT: {
    name: 'Lead Pilot SaaS',
    desc: 'WhatsApp CRM and automated lead follow-up system',
  },
};

export function AiActionSettingsCard({
  canEdit,
  actionSystemEnabled,
  onToggleActionSystem,
  productConfigs,
  onChangeProductConfigs,
  members,
}: AiActionSettingsProps) {
  const [selectedProduct, setSelectedProduct] = useState<ProductKey>('ABACUS_KIDS');

  const currentCfg =
    productConfigs[selectedProduct] || DEFAULT_PRODUCT_CONFIGS[selectedProduct];

  const updateCurrentConfig = (patch: Partial<ProductActionConfig>) => {
    const updated = {
      ...productConfigs,
      [selectedProduct]: {
        ...currentCfg,
        ...patch,
      },
    };
    onChangeProductConfigs(updated);
  };

  return (
    <Card className="border border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              <CardTitle className="text-lg">AI Sales Action System</CardTitle>
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                Action-Taking Agent
              </Badge>
            </div>
            <CardDescription>
              Enables the AI to detect products, assign tags, update lead score & temperature,
              check calendar availability, and book appointments directly.
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
          {/* Product selector chips */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Configure Product Workflows & Routing
            </Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DEFAULT_PRODUCT_CONFIGS) as ProductKey[]).map((key) => {
                const isSelected = selectedProduct === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedProduct(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {PRODUCT_LABELS[key]?.name || key}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Product Details Card */}
          <div className="rounded-xl border border-muted bg-muted/20 p-4 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="font-semibold text-sm">
                  {PRODUCT_LABELS[selectedProduct].name}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {PRODUCT_LABELS[selectedProduct].desc}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <Badge variant="secondary" className="font-mono text-xs">
                  {currentCfg.tagName}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Appointment Type Title</Label>
                <Input
                  value={currentCfg.appointmentType}
                  onChange={(e) => updateCurrentConfig({ appointmentType: e.target.value })}
                  disabled={!canEdit}
                  placeholder="e.g. Free Abacus Demo"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Duration (Minutes)</Label>
                <Input
                  type="number"
                  min={15}
                  max={240}
                  value={currentCfg.durationMinutes}
                  onChange={(e) =>
                    updateCurrentConfig({ durationMinutes: parseInt(e.target.value, 10) || 30 })
                  }
                  disabled={!canEdit}
                />
              </div>

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

              <div className="space-y-1.5">
                <Label className="text-xs">Routing Team / Member</Label>
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
                      Default Team ({currentCfg.teamName})
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Lead Scoring Summary */}
          <div className="rounded-xl border border-muted bg-muted/10 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-semibold">Lead Scoring & Temperature Rules</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border bg-background p-2">
                <span className="block font-semibold text-muted-foreground">Cold Lead</span>
                <span className="text-xs text-muted-foreground">0 – 30 points</span>
              </div>
              <div className="rounded-md border bg-amber-500/10 p-2 text-amber-800">
                <span className="block font-semibold">Warm Lead</span>
                <span className="text-xs">31 – 70 points</span>
              </div>
              <div className="rounded-md border bg-rose-500/10 p-2 text-rose-800">
                <span className="block font-semibold">Hot Lead</span>
                <span className="text-xs">71 – 100 points</span>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
