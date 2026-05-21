#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { supabase, restoreSession, getAuthUserId } from './supabaseClient.js';
import { readEnvKey, warmSecretsCache } from './envReader.js';
import { registerTerminalTools } from './tools/terminal.js';
import { registerLeaseTools } from './tools/leases.js';
import { registerChannelTools } from './tools/channel.js';
import { registerSwarmTools } from './tools/swarm.js';

const DATA_DIR = process.env.FLOWADE_DATA_DIR || join(
  process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'flowade')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'flowade')
      : join(homedir(), '.config', 'flowade'),
  'flowade-data'
);

const WORKSPACES_DIR = join(DATA_DIR, 'workspaces');
const MEMORY_DIR = join(DATA_DIR, 'memory');
const TASKS_FILE = join(DATA_DIR, 'tasks.json');
const STATE_FILE = join(DATA_DIR, 'session-state.json');

let cachedUserId = null;

const TIER_LIMITS = { starter: 0, pro: 500, team: 5000 };

async function getUserTier() {
  const userId = await getUserId();
  if (!isAuthUser(userId)) return 'starter';
  try {
    const { data } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single();
    return data?.subscription_tier || 'starter';
  } catch { return 'starter'; }
}

function getMemoryCount() {
  try {
    return readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json')).length;
  } catch { return 0; }
}

function ensureDirs() {
  for (const dir of [DATA_DIR, WORKSPACES_DIR, MEMORY_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

async function getUserId() {
  if (cachedUserId) return cachedUserId;
  const authId = await getAuthUserId();
  if (authId) { cachedUserId = authId; return authId; }
  try {
    const data = JSON.parse(readFileSync(join(DATA_DIR, 'device.json'), 'utf8'));
    return data.deviceId || null;
  } catch { return null; }
}

function isAuthUser(userId) {
  return userId && !userId.startsWith('dev-') && userId !== 'unknown';
}

async function cloudUpsert(entry) {
  try {
    const userId = await getUserId();
    if (!isAuthUser(userId)) return;
    if (entry.deletedAt) return; // tombstones go through cloudTombstone
    await supabase.from('memories').upsert({
      id: entry.id, user_id: userId,
      title: entry.title, content: entry.content || '',
      type: entry.type || 'note', tags: entry.tags || [],
      category_id: entry.categoryId || null,
      created_at: entry.createdAt, updated_at: entry.updatedAt,
    });
  } catch {}
}

async function cloudTombstone(id, deletedAtIso, updatedAt) {
  try {
    const userId = await getUserId();
    if (!isAuthUser(userId)) return;
    // Soft delete: UPDATE deleted_at on the cloud row. RLS no longer permits
    // hard DELETE on memories — tombstones propagate to other devices.
    await supabase
      .from('memories')
      .update({ deleted_at: deletedAtIso, updated_at: updatedAt })
      .eq('id', id)
      .eq('user_id', userId);
  } catch {}
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function getActiveWorkspace() {
  const state = readJson(STATE_FILE);
  if (!state?.activeWorkspaceId) return null;
  return readJson(join(WORKSPACES_DIR, `${state.activeWorkspaceId}.json`));
}

function getTasks() {
  return readJson(TASKS_FILE) || [];
}

function saveTasks(tasks) {
  writeJson(TASKS_FILE, tasks);
}

function getMemoryEntries() {
  ensureDirs();
  try {
    return readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => readJson(join(MEMORY_DIR, f)))
      .filter(Boolean)
      .filter(e => !e.deletedAt) // hide soft-deleted entries
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  } catch { return []; }
}

function searchMemory(query) {
  const q = query.toLowerCase();
  return getMemoryEntries().filter(e =>
    (e.title && e.title.toLowerCase().includes(q)) ||
    (e.content && e.content.toLowerCase().includes(q)) ||
    (e.tags && e.tags.some(t => t && t.toLowerCase().includes(q)))
  );
}

// ---------------------------------------------------------------------------
// Categories — read directly from Supabase. Cached for the lifetime of the
// MCP process to avoid round-trips per call; agents typically issue several
// queries in quick succession.
// ---------------------------------------------------------------------------

let _categoriesCache = null;
let _categoriesCacheAt = 0;
const CATEGORIES_TTL_MS = 60_000;

async function loadCategories(force = false) {
  const now = Date.now();
  if (!force && _categoriesCache && (now - _categoriesCacheAt) < CATEGORIES_TTL_MS) {
    return _categoriesCache;
  }
  const userId = await getUserId();
  if (!isAuthUser(userId)) { _categoriesCache = []; _categoriesCacheAt = now; return []; }
  try {
    const { data, error } = await supabase
      .from('memory_categories')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null);
    if (error) throw error;
    _categoriesCache = (data || []).map(r => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      emoji: r.emoji,
      description: r.description,
      color: r.color,
    }));
    _categoriesCacheAt = now;
  } catch {
    _categoriesCache = _categoriesCache || [];
  }
  return _categoriesCache;
}

