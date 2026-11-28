import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readdirSync, readFileSync, watch } from 'node:fs';

const localRequire = createRequire(import.meta.url);
const hostRoot = process.env.DSH_INSTALL_DIR
  ?? (process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'));
function loadSchemastery() {
  try {
    return hostRoot
      ? createRequire(join(hostRoot, 'package.json'))('@deepseek-ai/schemastery')
      : localRequire('@deepseek-ai/schemastery');
  } catch (err) {
    if (err?.code !== 'MODULE_NOT_FOUND' || !String(err.message).includes('@deepseek-ai/schemastery')) {
      throw err;
    }
    const chain = () => ({ default: chain, min: chain, max: chain, pattern: chain, volatile: chain });
    return { object: chain, string: chain, number: chain, boolean: chain, array: chain, dict: chain, union: chain, const: chain };
  }
}
const schemastery = loadSchemastery();
const z = schemastery.default ?? schemastery;

const pack = z.object({
  name: z.string().default('injected:prompt'),
  order: z.number().default(50),
  complete: z.boolean().default(false),
  dir: z.string(),
  ext: z.string().default('.txt'),
  texts: z.dict(z.string()),
});

export const Config = z.object({ pack: z.union([z.const(false), pack]).default(false).volatile() });

export const name = 'prompt-loader';

export const inject = ['systemPrompt', 'settings'];

const unwrap = (field) => (field && typeof field.get === 'function' ? field.get() : field);
const primary = (lang) => String(lang ?? '').split(/[-_]/)[0].toLowerCase();

function readPreference(settings) {
  try {
    const entries = typeof settings?.describe === 'function' ? settings.describe() : [];
    const locale = entries.find((entry) => String(entry.ns) === 'locale');
    const value = locale && typeof locale.value === 'object' ? locale.value.preference : undefined;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function loadTexts(dir, ext) {
  const result = {};
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return result;
  }
  for (const name of names) {
    if (!name.endsWith(ext) || name.length <= ext.length) continue;
    const id = name.slice(0, -ext.length);
    try {
      const text = readFileSync(join(dir, name), 'utf8').trim();
      if (text) result[id] = text;
    } catch {
    }
  }
  return result;
}

function resolveTexts(current) {
  const result = current && typeof current.dir === 'string' && current.dir
    ? loadTexts(current.dir, current.ext || '.txt')
    : {};
  if (current && current.texts && typeof current.texts === 'object') {
    for (const [id, raw] of Object.entries(current.texts)) {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (text) result[id] = text;
      else delete result[id];
    }
  }
  return result;
}

export function pickLocalized(map, preference) {
  if (!map || typeof map !== 'object') return '';
  if (preference && typeof map[preference] === 'string' && map[preference].trim()) {
    return map[preference].trim();
  }
  const want = primary(preference);
  if (want) {
    for (const [id, text] of Object.entries(map)) {
      if (primary(id) === want && typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  if (typeof map.en === 'string' && map.en.trim()) return map.en.trim();
  for (const [id, text] of Object.entries(map)) {
    if (primary(id) === 'en' && typeof text === 'string' && text.trim()) return text.trim();
  }
  for (const text of Object.values(map)) {
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return '';
}

export function apply(ctx, config = {}) {
  ctx.inject(['settings'], (scope) => scope.effect(
    () => scope.settings.configure({ auto: false }, ctx.fiber),
  ));

  let dispose = null;
  let watcher = null;
  let watchedDir = null;
  let signature = '';

  const ensureWatch = (dir) => {
    if (dir === watchedDir) return;
    try { watcher?.close(); } catch {}
    watcher = null;
    watchedDir = dir;
    if (!dir) return;
    try { watcher = watch(dir, () => refresh()); } catch {}
  };

  const refresh = () => {
    const current = unwrap(config.pack);
    const texts = current ? resolveTexts(current) : {};
    const preference = readPreference(ctx.settings);
    const text = pickLocalized(texts, preference);
    const next = current && text
      ? JSON.stringify([current.name, current.order, current.complete, text])
      : '';
    ensureWatch(current && typeof current.dir === 'string' && current.dir ? current.dir : null);
    if (next === signature) return;
    signature = next;
    if (dispose) {
      dispose();
      dispose = null;
    }
    if (!next) return;
    dispose = ctx.systemPrompt.section({
      name: current.name || 'injected:prompt',
      order: typeof current.order === 'number' ? current.order : 50,
      text,
      ...(current.complete ? { complete: true } : {}),
    });
  };

  ctx.effect(() => {
    const offVolatile = ctx.on?.('loader/volatile-update', refresh);
    const offDoc = ctx.on?.('settings/document-updated', (ns) => {
      if (String(ns) === 'locale' || String(ns) === 'prompt-loader') refresh();
    });
    refresh();
    const timer = setTimeout(refresh, 0);
    return () => {
      clearTimeout(timer);
      try { offVolatile?.(); } catch {}
      try { offDoc?.(); } catch {}
      try { watcher?.close(); } catch {}
      watcher = null;
      watchedDir = null;
      if (dispose) dispose();
      dispose = null;
      signature = '';
    };
  }, 'dsh-prompt-loader: localized prompt section');
}
