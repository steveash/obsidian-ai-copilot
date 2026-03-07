import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { buildClient } from "./llm";
import { AICopilotChatView, AI_COPILOT_VIEW, upsertChatOutput } from "./chat";
import { applyPatch } from "./patcher";
import { buildRefinementPlan, toMarkdownPlan } from "./planner";
import { buildRefinementPrompt, extractTodos } from "./refinement";
import {
  applyGraphBoost,
  cosine,
  extractMetadata,
  freshnessScore,
  lexicalScore,
  tokenize,
  type RetrievedNote
} from "./semantic-retrieval";
import { PersistentVectorIndex } from "./vector-index";
import { OpenAIEmbeddingProvider, FallbackHashEmbeddingProvider } from "./embedding-provider";
import { VaultVectorStorage } from "./vault-vector-storage";
import { chunkMarkdownByHeading } from "./chunker";
import { createReranker, HeuristicReranker } from "./reranker";
import { redactSensitive } from "./safety";
import { AICopilotSettingTab, DEFAULT_SETTINGS, type AICopilotSettings } from "./settings";

export default class AICopilotPlugin extends Plugin {
  settings: AICopilotSettings = DEFAULT_SETTINGS;
  private intervalId: number | null = null;
  private vectorIndex: PersistentVectorIndex | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));
    this.initializeVectorIndex();


    this.registerView(AI_COPILOT_VIEW, (leaf) => new AICopilotChatView(leaf, this.app));

    this.addCommand({
      id: "ai-copilot-open-chat-panel",
      name: "AI Copilot: Open chat panel",
      callback: async () => {
        await this.activateChatView();
      }
    });

    this.addCommand({
      id: "ai-copilot-chat-active-note",
      name: "AI Copilot: Chat about active note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return void new Notice("No active note selected.");
        const content = await this.app.vault.read(file);
        const related = await this.getRelevantNotes(file.basename, this.settings.chatMaxResults);
        const prompt = [
          `ACTIVE NOTE (${file.path}):`,
          content,
          "\nRELATED CONTEXT:",
          ...related.map((n) => `- ${n.path} (score ${n.score.toFixed(2)})\n${n.content.slice(0, 500)}`),
          "\nTask: summarize note, suggest improvements, and list TODOs."
        ].join("\n\n");

        const output = await buildClient(this.settings).chat(prompt, "You are an Obsidian assistant.");
        await this.writeAssistantOutput("Chat Output", output);
        new Notice("AI Copilot: chat output saved to AI Copilot/Chat Output.md");
      }
    });

    this.addCommand({
      id: "ai-copilot-chat-query",
      name: "AI Copilot: Chat using vault query",
      callback: async () => {
        const query = window.prompt("Ask a question about your notes:");
        if (!query?.trim()) return;
        const related = await this.getRelevantNotes(query, this.settings.chatMaxResults);
        const context = related
          .map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`)
          .join("\n\n");

        const prompt = `Question: ${query}\n\nUse these notes:\n\n${context}`;
        const output = await buildClient(this.settings).chat(prompt, "Answer using only note evidence.");
        await upsertChatOutput(this.app, `## Query\n${query}\n\n## Response\n${output}`);
        new Notice("AI Copilot: query response saved.");
      }
    });

    this.addCommand({
      id: "ai-copilot-rebuild-vector-index",
      name: "AI Copilot: Rebuild persistent vector index",
      callback: async () => {
        const notes = await this.getAllNotes();
        if (!this.vectorIndex) this.initializeVectorIndex();
        const count = await this.vectorIndex!.rebuild(
          notes.map((n) => ({ path: n.path, content: `${n.path}
${n.content}` })),
          this.settings.embeddingModel
        );
        new Notice(`AI Copilot: rebuilt vector index for ${count} notes.`);
      }
    });

    this.addCommand({
      id: "ai-copilot-run-refinement-now",
      name: "AI Copilot: Run refinement now",
      callback: async () => void this.runRefinementPass()
    });

    this.startRefinementLoop();

    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!("path" in file) || !file.path.endsWith(".md")) return;
        if (!this.vectorIndex) this.initializeVectorIndex();
        const tf = file as TFile;
        const content = await this.app.vault.read(tf);
        const chunks = chunkMarkdownByHeading(tf.path, content, this.settings.retrievalChunkSize).map((c) => ({
          id: c.chunkId,
          path: c.path,
          content: `${c.path}\n${c.heading}\n${c.text}`,
          mtime: tf.stat.mtime
        }));
        await this.vectorIndex!.indexChunks(chunks, this.settings.embeddingModel);
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!("path" in file) || !file.path.endsWith(".md")) return;
        if (!this.vectorIndex) this.initializeVectorIndex();
        await this.vectorIndex!.removePath((file as any).path);
      })
    );

    new Notice("AI Copilot loaded.");
  }

  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startRefinementLoop();
    this.initializeVectorIndex();
  }

  private startRefinementLoop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    const intervalMs = Math.max(15, this.settings.refinementIntervalMinutes) * 60_000;
    this.intervalId = window.setInterval(() => void this.runRefinementPass(), intervalMs);
    this.registerInterval(this.intervalId);
  }

  private initializeVectorIndex() {
    const provider = this.settings.provider === "openai"
      ? new OpenAIEmbeddingProvider(this.settings)
      : new FallbackHashEmbeddingProvider();
    this.vectorIndex = new PersistentVectorIndex(new VaultVectorStorage(this.app), provider);
  }

  private async getAllNotes() {
    const files = this.app.vault.getMarkdownFiles();
    return Promise.all(
      files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f), mtime: f.stat.mtime }))
    );
  }

  private async activateChatView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(AI_COPILOT_VIEW);
    if (leaves.length) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: AI_COPILOT_VIEW, active: true });
    }

    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof AICopilotChatView) {
      view.setSubmitHandler(async (query: string) => {
        const related = await this.getRelevantNotes(query, this.settings.chatMaxResults);
        const context = related.map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`).join("\n\n");
        const prompt = `Question: ${query}\n\nUse these notes:\n\n${context}`;
        const output = await buildClient(this.settings).chat(prompt, "Answer using only note evidence.");
        await upsertChatOutput(this.app, `## Query\n${query}\n\n## Response\n${output}`);
        return output;
      });
    }
  }

  private async runRefinementPass() {
    const candidates = await this.getRecentNotes(this.settings.refinementLookbackDays);
    if (!candidates.length) return void new Notice("AI Copilot: no recent notes to refine.");

    const plan = buildRefinementPlan(candidates);
    const prompt = buildRefinementPrompt(candidates, {
      enableWebEnrichment: this.settings.enableWebEnrichment
    });
    const output = await buildClient(this.settings).chat(
      `${toMarkdownPlan(plan)}\n\n${prompt}`,
      "You refine markdown notes and preserve intent."
    );

    const todos = candidates.flatMap((n) => extractTodos(n.content));
    // deterministic safe patch attempt: normalize double-spaces in first candidate
    if (this.settings.refinementAutoApply && candidates[0]) {
      const c = candidates[0];
      const patched = applyPatch(c.content, {
        path: c.path,
        find: "  ",
        replace: " ",
        reason: "normalize spacing"
      });
      if (patched.applied) {
        const file = this.app.vault.getAbstractFileByPath(c.path);
        if (file instanceof TFile) await this.app.vault.modify(file, patched.updatedContent);
      }
    }

    new Notice(`AI Copilot: scanned ${candidates.length} notes · TODOs ${todos.length}`);

    await this.writeAssistantOutput("Refinement Log", `${toMarkdownPlan(plan)}\n\n## LLM Output\n${output}`);
  }

  private async writeAssistantOutput(name: string, body: string) {
    const file = await this.ensurePluginFile(`${name}.md`, `# ${name}\n`);
    const stamp = `\n\n---\n${new Date().toISOString()}\n`;
    await this.app.vault.append(file, `${stamp}${redactSensitive(body)}\n`);
  }

  private async ensurePluginFile(name: string, initial: string): Promise<TFile> {
    const folderPath = "AI Copilot";
    const path = `${folderPath}/${name}`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
    return this.app.vault.create(path, initial);
  }

  private async getRecentNotes(lookbackDays: number) {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.stat.mtime >= cutoff);
    return Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
  }

  private mergeChunkResultsToFullNotes(results: RetrievedNote[]): RetrievedNote[] {
    const grouped = new Map<string, RetrievedNote[]>();
    for (const r of results) {
      const arr = grouped.get(r.path) ?? [];
      arr.push(r);
      grouped.set(r.path, arr);
    }

    const merged: RetrievedNote[] = [];
    for (const [path, chunks] of grouped.entries()) {
      const top = [...chunks].sort((a, b) => b.score - a.score)[0];
      const sectionContext = chunks
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((c, i) => `## Relevant Section ${i + 1}\n${c.content}`)
        .join("\n\n");

      // full note content is always included in retrieval output now
      const fullNote = chunks[0].metadata?.fullContent ?? chunks[0].content;

      merged.push({
        ...top,
        content: `${sectionContext}\n\n## Full Note (${path})\n${fullNote}`
      });
    }

    return merged.sort((a, b) => b.score - a.score);
  }

  private async getRelevantNotes(query: string, maxResults: number): Promise<RetrievedNote[]> {
    const notes = await this.getAllNotes();
    const queryTerms = tokenize(query);

    const pre = notes
      .map((n) => {
        const lex = lexicalScore(n, queryTerms);
        const fresh = freshnessScore(n.mtime);
        return { n, lex, fresh, preScore: lex + 0.25 * fresh };
      })
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, Math.max(maxResults, this.settings.preselectCandidateCount));

    if (!this.vectorIndex) this.initializeVectorIndex();
    const queryVec = await this.vectorIndex!.getOrCreate(
      "__query__",
      "__query__",
      query,
      this.settings.embeddingModel
    );

    const ranked: RetrievedNote[] = [];
    for (const c of pre) {
      const chunks = chunkMarkdownByHeading(c.n.path, c.n.content, this.settings.retrievalChunkSize);
      for (const ch of chunks) {
        const chunkContent = `${c.n.path}
${ch.heading}
${ch.text}`;
        const docVec = await this.vectorIndex!.getOrCreate(
          ch.chunkId,
          c.n.path,
          chunkContent,
          this.settings.embeddingModel,
          c.n.mtime
        );
        const sem = cosine(docVec, queryVec);
        const score =
          this.settings.retrievalLexicalWeight * c.lex +
          this.settings.retrievalSemanticWeight * sem +
          this.settings.retrievalFreshnessWeight * c.fresh;
        ranked.push({
          path: c.n.path,
          content: `# ${ch.heading}
${ch.text}`,
          mtime: c.n.mtime,
          score,
          lexicalScore: c.lex,
          semanticScore: sem,
          freshnessScore: c.fresh,
          graphBoost: 0,
          metadata: { ...extractMetadata(c.n.content), fullContent: c.n.content } as any
        });
      }
    }

    let final = applyGraphBoost(ranked, Math.max(maxResults, this.settings.rerankerTopK), this.settings.retrievalGraphExpandHops)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(maxResults, this.settings.rerankerTopK));

    if (this.settings.rerankerEnabled) {
      let reranker = createReranker(this.settings);
      let reranked;
      try {
        reranked = await reranker.rerank(
          query,
          final
            .slice(0, this.settings.rerankerTopK)
            .map((x, i) => ({ id: `${i}:${x.path}`, text: `${x.path}\n${x.content}`, score: x.score }))
        );
      } catch {
        reranker = new HeuristicReranker();
        reranked = await reranker.rerank(
          query,
          final
            .slice(0, this.settings.rerankerTopK)
            .map((x, i) => ({ id: `${i}:${x.path}`, text: `${x.path}\n${x.content}`, score: x.score }))
        );
      }

      const map = new Map(final.map((x) => [`${x.path}\n${x.content}`, x]));
      final = reranked
        .map((r) => map.get(r.text))
        .filter((x): x is RetrievedNote => Boolean(x))
        .concat(final)
        .slice(0, maxResults);
    } else {
      final = final.slice(0, maxResults);
    }

    return this.mergeChunkResultsToFullNotes(final).slice(0, maxResults);
  }
}