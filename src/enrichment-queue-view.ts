import type { WorkspaceLeaf } from "obsidian";
import { ItemView, Notice, TFile } from "obsidian";
import type { VaultAdapter } from "./vault-adapter";
import {
  loadEnrichmentState,
  transitionEnrichmentState,
  type EnrichmentState,
  type EnrichmentStateRecord,
  type HumanInterventionTrigger,
} from "./enrichment-state";
import { applyPatchPlan, type PatchPlan } from "./patch-plan";

export const ENRICHMENT_QUEUE_VIEW = "ai-copilot-enrichment-queue-view";

type QueueGroup = "human-required" | "suggested" | "auto-enriched";

const GROUP_LABELS: Record<QueueGroup, string> = {
  "human-required": "Needs Review",
  "suggested": "Awaiting Approval",
  "auto-enriched": "Auto-Enriched (Info)",
};

const GROUP_ORDER: QueueGroup[] = ["human-required", "suggested", "auto-enriched"];

const TRIGGER_LABELS: Record<HumanInterventionTrigger, string> = {
  "low-confidence": "Low confidence",
  "conflicting-evidence": "Conflicting evidence",
  "ambiguous-intent": "Ambiguous intent",
  "destructive-rewrite": "Large rewrite",
  "safety-failure": "Safety issue",
  "all-conflicting": "All edits conflict",
  "cross-note": "Cross-note analysis",
};

export interface EnrichmentQueueDeps {
  vault: VaultAdapter;
  getEnrichmentDir: () => string;
}