function buildCategoryPathMap(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const paths = new Map(); // categoryId → 'Parent / Child / Leaf'
  for (const c of categories) {
    const parts = [c.name];
    let cur = c;
    while (cur.parentId && byId.has(cur.parentId)) {
      cur = byId.get(cur.parentId);
      parts.unshift(cur.name);
    }
    paths.set(c.id, parts.join(' / '));
  }
  return { byId, paths };
}

// Resolve a `category` filter (id or path-string) to the set of leaf+descendant
// category ids that should match. Path matching is case-insensitive and tolerant
// of "/", ">", "→" separators.
function resolveCategoryFilter(filter, categories) {
  if (!filter) return null;
  const { byId, paths } = buildCategoryPathMap(categories);

  if (byId.has(filter)) {
    return collectDescendants(filter, categories);
  }
  const norm = s => s.replace(/[›→>/]/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(filter);

  // exact path match
  for (const [id, path] of paths) {
    if (norm(path) === target) return collectDescendants(id, categories);
  }
  // suffix path match (e.g. "Development" matches "FlowADE / Development")
  for (const [id, path] of paths) {
    const segs = norm(path).split('/').map(s => s.trim());
    const tSegs = target.split('/').map(s => s.trim()).filter(Boolean);
    if (tSegs.length && segs.slice(-tSegs.length).join('/') === tSegs.join('/')) {
      return collectDescendants(id, categories);
    }
  }
  // fallback: name contains
  const hit = categories.find(c => norm(c.name) === target);
  if (hit) return collectDescendants(hit.id, categories);
  return new Set(); // no match → empty set so query returns nothing
}

function collectDescendants(rootId, categories) {
  const out = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of categories) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        added = true;
      }
    }
  }
  return out;
}

function annotateMemoriesWithCategoryPath(entries, categories) {
  if (!categories.length) return entries;
  const { paths } = buildCategoryPathMap(categories);
  return entries.map(e => ({
    ...e,
    categoryPath: e.categoryId ? (paths.get(e.categoryId) || null) : null,
  }));
}

// ---------------------------------------------------------------------------
// OpenAI text-embedding-3-small wrapper. Same shape as electron/memoryEmbeddings.
// ---------------------------------------------------------------------------

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = 'text-embedding-3-small';

function shapeForEmbedding(memory) {
  const parts = [];
  if (memory.title) parts.push(`Title: ${memory.title}`);
  if (memory.type && memory.type !== 'note') parts.push(`Type: ${memory.type}`);
  if ((memory.tags || []).length) {
    parts.push(`Tags: ${(memory.tags || []).filter(Boolean).join(', ')}`);
  }
  if (memory.content) parts.push(`Content: ${memory.content}`);
  const joined = parts.join('\n');
  return joined.length > 8000 ? joined.slice(0, 8000) : joined;
}

