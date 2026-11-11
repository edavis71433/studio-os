// ── The AI crawler switch (list item 175) ────────────────────────────────────
// One switch in Search, "Let AI assistants read this site", on by default. Off
// asks the known AI crawlers not to read the published site: the next publish adds
// one robots.txt group naming each of them with "Disallow: /". Search engines are
// not in the list, so Google and Bing search keep reading the site as before
// (Google-Extended and Applebot-Extended are the AI-only tokens of Google and
// Apple, not their search crawlers). Robots.txt is a request the big AI companies
// honour, not a lock; the switch says so. Pure.
import type { FileMap, SnapshotContent } from './render_types.ts';

/** The user agents an AI assistant reads the web with: training crawlers, the
 *  assistants' own search crawlers, and the fetchers that read a page when someone
 *  asks an assistant about it. Lower-case, as robots.txt matching is. */
export const AI_CRAWLERS = [
  'gptbot', 'oai-searchbot', 'chatgpt-user',                        // OpenAI: ChatGPT
  'claudebot', 'claude-searchbot', 'claude-user', 'anthropic-ai',   // Anthropic: Claude
  'perplexitybot', 'perplexity-user',                               // Perplexity
  'google-extended',                                                // Google's AI (Gemini), not Google Search
  'applebot-extended',                                              // Apple Intelligence, not Apple's search
  'meta-externalagent',                                             // Meta AI
  'amazonbot',                                                      // Alexa and Amazon's assistants
  'bytespider',                                                     // ByteDance
  'ccbot',                                                          // Common Crawl, which many models learn from
  'cohere-ai', 'mistralai-user', 'duckassistbot', 'youbot', 'diffbot', 'timpibot', 'omgilibot', 'imagesiftbot',
] as const;

/** Whether the owner switched AI assistants off. Absent means on, as every site has been. */
export const blocksAiCrawlers = (settings: SnapshotContent['settings'] | undefined): boolean => settings?.ai_crawlers === false;

/** The robots.txt group that asks every AI crawler above to stay out. */
export function aiCrawlerGroup(): string {
  return `# The owner asked AI assistants not to read this site.\n${AI_CRAWLERS.map((a) => `User-agent: ${a}`).join('\n')}\nDisallow: /\n`;
}

/** The drawn site with the owner's choice applied to its robots.txt. Unchanged (the same
 *  object) when AI assistants are allowed, so an allowed site draws byte for byte as before. */
export function withAiCrawlerChoice(files: FileMap, settings: SnapshotContent['settings'] | undefined): FileMap {
  if (!blocksAiCrawlers(settings)) return files;
  const robots = typeof files['robots.txt'] === 'string' ? String(files['robots.txt']) : 'User-agent: *\nAllow: /\n';
  return { ...files, 'robots.txt': `${robots.replace(/\n*$/, '\n')}\n${aiCrawlerGroup()}` };
}
