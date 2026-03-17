/**
 * Lightweight Obsidian API shim for Vitest integration tests.
 *
 * Stubs only the classes and types this plugin actually imports.
 * This is test infrastructure — never shipped in the plugin bundle.
 */

// ---------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------

export class Notice {
  static history: string[] = [];

  constructor(public message: string, _timeout?: number) {
    Notice.history.push(message);
  }

  static clear() {
    Notice.history.length = 0;
  }
}

// ---------------------------------------------------------------------------
// TFile / TFolder / TAbstractFile
// ---------------------------------------------------------------------------

export class TAbstractFile {
  path: string;
  name: string;
  parent: TFolder | null = null;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };

  constructor(path: string, content?: string) {
    super(path);
    const dotIdx = this.name.lastIndexOf(".");
    this.basename = dotIdx >= 0 ? this.name.slice(0, dotIdx) : this.name;
    this.extension = dotIdx >= 0 ? this.name.slice(dotIdx + 1) : "";
    if (content !== undefined) this.stat.size = content.length;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot() {
    return this.path === "/";
  }
}

// ---------------------------------------------------------------------------
// Vault (in-memory stub)
// ---------------------------------------------------------------------------

type VaultEventCallback = (...args: any[]) => void;

export class Vault {
  private files = new Map<string, { tfile: TFile; content: string }>();
  private folders = new Set<string>();
  private listeners = new Map<string, VaultEventCallback[]>();

  // --- File operations ---

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()]
      .filter(({ tfile }) => tfile.extension === "md")
      .map(({ tfile }) => tfile);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const entry = this.files.get(path);
    if (entry) return entry.tfile;
    if (this.folders.has(path)) return new TFolder(path);
    return null;
  }

  async read(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    return entry.content;
  }

  async create(path: string, content: string): Promise<TFile> {
    const tfile = new TFile(path, content);
    this.files.set(path, { tfile, content });
    return tfile;
  }

  async modify(file: TFile, content: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    entry.content = content;
    entry.tfile.stat.mtime = Date.now();
    entry.tfile.stat.size = content.length;
    this.emit("modify", entry.tfile);
  }

  async append(file: TFile, content: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    entry.content += content;
    entry.tfile.stat.mtime = Date.now();
    entry.tfile.stat.size = entry.content.length;
    this.emit("modify", entry.tfile);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  // --- Events ---

  on(event: string, callback: VaultEventCallback): { id: string } {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
    return { id: `${event}-${list.length}` };
  }

  private emit(event: string, ...args: any[]) {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(...args);
    }
  }

  // --- Test helpers ---

  _seed(path: string, content: string, mtime?: number): TFile {
    const tfile = new TFile(path, content);
    if (mtime !== undefined) tfile.stat.mtime = mtime;
    this.files.set(path, { tfile, content });
    return tfile;
  }
}

// ---------------------------------------------------------------------------
// Workspace (minimal stub)
// ---------------------------------------------------------------------------

export class WorkspaceLeaf {
  view: any = null;

  async setViewState(_state: { type: string; active?: boolean }): Promise<void> {}

  async openFile(_file: TFile): Promise<void> {}
}

export class Workspace {
  private leaves: WorkspaceLeaf[] = [];
  private viewRegistry = new Map<string, (leaf: WorkspaceLeaf) => any>();
  private activeFile: TFile | null = null;

  getLeavesOfType(_type: string): WorkspaceLeaf[] {
    return this.leaves.filter((l) => l.view?.getViewType?.() === _type);
  }

