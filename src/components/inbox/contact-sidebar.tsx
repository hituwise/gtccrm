"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  X,
  Search,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { contactHandle } from "@/lib/whatsapp/wa-identity";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface ContactSidebarProps {
  contact: Contact | null;
  onTagsChange?: (tags: Tag[]) => void;
}

export function ContactSidebar({ contact, onTagsChange }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loadingAccountTags, setLoadingAccountTags] = useState(false);
  const [searchTagQuery, setSearchTagQuery] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [mutatingTagId, setMutatingTagId] = useState<string | null>(null);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    // Copies whatever the row displays — a BSUID-only contact has no
    // phone number to copy, but its @username still identifies them.
    const handle = contact ? contactHandle(contact) : '';
    if (!handle) return;
    await navigator.clipboard.writeText(handle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const fetchAccountTags = useCallback(async () => {
    if (!accountId) return;
    setLoadingAccountTags(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("tags")
      .select("*")
      .order("name");
    if (data) {
      setAllTags(data);
    }
    setLoadingAccountTags(false);
  }, [accountId]);

  useEffect(() => {
    fetchAccountTags();
  }, [fetchAccountTags]);

  const filteredTags = useMemo(() => {
    const q = searchTagQuery.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, searchTagQuery]);

  const hasExactMatch = useMemo(() => {
    const q = searchTagQuery.trim().toLowerCase();
    if (!q) return false;
    return allTags.some((t) => t.name.toLowerCase() === q);
  }, [allTags, searchTagQuery]);

  const handleToggleTag = useCallback(
    async (tag: Tag) => {
      if (!contact || mutatingTagId) return;
      const isSelected = tags.some((t) => t.id === tag.id);
      setMutatingTagId(tag.id);

      const previousTags = [...tags];
      const newTags = isSelected
        ? tags.filter((t) => t.id !== tag.id)
        : [...tags, { ...tag, contact_tag_id: tag.id }];

      setTags(newTags);
      onTagsChange?.(newTags);

      try {
        if (isSelected) {
          await deleteContactTag(contact.id, tag.id);
        } else {
          await addContactTag(contact.id, tag.id);
        }
      } catch (error) {
        setTags(previousTags);
        onTagsChange?.(previousTags);
        toast.error(
          error instanceof Error ? error.message : "Failed to update tag"
        );
      } finally {
        setMutatingTagId(null);
      }
    },
    [contact, mutatingTagId, tags, onTagsChange]
  );

  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      if (!contact || mutatingTagId) return;
      setMutatingTagId(tagId);

      const previousTags = [...tags];
      const newTags = tags.filter((t) => t.id !== tagId);

      setTags(newTags);
      onTagsChange?.(newTags);

      try {
        await deleteContactTag(contact.id, tagId);
      } catch (error) {
        setTags(previousTags);
        onTagsChange?.(previousTags);
        toast.error(
          error instanceof Error ? error.message : "Failed to remove tag"
        );
      } finally {
        setMutatingTagId(null);
      }
    },
    [contact, mutatingTagId, tags, onTagsChange]
  );

  const handleCreateAndAddTag = useCallback(async () => {
    const trimmed = searchTagQuery.trim();
    if (!contact || !accountId || !trimmed || creatingTag) return;

    setCreatingTag(true);
    const color = PRESET_COLORS[allTags.length % PRESET_COLORS.length];

    try {
      const supabase = createClient();
      const { data: createdTag, error: createError } = await supabase
        .from("tags")
        .insert({
          account_id: accountId,
          name: trimmed,
          color,
        })
        .select()
        .single();

      if (createError || !createdTag) {
        throw new Error(createError?.message ?? "Failed to create tag");
      }

      setAllTags((prev) =>
        [...prev, createdTag].sort((a, b) => a.name.localeCompare(b.name))
      );
      setSearchTagQuery("");

      await addContactTag(contact.id, createdTag.id);
      const newTags = [...tags, { ...createdTag, contact_tag_id: createdTag.id }];
      setTags(newTags);
      onTagsChange?.(newTags);
      toast.success(tSidebar("createTag", { name: trimmed }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create tag"
      );
    } finally {
      setCreatingTag(false);
    }
  }, [contact, accountId, searchTagQuery, creatingTag, allTags, tags, onTagsChange, tSidebar]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">
                {contactHandle(contact)}
              </span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={tSidebar("addTag")}
                  title={tSidebar("addTag")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-56 p-2 text-xs"
                  sideOffset={6}
                >
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchTagQuery}
                      onChange={(e) => setSearchTagQuery(e.target.value)}
                      placeholder={tSidebar("searchTags")}
                      className="w-full rounded-md border border-border bg-muted/50 py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                  </div>

                  {loadingAccountTags ? (
                    <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      <span>Loading...</span>
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {filteredTags.length === 0 && !hasExactMatch && !searchTagQuery.trim() ? (
                        <p className="py-2 text-center text-xs text-muted-foreground">
                          {tSidebar("noTagsAvailable")}
                        </p>
                      ) : filteredTags.length === 0 && searchTagQuery.trim() && !hasExactMatch ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground">
                          {tSidebar("noMatchingTags")}
                        </p>
                      ) : (
                        filteredTags.map((t) => {
                          const isSelected = tags.some((ct) => ct.id === t.id);
                          const isMutating = mutatingTagId === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              disabled={isMutating}
                              onClick={() => handleToggleTag(t)}
                              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: t.color }}
                                />
                                <span className="truncate font-medium text-foreground">
                                  {t.name}
                                </span>
                              </div>
                              {isMutating ? (
                                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                              ) : isSelected ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : null}
                            </button>
                          );
                        })
                      )}

                      {searchTagQuery.trim() && !hasExactMatch && (
                        <div className="mt-1 border-t border-border pt-1">
                          <button
                            type="button"
                            disabled={creatingTag}
                            onClick={handleCreateAndAddTag}
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                          >
                            {creatingTag ? (
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3 shrink-0" />
                            )}
                            <span className="truncate">
                              {tSidebar("createTag", {
                                name: searchTagQuery.trim(),
                              })}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              {tags.length === 0 ? (
                <div className="flex items-center gap-2 px-1">
                  <p className="text-xs text-muted-foreground">{tSidebar("noTags")}</p>
                  <button
                    type="button"
                    onClick={() => setPopoverOpen(true)}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" />
                    {tSidebar("addTag")}
                  </button>
                </div>
              ) : (
                <>
                  {tags.map((tag) => (
                    <span
                      key={tag.contact_tag_id || tag.id}
                      className="group inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[10px] font-medium transition-all"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      <span>{tag.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTag(tag.id);
                        }}
                        disabled={mutatingTagId === tag.id}
                        className="rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                        aria-label={tSidebar("removeTag")}
                        title={tSidebar("removeTag")}
                      >
                        {mutatingTagId === tag.id ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <X className="h-2.5 w-2.5" />
                        )}
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPopoverOpen(true)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    aria-label={tSidebar("addTag")}
                    title={tSidebar("addTag")}
                  >
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
