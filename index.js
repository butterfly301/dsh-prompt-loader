/**
 * Inject a localized, hot-reloadable system-prompt section into a DSH agent.
 *
 * This plugin ships no wording of its own. `pack.dir` points at a directory of
 * plain-text files: each file name (minus its extension) is a language id, and
 * its content is that language's prompt text. The plugin scans the directory,
 * picks the text matching DSH's active `locale.preference`, and (re)registers
 * the section whenever the text, the language, or the files change. Adding a
 * language means dropping in one more file — no code or config edits.
 *
 * The `systemPrompt` service is provided by `@deepseek-ai/dsh-base`; the
 * `settings` service by `@deepseek-ai/dsh-settings`. No runtime dependencies.
 * @module dsh-prompt-loader
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readdirSync, readFileSync, watch } from 'node:fs';

const localRequire = createRequire(import.meta.url);
const hostRoot = process.env.DSH_INSTALL_DIR
  ?? (process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'));
const schemastery = hostRoot
  ? createRequire(join(hostRoot, 'package.json'))('@deepseek-ai/schemastery')
  : localRequire('@deepseek-ai/schemastery');
const z = schemastery.default ?? schemastery;

const pack = z.object({
  name: z.string().default('injected:prompt'),
  order: z.number().default(50),
  complete: z.boolean().default(false),
  // Directory of `<langId>.txt` files. File stem = language id, body = text.
  dir: z.string().required(),
  ext: z.string().default('.txt'),
});

/** Volatile: the plugin holds no user settings and never writes config back. */
export const Config = z.object({ pack: z.union([z.const(false), pack]).default(false).volatile() });

/** Cordis plugin name. */
export const name = 'prompt-loader';

/** Host services consumed by this plugin. */
export const inject = ['systemPrompt', 'settings'];

const unwrap = (field) => (field && typeof field.get === 'function' ? field.get() : field);
const primary = (lang) => String(lang ?? '').split(/[-_]/)[0].toLowerCase();

/**
 * Read the DSH active-language preference from the `locale` settings document.
 * The host realm has no `locale/change` event; `locale.preference` is the only
 * reliable signal available here (the client bridges its active locale back).
 */
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

/** Load `{ [langId]: text }` from every `<langId><ext>` file in a directory. */
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
      // Unreadable file: skip it rather than dropping the whole section.
    }
  }
  return result;
}

/**
 * Pick from a `{ [langId]: value }` map with no language hardcoded: exact id,
 * then matching primary BCP-47 subtag, then the first non-empty value.
 */
function pickLocalized(map, preference) {
  if (!map || typeof map !== 'object') return '';
  if (preference && typeof map[preference] === 'string' && map[preference]) return map[preference];
  const want = primary(preference);
  if (want) {
    for (const [id, text] of Object.entries(map)) {
      if (primary(id) === want && typeof text === 'string' && text) return text;
    }
  }
  for (const text of Object.values(map)) {
    if (typeof text === 'string' && text) return text;
  }
  return '';
}

/**
 * Register the localized section and keep it in sync with file edits, config
 * edits, and language switches.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config - `{ pack }`
 */
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
    const texts = current && typeof current.dir === 'string'
      ? loadTexts(current.dir, current.ext || '.txt')
      : {};
    const preference = readPreference(ctx.settings);
    const text = pickLocalized(texts, preference);
    const next = current && text
      ? JSON.stringify([current.name, current.order, current.complete, text])
      : '';
    ensureWatch(current && typeof current.dir === 'string' ? current.dir : null);
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
    ctx.on?.('loader/volatile-update', refresh);
    ctx.on?.('settings/document-updated', (ns) => {
      if (String(ns) === 'locale' || String(ns) === 'prompt-loader') refresh();
    });
    refresh();
    // Deferred pass in case the locale settings document lands after mount.
    const timer = setTimeout(refresh, 0);
    return () => {
      clearTimeout(timer);
      try { watcher?.close(); } catch {}
      watcher = null;
      watchedDir = null;
      if (dispose) dispose();
      dispose = null;
      signature = '';
    };
  }, 'dsh-prompt-loader: localized prompt section');
}