export class EnrichmentQueueView extends ItemView {
  private vault: VaultAdapter | null = null;
  private records: EnrichmentStateRecord[] = [];
  private pendingCount = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return ENRICHMENT_QUEUE_VIEW;
  }

  getDisplayText() {
    return "Enrichment Queue";
  }

  getIcon() {
    return "list-checks";
  }

  setDeps(vault: VaultAdapter) {
    this.vault = vault;
  }

  getPendingCount(): number {
    return this.pendingCount;
  }

  async onOpen() {
    await this.refresh();
  }

  async refresh() {
    if (!this.vault) return;
    await this.loadRecords();
    this.render();
  }

  private async loadRecords() {
    if (!this.vault) return;
    const dir = "AI Copilot/.enrichment";
    if (!this.vault.exists(dir)) {
      this.records = [];
      this.pendingCount = 0;
      return;
    }

    const files = this.vault.listMarkdownFiles
      ? this.vault.listMarkdownFiles()
      : [];

    // Load all enrichment sidecar files
    const allFiles = files.filter((f) => f.path.startsWith(dir) && f.path.endsWith(".json"));

    // If listMarkdownFiles doesn't return JSON files, scan via exists
    // We need a different approach — scan by loading known note paths
    const records: EnrichmentStateRecord[] = [];

    // Try to list enrichment files by reading the directory
    // VaultAdapter doesn't have listFiles, so we check all markdown files
    // and try to load their enrichment state
    const mdFiles = this.vault.listMarkdownFiles().filter(
      (f) => !f.path.startsWith("AI Copilot/")
    );

    for (const file of mdFiles) {
      try {
        const record = await loadEnrichmentState(this.vault, file.path);
        if (
          record.state === "suggested" ||
          record.state === "human-required" ||
          record.state === "auto-enriched"
        ) {
          records.push(record);
        }
      } catch {
        // Skip files with broken state
      }
    }

    this.records = records;
    this.pendingCount = records.filter(
      (r) => r.state === "suggested" || r.state === "human-required"
    ).length;
  }

  private render() {
    const root = this.containerEl.children[1];
    root.empty();

    // Header
    const header = root.createDiv({ cls: "ai-copilot-eq-header" });
    header.createEl("h3", { text: "Enrichment Queue" });
    const refreshBtn = header.createEl("button", {
      text: "Refresh",
      cls: "ai-copilot-eq-refresh",
    });
    refreshBtn.onclick = () => void this.refresh();

    // Badge
    if (this.pendingCount > 0) {
      header.createEl("span", {
        text: `${this.pendingCount}`,
        cls: "ai-copilot-eq-badge",
      });
    }

    if (this.records.length === 0) {
      root.createDiv({
        text: "No enrichment suggestions pending.",
        cls: "ai-copilot-eq-empty",
      });
      return;
    }

    // Group records by state
    const grouped = new Map<QueueGroup, EnrichmentStateRecord[]>();
    for (const group of GROUP_ORDER) {
      grouped.set(group, []);
    }
    for (const record of this.records) {
      const group = record.state as QueueGroup;
      if (grouped.has(group)) {
        grouped.get(group)!.push(record);
      }
    }

    // Render each group
    const list = root.createDiv({ cls: "ai-copilot-eq-list" });
    for (const group of GROUP_ORDER) {
      const items = grouped.get(group) ?? [];
      if (items.length === 0) continue;

      const section = list.createDiv({ cls: "ai-copilot-eq-section" });
      section.createEl("h4", {
        text: `${GROUP_LABELS[group]} (${items.length})`,
        cls: "ai-copilot-eq-group-label",
      });

      for (const record of items) {
        this.renderRecord(section, record, group);
      }
    }
  }

  private renderRecord(
    container: HTMLElement,
    record: EnrichmentStateRecord,
    group: QueueGroup
  ) {
    const card = container.createDiv({ cls: "ai-copilot-eq-card" });

    // Note title (clickable)
    const titleRow = card.createDiv({ cls: "ai-copilot-eq-title-row" });
    const noteLink = titleRow.createEl("a", {
      text: record.notePath,
      href: "#",
      cls: "ai-copilot-eq-note-link",
    });
    noteLink.onclick = (e) => {
      e.preventDefault();
      void this.openNote(record.notePath);
    };

    // Confidence badge
    if (record.avgConfidence !== null) {
      const pct = Math.round(record.avgConfidence * 100);
      const cls =
        pct >= 80
          ? "ai-copilot-eq-conf-high"
          : pct >= 60
            ? "ai-copilot-eq-conf-mid"
            : "ai-copilot-eq-conf-low";
      titleRow.createEl("span", {
        text: `${pct}%`,
        cls: `ai-copilot-eq-conf ${cls}`,
      });
    }

    // Trigger tags (for human-required)
    if (record.triggers.length > 0) {
      const triggers = card.createDiv({ cls: "ai-copilot-eq-triggers" });
      for (const trigger of record.triggers) {
        triggers.createEl("span", {
          text: TRIGGER_LABELS[trigger] ?? trigger,
          cls: "ai-copilot-eq-trigger-tag",
        });
      }
    }

    // Diff preview
    if (record.pendingPlan) {
      this.renderDiffPreview(card, record);
    }

    // Action buttons (only for actionable states)
    if (group === "suggested" || group === "human-required") {
      const actions = card.createDiv({ cls: "ai-copilot-eq-actions" });

      const acceptBtn = actions.createEl("button", {
        text: "Accept",
        cls: "ai-copilot-eq-accept",
      });
      acceptBtn.onclick = () => void this.acceptRecord(record);

      const rejectBtn = actions.createEl("button", {
        text: "Reject",
        cls: "ai-copilot-eq-reject",
      });
      rejectBtn.onclick = () => void this.rejectRecord(record);
    }

    // Timestamp
    card.createDiv({
      text: new Date(record.updatedAt).toLocaleString(),
      cls: "ai-copilot-eq-timestamp",
    });
  }

  private renderDiffPreview(container: HTMLElement, record: EnrichmentStateRecord) {
    const plan = record.pendingPlan as PatchPlan | null;
    if (!plan || !("edits" in plan)) return;

    const edits = plan.edits;
    if (edits.length === 0) return;

    const preview = container.createDiv({ cls: "ai-copilot-eq-diff" });
    const editCount = edits.length;
    preview.createEl("div", {
      text: `${editCount} edit${editCount !== 1 ? "s" : ""} proposed`,
      cls: "ai-copilot-eq-diff-header",
    });

    // Show first few edits
    const maxShow = 3;
    for (let i = 0; i < Math.min(edits.length, maxShow); i++) {
      const edit = edits[i];
      const editEl = preview.createDiv({ cls: "ai-copilot-eq-edit" });

      editEl.createEl("div", {
        text: edit.reason,
        cls: "ai-copilot-eq-edit-reason",
      });

      const diffBlock = editEl.createDiv({ cls: "ai-copilot-eq-diff-block" });
      diffBlock.createEl("div", {
        text: `- ${edit.find.slice(0, 120)}${edit.find.length > 120 ? "…" : ""}`,
        cls: "ai-copilot-eq-diff-del",
      });
      diffBlock.createEl("div", {
        text: `+ ${edit.replace.slice(0, 120)}${edit.replace.length > 120 ? "…" : ""}`,
        cls: "ai-copilot-eq-diff-add",
      });
    }

    if (edits.length > maxShow) {
      preview.createEl("div", {
        text: `…and ${edits.length - maxShow} more`,
        cls: "ai-copilot-eq-diff-more",
      });
    }
  }

  private async openNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
      return;
    }
    new Notice(`AI Copilot: note not found (${path})`);
  }

  private async acceptRecord(record: EnrichmentStateRecord) {
    if (!this.vault) return;

    try {
      // If human-required, must transition to suggested first
      if (record.state === "human-required") {
        await transitionEnrichmentState(this.vault, record.notePath, "suggested", {});
      }

      // Transition to approved
      await transitionEnrichmentState(this.vault, record.notePath, "approved", {
        editDecisions: Object.fromEntries(
          (record.pendingPlan as PatchPlan)?.edits?.map((_, i) => [i, "approved" as const]) ?? []
        ),
      });

      // Apply the patch
      const plan = record.pendingPlan as PatchPlan | null;
      if (plan && this.vault.exists(record.notePath)) {
        const content = await this.vault.read(record.notePath);
        const result = applyPatchPlan(content, plan);

        if (result.transactions.some((t) => t.applied)) {
          await this.vault.modify(record.notePath, result.finalContent);
        }

        // Transition to applied
        await transitionEnrichmentState(this.vault, record.notePath, "applied", {
          preApplySnapshot: result.snapshot,
        });

        // Transition to unenriched (completed cycle)
        await transitionEnrichmentState(this.vault, record.notePath, "unenriched", {
          pendingPlan: null,
          editDecisions: null,
          preApplySnapshot: null,
          triggers: [],
        });

        const appliedCount = result.transactions.filter((t) => t.applied).length;
        new Notice(`AI Copilot: applied ${appliedCount} edit(s) to ${record.notePath}`);
      }

      await this.refresh();
    } catch (err) {
      new Notice(`AI Copilot: failed to accept enrichment — ${err}`);
    }
  }

  private async rejectRecord(record: EnrichmentStateRecord) {
    if (!this.vault) return;

    try {
      const reason = window.prompt("Rejection reason (optional):");

      // Transition to rejected
      await transitionEnrichmentState(this.vault, record.notePath, "rejected", {
        editDecisions: Object.fromEntries(
          (record.pendingPlan as PatchPlan)?.edits?.map((_, i) => [i, "rejected" as const]) ?? []
        ),
      });

      // Transition to unenriched (completed cycle)
      await transitionEnrichmentState(this.vault, record.notePath, "unenriched", {
        pendingPlan: null,
        editDecisions: null,
        preApplySnapshot: null,
        triggers: [],
      });

      new Notice(`AI Copilot: rejected enrichment for ${record.notePath}`);
      await this.refresh();
    } catch (err) {
      new Notice(`AI Copilot: failed to reject enrichment — ${err}`);
    }
  }
}
