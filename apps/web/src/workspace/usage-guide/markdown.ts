import licenseUrl from '../../../../../LICENSE?url&no-inline';
import executionUrl from '../../../../../docs/task-execution.md?url&no-inline';
import billingUrl from '../../../../../docs/billing.md?url&no-inline';
import adminUrl from '../../../../../docs/admin-console.md?url&no-inline';

export type GuideHeading = { id: string; text: string; level: number };
type TextContent = { value?: string; alt?: string | null; children?: TextContent[] };
type TextNode = {
  type: string;
  tagName?: string;
  value?: string;
  alt?: string | null;
  depth?: number;
  children?: TextNode[];
  properties?: { className?: unknown };
  data?: { hProperties?: Record<string, unknown> };
};

export function nodeText(node?: TextContent): string {
  if (!node) return '';
  return node.value ?? node.alt ?? node.children?.map(nodeText).join('') ?? '';
}

export function guideHeadings({ headings }: { headings: GuideHeading[] }) {
  return (tree: TextNode) => {
    const used = new Set<string>();
    function walk(node: TextNode) {
      if (node.type === 'heading') {
        const text = nodeText(node);
        const slug = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').replace(/\s+/g, '-') || 'section';
        let id = slug;
        let suffix = 1;
        while (used.has(id)) id = `${slug}-${suffix++}`;
        used.add(id);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
        if (node.depth === 2 || node.depth === 3) headings.push({ id, text, level: node.depth });
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}

const documents: Record<string, string> = { LICENSE: licenseUrl, 'docs/task-execution.md': executionUrl, 'docs/billing.md': billingUrl, 'docs/admin-console.md': adminUrl };

export function guideUrl(raw: string, key: string, base = '/'): string {
  const url = raw.trim();
  // Reject protocol-relative URLs and control-character obfuscation as well.
  if (/[\u0000-\u0020\u007f]/.test(url) || url.startsWith('//') || url.includes('\\')) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return (key === 'src' ? /^https?:/i : /^(https?:|mailto:)/i).test(url) ? url : '';
  if (url.startsWith('#')) return url;
  const path = url.replace(/^\.\//, '');
  const documentPath = path.split(/[?#]/)[0]!;
  if (key === 'href' && documents[documentPath]) return documents[documentPath]! + path.slice(documentPath.length);
  if (/^\/?guide\//.test(path)) return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  if (url.startsWith('/')) return url;
  // Repository-relative documents should open actual files, never SPA routes.
  return key === 'href' ? `https://github.com/jaydenluo/vibeplan/blob/main/${path}` : '';
}