async function openaiEmbed(inputs, apiKey) {
  const response = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI ${response.status}: ${text || response.statusText}`);
  }
  const json = await response.json();
  return json.data.map(d => d.embedding);
}

async function embedAndPersist(entry) {
  const apiKey = readEnvKey('OPENAI_API_KEY');
  if (!apiKey) return;
  const userId = await getUserId();
  if (!isAuthUser(userId)) return;
  try {
    const [vector] = await openaiEmbed([shapeForEmbedding(entry)], apiKey);
    if (!vector) return;
    await supabase
      .from('memories')
      .update({ embedding: vector })
      .eq('id', entry.id)
      .eq('user_id', userId);
  } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// Single-memory auto-categorization (terminal-write path). Mirrors
// runAutoCategorizeOne in the Electron app but inlined so the MCP process
// stays self-contained.
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const PLACE_TOOL = {
  name: 'place_memory',
  description: 'Pick the best leaf category for this memory, or signal that a new leaf is needed.',
  input_schema: {
    type: 'object',
    properties: {
      categoryId: { type: 'string', description: 'Existing leaf id, or null if no leaf fits.' },
      newCategory: {
        type: 'object',
        properties: {
          parentId: { type: 'string' },
          name: { type: 'string' },
          emoji: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
};

function snippetForAi(text, max = 240) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

function buildLeafList(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const childCount = new Map();
  for (const c of categories) {
    if (c.parentId) childCount.set(c.parentId, (childCount.get(c.parentId) || 0) + 1);
  }
  const path = (c) => {
    const parts = [c.name];
    let cur = c;
    while (cur.parentId && byId.has(cur.parentId)) {
      cur = byId.get(cur.parentId);
      parts.unshift(cur.name);
    }
    return parts.join(' / ');
  };
  return categories
    .filter(c => !childCount.has(c.id))
    .map(c => ({ id: c.id, path: path(c), description: c.description || null }));
}

async function autoCategorizeMemory(entry) {
  const apiKey = readEnvKey('ANTHROPIC_API_KEY');
  if (!apiKey || !entry?.id) return null;
  const userId = await getUserId();
  if (!isAuthUser(userId)) return null;

  const categories = await loadCategories(true);
  if (categories.length === 0) return null; // user hasn't run initial categorize
  const leaves = buildLeafList(categories);

  const userMessage = [
    'Existing leaf categories:',
    JSON.stringify(leaves, null, 2),
    '',
    'Memory to place:',
    JSON.stringify({
      title: entry.title || '',
      type: entry.type || 'note',
      tags: (entry.tags || []).filter(Boolean),
      snippet: snippetForAi(entry.content),
    }, null, 2),
  ].join('\n');

  const body = {
    model: HAIKU_MODEL,
    max_tokens: 600,
    temperature: 0,
    system: `You are slotting one new memory into an existing category tree.

Decide:
- If an existing leaf clearly fits, return { categoryId }.
- If no existing leaf fits, return { newCategory } with parentId set to the most relevant existing top-level / mid-level category (or null for a new top-level leaf).

Always use the place_memory tool. Do not respond with prose.`,
    tools: [PLACE_TOOL],
    tool_choice: { type: 'tool', name: 'place_memory' },
    messages: [{ role: 'user', content: userMessage }],
  };

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch { return null; }
  if (!response.ok) return null;

  const json = await response.json();
  const out = (Array.isArray(json.content) ? json.content : [])
    .find(b => b?.type === 'tool_use' && b.name === 'place_memory')?.input;
  if (!out) return null;

  let targetId = null;
  if (out.categoryId && categories.some(c => c.id === out.categoryId)) {
    targetId = out.categoryId;
  } else if (out.newCategory?.name) {
    try {
      const parentId = out.newCategory.parentId && categories.some(c => c.id === out.newCategory.parentId)
        ? out.newCategory.parentId
        : null;
      const { data, error } = await supabase
        .from('memory_categories')
        .insert({
          user_id: userId,
          parent_id: parentId,
          name: out.newCategory.name,
          emoji: out.newCategory.emoji || null,
          description: out.newCategory.description || null,
        })
        .select('id')
        .single();
      if (error || !data) return null;
      targetId = data.id;
      // Invalidate cache so the next read sees the new leaf.
      _categoriesCache = null;
    } catch { return null; }
  }

  if (!targetId) return null;

  // Persist on the memory row (cloud + local).
  try {
    await supabase
      .from('memories')
      .update({ category_id: targetId })
      .eq('id', entry.id)
      .eq('user_id', userId);
  } catch { /* RLS or transient — skip */ }

  // Mirror locally so subsequent reads from the same MCP process see it.
  try {
    const path = join(MEMORY_DIR, `${entry.id}.json`);
    const local = readJson(path);
    if (local) {
      local.categoryId = targetId;
      writeJson(path, local);
    }
  } catch {}

  return targetId;
}

ensureDirs();

const server = new McpServer({
  name: 'flowade',
  version: '0.1.0',
});

// --- Resources ---

server.resource('workspace', 'flowade://workspace/current', async (uri) => ({
  contents: [{
    uri: uri.href,
    mimeType: 'application/json',
    text: JSON.stringify(getActiveWorkspace() || { error: 'No active workspace' }, null, 2),
  }],
}));

server.resource('tasks', 'flowade://tasks', async (uri) => ({
  contents: [{
    uri: uri.href,
    mimeType: 'application/json',
    text: JSON.stringify(getTasks(), null, 2),
  }],
}));

server.resource('memory', 'flowade://memory', async (uri) => ({
  contents: [{
    uri: uri.href,
    mimeType: 'application/json',
    text: JSON.stringify(getMemoryEntries(), null, 2),
  }],
}));

// --- Prompts ---

server.prompt(
  'brain',
  'Load FlowADE memory brain — retrieves all stored knowledge and instructs proactive memory management',
  {},
  async () => {
    const memories = getMemoryEntries();
    const categories = await loadCategories();
    const { paths } = buildCategoryPathMap(categories);

    // If categories are populated, group by category so the agent has a quick
    // map of available scopes. Otherwise fall back to type-grouping.
    let memoryDump = '';
    if (categories.length > 0) {
      const groups = new Map(); // path → memories
      for (const m of memories) {
        const path = m.categoryId ? (paths.get(m.categoryId) || 'Uncategorized') : 'Uncategorized';
        if (!groups.has(path)) groups.set(path, []);
        groups.get(path).push(m);
      }
      const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
      memoryDump += `\nUse the \`category\` filter on flowade_read_memory / flowade_search_memory to scope queries to one of these paths:\n`;
      for (const [path, entries] of sorted) {
        memoryDump += `\n## ${path} (${entries.length})\n`;
        for (const e of entries) {
          memoryDump += `- **${e.title}** [${e.type}${(e.tags || []).length ? ', ' + (e.tags || []).join(', ') : ''}]: ${e.content}\n`;
        }
      }
    } else {
      const byType = { fact: [], decision: [], context: [], reference: [], note: [] };
      for (const m of memories) (byType[m.type] || byType.note).push(m);
      for (const [type, entries] of Object.entries(byType)) {
        if (entries.length === 0) continue;
        memoryDump += `\n## ${type.charAt(0).toUpperCase() + type.slice(1)}s (${entries.length})\n`;
        for (const e of entries) {
          memoryDump += `- **${e.title}** [${(e.tags || []).join(', ')}]: ${e.content}\n`;
        }
      }
    }

    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# FlowADE Memory Brain

