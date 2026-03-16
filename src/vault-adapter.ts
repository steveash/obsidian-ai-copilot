export interface VaultFile {
  path: string;
  mtime: number;
}

export type VaultEventRef = unknown;

export interface VaultNote {
  path: string;
  content: string;
  mtime: number;
}

export interface VaultAdapter {
  listMarkdownFiles(): VaultFile[];
  read(path: string): Promise<string>;
  exists(path: string): boolean;
  create(path: string, content: string): Promise<void>;
  modify(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  on(event: "modify" | "delete", callback: (file: VaultFile) => void): VaultEventRef;
}

export class InMemoryVaultAdapter implements VaultAdapter {
  private files: Map<string, { content: string; mtime: number }>;
  private folders: Set<string>;

  constructor(notes: VaultNote[] = []) {
    this.files = new Map(notes.map((n) => [n.path, { content: n.content, mtime: n.mtime }]));
    this.folders = new Set();
  }

  listMarkdownFiles(): VaultFile[] {
    return [...this.files.entries()]
      .filter(([path]) => path.endsWith(".md"))
      .map(([path, { mtime }]) => ({ path, mtime }));
  }

  async read(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file.content;
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }

  async create(path: string, content: string): Promise<void> {
    this.files.set(path, { content, mtime: Date.now() });
  }

  async modify(path: string, content: string): Promise<void> {
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    this.files.set(path, { content, mtime: Date.now() });
  }

  async append(path: string, content: string): Promise<void> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    file.content += content;
    file.mtime = Date.now();
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  on(_event: "modify" | "delete", _callback: (file: VaultFile) => void): VaultEventRef {
    return {};
  }
}