  getRightLeaf(_split: boolean): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf();
    this.leaves.push(leaf);
    return leaf;
  }

  getLeaf(_newTab: boolean): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf();
    this.leaves.push(leaf);
    return leaf;
  }

  revealLeaf(_leaf: WorkspaceLeaf): void {}

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  // --- Test helpers ---

  _setActiveFile(file: TFile | null) {
    this.activeFile = file;
  }

  _registerViewFactory(type: string, factory: (leaf: WorkspaceLeaf) => any) {
    this.viewRegistry.set(type, factory);
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export class App {
  vault = new Vault();
  workspace = new Workspace();
}

// ---------------------------------------------------------------------------
// Plugin base class
// ---------------------------------------------------------------------------

export class Plugin {
  app: App;
  manifest = { id: "test-plugin", name: "Test Plugin", version: "0.0.0" };

  private commands: Command[] = [];
  private settingTabs: PluginSettingTab[] = [];
  private storedData: any = {};
  private intervals: number[] = [];
  private events: any[] = [];

  constructor(app?: App) {
    this.app = app ?? new App();
  }

  addCommand(command: Command): Command {
    this.commands.push(command);
    return command;
  }

  registerView(_type: string, _cb: (leaf: WorkspaceLeaf) => any): void {}

  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
  }

  async loadData(): Promise<any> {
    return this.storedData;
  }

  async saveData(data: any): Promise<void> {
    this.storedData = data;
  }

  registerInterval(id: number): number {
    this.intervals.push(id);
    return id;
  }

  registerEvent(event: any): void {
    this.events.push(event);
  }

  // --- Test helpers ---

  _getCommands(): Command[] {
    return this.commands;
  }

  _getSettingTabs(): PluginSettingTab[] {
    return this.settingTabs;
  }

  _setStoredData(data: any) {
    this.storedData = data;
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface Command {
  id: string;
  name: string;
  callback?: () => any;
  checkCallback?: (checking: boolean) => boolean | void;
}

// ---------------------------------------------------------------------------
// ItemView
// ---------------------------------------------------------------------------

function createMockEl(): MockHTMLElement {
  const el: MockHTMLElement = {
    children: [createMockElBasic(), createMockElBasic()],
    empty() {
      this.children = [];
    },
    createEl(_tag: string, _opts?: any) {
      const child = createMockElBasic();
      return child;
    },
    createDiv(_opts?: any) {
      return createMockElBasic();
    },
    appendText(_text: string) {},
    setText(_text: string) {},
    style: {} as any,
    onclick: null as any
  };
  return el;
}

interface MockHTMLElement {
  children: any[];
  empty(): void;
  createEl(tag: string, opts?: any): MockHTMLElement;
  createDiv(opts?: any): MockHTMLElement;
  appendText(text: string): void;
  setText(text: string): void;
  style: any;
  onclick: any;
}

function createMockElBasic(): MockHTMLElement {
  return {
    children: [],
    empty() { this.children = []; },
    createEl(_tag: string, _opts?: any) { return createMockElBasic(); },
    createDiv(_opts?: any) { return createMockElBasic(); },
    appendText(_text: string) {},
    setText(_text: string) {},
    style: {} as any,
    onclick: null as any
  };
}

export class ItemView {
  leaf: WorkspaceLeaf;
  app: App;
  containerEl: MockHTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = new App();
    this.containerEl = createMockEl();
  }

  getViewType(): string {
    return "";
  }

  getDisplayText(): string {
    return "";
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// PluginSettingTab
// ---------------------------------------------------------------------------

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: MockHTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createMockEl();
  }

  display(): void {}
  hide(): void {}
}

// ---------------------------------------------------------------------------
// Setting (builder pattern)
// ---------------------------------------------------------------------------

export class Setting {
  private el: MockHTMLElement;

  constructor(_containerEl: MockHTMLElement) {
    this.el = createMockElBasic();
  }

  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }

  addText(cb: (text: TextComponent) => void): this {
    cb(new TextComponent());
    return this;
  }

  addToggle(cb: (toggle: ToggleComponent) => void): this {
    cb(new ToggleComponent());
    return this;
  }

  addSlider(cb: (slider: SliderComponent) => void): this {
    cb(new SliderComponent());
    return this;
  }

  addDropdown(cb: (dropdown: DropdownComponent) => void): this {
    cb(new DropdownComponent());
    return this;
  }
}

// ---------------------------------------------------------------------------
// UI components (minimal stubs)
// ---------------------------------------------------------------------------

export class TextComponent {
  private value_ = "";
  private changeCb: ((value: string) => void) | null = null;

  setPlaceholder(_p: string): this { return this; }
  setValue(v: string): this { this.value_ = v; return this; }
  getValue(): string { return this.value_; }
  onChange(cb: (value: string) => void): this { this.changeCb = cb; return this; }
  _trigger(value: string) { this.changeCb?.(value); }
}

export class ToggleComponent {
  private value_ = false;
  private changeCb: ((value: boolean) => void) | null = null;

  setValue(v: boolean): this { this.value_ = v; return this; }
  getValue(): boolean { return this.value_; }
  onChange(cb: (value: boolean) => void): this { this.changeCb = cb; return this; }
  _trigger(value: boolean) { this.changeCb?.(value); }
}

export class SliderComponent {
  private value_ = 0;
  private changeCb: ((value: number) => void) | null = null;

  setLimits(_min: number, _max: number, _step: number): this { return this; }
  setValue(v: number): this { this.value_ = v; return this; }
  getValue(): number { return this.value_; }
  setDynamicTooltip(): this { return this; }
  onChange(cb: (value: number) => void): this { this.changeCb = cb; return this; }
  _trigger(value: number) { this.changeCb?.(value); }
}

export class DropdownComponent {
  private value_ = "";
  private changeCb: ((value: string) => void) | null = null;

  addOption(_value: string, _display: string): this { return this; }
  setValue(v: string): this { this.value_ = v; return this; }
  getValue(): string { return this.value_; }
  onChange(cb: (value: string) => void): this { this.changeCb = cb; return this; }
  _trigger(value: string) { this.changeCb?.(value); }
}