You are connected to FlowADE's persistent memory system — a shared knowledge base across all terminals and sessions.

## Current Knowledge Base
${memoryDump || '\n(No memories stored yet — start building the brain!)'}

## Your Memory Responsibilities

Manage this knowledge base thoughtfully. Every memory costs storage — only save what's worth recalling weeks or months from now.

1. **READ first**: At the start of any task, check if relevant memories exist using flowade_search_memory or flowade_read_memory
2. **SAVE selectively**: Only store information that meets the "2-week test" — would this be useful if you encountered this project again in 2+ weeks?
3. **Use correct types**:
   - \`fact\` — Stable technical truths: "API uses JWT with RS256", "Database is PostgreSQL 15"
   - \`decision\` — Design choices WITH rationale: "Chose React over Vue because team knows it"
   - \`context\` — Non-obvious project state: "Migrating auth from v2 to v3, halfway done"
   - \`reference\` — External resource pointers: "API docs at /docs/api.md"
   - \`note\` — Important ideas or TODOs that aren't tracked elsewhere
4. **TAG well**: Use descriptive tags like project names, tech stack, feature areas
5. **UPDATE stale info**: If you find a memory that's outdated, update it with flowade_update_memory
6. **SEARCH before duplicating**: Always search before creating — don't store what's already known

## What to Save
- Architecture decisions and their rationale
- Non-obvious API patterns or constraints
- Environment/deployment gotchas that took time to discover
- User preferences and project conventions
- Key dependency choices and version constraints

## What NOT to Save
- Debugging steps or intermediate troubleshooting (the fix is what matters, not the journey)
- Obvious code patterns readable from the source
- Temporary workarounds or one-off fixes
- Information already in README, package.json, or config files
- Generic programming knowledge (only project-specific insights)`,
        },
      }],
    };
  }
);

// --- Tools ---

server.tool(
  'flowade_get_workspace',
  'Get the current active FlowADE workspace (layout, terminals, macros)',
  {},
  async () => {
    const ws = getActiveWorkspace();
    return { content: [{ type: 'text', text: JSON.stringify(ws || { error: 'No active workspace' }, null, 2) }] };
  }
);

server.tool(
  'flowade_list_workspaces',
  'List all FlowADE workspaces',
  {},
  async () => {
    try {
      const files = readdirSync(WORKSPACES_DIR).filter(f => f.endsWith('.json'));
      const workspaces = files.map(f => {
        const data = readJson(join(WORKSPACES_DIR, f));
        return data ? { id: data.id, name: data.name, terminals: data.terminals?.length || 0, layout: data.layout } : null;
      }).filter(Boolean);
      return { content: [{ type: 'text', text: JSON.stringify(workspaces, null, 2) }] };
    } catch { return { content: [{ type: 'text', text: '[]' }] }; }
  }
);

server.tool(
  'flowade_list_tasks',
  'List all tasks from the FlowADE task board',
  {},
  async () => {
    return { content: [{ type: 'text', text: JSON.stringify(getTasks(), null, 2) }] };
  }
);

server.tool(
  'flowade_create_task',
  'Create a new task on the FlowADE task board',
  { title: z.string(), column: z.enum(['todo', 'active', 'done']).default('todo') },
  async ({ title, column }) => {
    const tasks = getTasks();
    const task = { id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, title, column, createdAt: Date.now() };
    tasks.push(task);
    saveTasks(tasks);
    return { content: [{ type: 'text', text: `Created task: "${title}" in ${column}` }] };
  }
);

server.tool(
  'flowade_update_task',
  'Move a task to a different column or update its title',
  { id: z.string(), column: z.enum(['todo', 'active', 'done']).optional(), title: z.string().optional() },
  async ({ id, column, title }) => {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return { content: [{ type: 'text', text: `Task ${id} not found` }], isError: true };
    if (column) task.column = column;
    if (title) task.title = title;
    saveTasks(tasks);
    return { content: [{ type: 'text', text: `Updated task: "${task.title}" → ${task.column}` }] };
  }
);

server.tool(
  'flowade_delete_task',
  'Delete a task from the task board',
  { id: z.string() },
  async ({ id }) => {
    const tasks = getTasks().filter(t => t.id !== id);
    saveTasks(tasks);
    return { content: [{ type: 'text', text: `Deleted task ${id}` }] };
  }
);

server.tool(
  'flowade_read_memory',
  'Read persistent memory entries. Use this at the START of tasks to check what is already known. Filter by tag and/or category to scope the result.',
  {
    tag: z.string().optional().describe('Filter entries by tag (e.g. "api", "auth", "frontend")'),
    category: z.string().optional().describe('Category id, leaf name, or full path like "FlowADE / Development". Includes sub-categories.'),
  },
  async ({ tag, category }) => {
    let entries = getMemoryEntries();
    if (tag) entries = entries.filter(e => e.tags?.includes(tag));
    const categories = await loadCategories();
    if (category) {
      const allow = resolveCategoryFilter(category, categories);
      entries = entries.filter(e => e.categoryId && allow.has(e.categoryId));
    }
    entries = annotateMemoriesWithCategoryPath(entries, categories);
    return { content: [{ type: 'text', text: entries.length ? JSON.stringify(entries, null, 2) : 'No memories found.' }] };
  }
);

server.tool(
  'flowade_search_memory',
  'Search persistent memory by keyword. Matches against title, content, and tags. Optionally scope to a category.',
  {
    query: z.string().describe('Search term to match against memory titles, content, and tags'),
    category: z.string().optional().describe('Category id, leaf name, or full path. Includes sub-categories.'),
  },
  async ({ query, category }) => {
    let results = searchMemory(query);
    const categories = await loadCategories();
    if (category) {
      const allow = resolveCategoryFilter(category, categories);
      results = results.filter(e => e.categoryId && allow.has(e.categoryId));
    }
    results = annotateMemoriesWithCategoryPath(results, categories);
    return { content: [{ type: 'text', text: results.length ? JSON.stringify(results, null, 2) : `No memories matching "${query}".` }] };
  }
);

server.tool(
  'flowade_semantic_search',
  'Semantic search across memories using OpenAI text-embedding-3-small + pgvector cosine similarity. Use this when keyword search misses relevant memories — e.g. searching "auth flow" should pull up a memory titled "JWT validation rules" even though the strings don\'t overlap. Optional category filter scopes the result.',
  {
    query: z.string().describe('Natural-language description of what you\'re looking for'),
    category: z.string().optional().describe('Category id, leaf name, or full path. Includes sub-categories.'),
    limit: z.number().int().min(1).max(50).default(15),
    threshold: z.number().min(0).max(1).default(0.2).describe('Minimum cosine similarity (0-1). 0.2 keeps loose matches; 0.4+ for stricter recall.'),
  },
  async ({ query, category, limit, threshold }) => {
    const apiKey = readEnvKey('OPENAI_API_KEY');
    if (!apiKey) {
      return { content: [{ type: 'text', text: 'Missing OPENAI_API_KEY in FlowADE settings — semantic search needs an OpenAI key for embeddings.' }], isError: true };
    }
    const userId = await getUserId();
    if (!isAuthUser(userId)) {
      return { content: [{ type: 'text', text: 'Not authenticated — semantic search requires a logged-in pro/team session.' }], isError: true };
    }
    let vector;
    try {
      [vector] = await openaiEmbed([query], apiKey);
    } catch (err) {
      return { content: [{ type: 'text', text: `Embedding failed: ${err.message}` }], isError: true };
    }
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: vector,
      match_threshold: threshold,
      match_count: limit,
    });
    if (error) {
      return { content: [{ type: 'text', text: `Search failed: ${error.message}` }], isError: true };
    }
    let results = (data || []).map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      type: r.type,
      tags: r.tags,
      categoryId: r.category_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      similarity: r.similarity,
    }));
    const categories = await loadCategories();
    if (category) {
      const allow = resolveCategoryFilter(category, categories);
      results = results.filter(r => r.categoryId && allow.has(r.categoryId));
    }
    results = annotateMemoriesWithCategoryPath(results, categories);
    return { content: [{ type: 'text', text: results.length ? JSON.stringify(results, null, 2) : `No semantic matches above threshold ${threshold} for "${query}".` }] };
  }
);

server.tool(
  'flowade_list_categories',
  'List the user\'s memory categories as a hierarchical tree. Each node carries id, parentId, name, emoji, description, and the memory count. Use this to discover available scopes before calling flowade_read_memory or flowade_search_memory with a category filter.',
  {},
  async () => {
    const categories = await loadCategories(true);
    if (categories.length === 0) {
      return { content: [{ type: 'text', text: 'No categories yet. The user can run "Categorize" from the Memory panel to populate this.' }] };
    }
    const memories = getMemoryEntries();
    const counts = new Map();
    for (const m of memories) {
      if (m.categoryId) counts.set(m.categoryId, (counts.get(m.categoryId) || 0) + 1);
    }
    const byId = new Map(categories.map(c => [c.id, { ...c, memoryCount: counts.get(c.id) || 0, children: [] }]));
    const roots = [];
    for (const c of byId.values()) {
      if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId).children.push(c);
      else roots.push(c);
    }
    return { content: [{ type: 'text', text: JSON.stringify(roots, null, 2) }] };
  }
);

server.tool(
  'flowade_write_memory',
  `Save knowledge to FlowADE's persistent memory brain. This is SHARED across all terminals and sessions.

PROACTIVE USE: When you discover important facts about the project — architecture, API patterns, tech decisions, bug causes, user preferences — save them immediately. Every terminal benefits from what you learn.`,
  {
    title: z.string().describe('Short descriptive title (e.g. "Auth uses JWT with RS256")'),
    content: z.string().describe('Detailed content — include rationale, examples, or specifics'),
    tags: z.array(z.string()).default([]).describe('Searchable tags (e.g. ["auth", "api", "backend"])'),
    type: z.enum(['fact', 'decision', 'context', 'reference', 'note']).default('note')
      .describe('fact=technical truth, decision=design choice, context=project state, reference=pointer to docs, note=general'),
  },
  async ({ title, content, tags, type }) => {
    ensureDirs();
    const existing = searchMemory(title);
    if (existing.length > 0) {
      const exact = existing.find(e => e.title.toLowerCase() === title.toLowerCase());
      if (exact) {
        exact.content = content;
        exact.tags = [...new Set([...(exact.tags || []), ...tags])];
        exact.updatedAt = Date.now();
        writeJson(join(MEMORY_DIR, `${exact.id}.json`), exact);
        cloudUpsert(exact);
        return { content: [{ type: 'text', text: `Updated existing memory: "${title}" [${type}]` }] };
      }
    }

    const tier = await getUserTier();
    const limit = TIER_LIMITS[tier] || 0;
    const count = getMemoryCount();
    if (limit > 0 && count >= limit) {
      return { content: [{ type: 'text', text: `Memory limit reached (${count}/${limit} for ${tier} tier). Delete old memories or upgrade plan.` }], isError: true };
    }

    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const entry = { id, title, content, tags, type, createdAt: Date.now(), updatedAt: Date.now() };
    writeJson(join(MEMORY_DIR, `${id}.json`), entry);
    await cloudUpsert(entry);
    // Fire-and-forget enrichment. Silent on failure — memory is still saved.
    autoCategorizeMemory(entry).catch(() => {});
    embedAndPersist(entry).catch(() => {});
    return { content: [{ type: 'text', text: `Saved memory: "${title}" [${type}] (${count + 1}/${limit || '∞'}) — now available to all terminals & devices` }] };
  }
);

server.tool(
  'flowade_update_memory',
  'Update an existing memory entry. Use this when information becomes stale or needs correction.',
  { id: z.string(), title: z.string().optional(), content: z.string().optional(), tags: z.array(z.string()).optional() },
  async ({ id, title, content, tags }) => {
    const path = join(MEMORY_DIR, `${id}.json`);
    const entry = readJson(path);
    if (!entry) return { content: [{ type: 'text', text: `Memory ${id} not found` }], isError: true };
    const shapeChanged = title != null || content != null || tags != null;
    if (title) entry.title = title;
    if (content) entry.content = content;
    if (tags) entry.tags = tags;
    entry.updatedAt = Date.now();
    writeJson(path, entry);
    cloudUpsert(entry);
    if (shapeChanged) embedAndPersist(entry).catch(() => {});
    return { content: [{ type: 'text', text: `Updated memory: "${entry.title}"` }] };
  }
);

server.tool(
  'flowade_delete_memory',
  'Delete a memory entry that is no longer relevant or accurate',
  { id: z.string() },
  async ({ id }) => {
    const path = join(MEMORY_DIR, `${id}.json`);
    const entry = readJson(path);
    if (!entry) return { content: [{ type: 'text', text: `Memory ${id} not found` }], isError: true };
    const deletedAt = new Date().toISOString();
    entry.deletedAt = deletedAt;
    entry.updatedAt = Date.now();
    writeJson(path, entry);
    cloudTombstone(id, deletedAt, entry.updatedAt);
    return { content: [{ type: 'text', text: `Deleted memory ${id}` }] };
  }
);

server.tool(
  'flowade_get_project_context',
  'Get combined project context: workspace + tasks + memory. Use this when onboarding to a new task or starting a fresh session to understand the full project state.',
  {},
  async () => {
    const workspace = getActiveWorkspace();
    const tasks = getTasks();
    const memory = getMemoryEntries();
    const context = {
      workspace: workspace ? { name: workspace.name, layout: workspace.layout, terminals: workspace.terminals?.map(t => ({ label: t.label, provider: t.provider })) } : null,
      tasks: { todo: tasks.filter(t => t.column === 'todo'), active: tasks.filter(t => t.column === 'active'), done: tasks.filter(t => t.column === 'done') },
      memoryCount: memory.length,
      recentMemories: memory.slice(0, 20).map(m => ({ id: m.id, title: m.title, type: m.type, tags: m.tags, content: m.content })),
    };
    return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
  }
);

// Register swarm tool set on top of the existing memory / workspace /
// tasks tools. Each registrar adds its own server.tool(...) entries;
// they route through the swarm bridge (lazy WS client) when invoked
// and surface SWARM_UNAVAILABLE cleanly when the desktop app is offline
// or the user has 'swarm.allowAgentSpawn' off.
registerTerminalTools(server);
registerLeaseTools(server);
registerChannelTools(server);
registerSwarmTools(server);

// Restore auth session from shared storage + warm the secret cache, then
// start server. Both must complete before tools that need API keys / auth.
await Promise.all([
  restoreSession().catch(() => {}),
  warmSecretsCache().catch(() => {}),
]);
const transport = new StdioServerTransport();
await server.connect(transport);
