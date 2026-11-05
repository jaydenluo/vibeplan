import { useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent } from 'react';
import Markdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { BookOpen, Check, Copy, List } from 'lucide-react';
import guideSource from '../../../../user-guide.md?raw';
import { guideHeadings, guideUrl, nodeText, type GuideHeading } from './usage-guide/markdown.js';
import './usage-guide/guide.css';

function CodeBlock({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const code = node?.children?.find(child => child.type === 'element' && child.tagName === 'code');
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const language = (Array.isArray(classes) ? classes : []).find(value => String(value).startsWith('language-'));
  async function copy() {
    try {
      await navigator.clipboard.writeText(nodeText(code));
      setCopied(true); setError('');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setError('复制失败，请选中代码手动复制。'); }
  }
  return <div className="guide-code">
    <div className="guide-code-toolbar"><span>{language ? String(language).slice(9) : '纯文本'}</span><button type="button" onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? '已复制' : '复制代码'}</button></div>
    <pre tabIndex={0}>{children}</pre>
    {error && <p className="guide-copy-error" role="status">{error}</p>}
  </div>;
}

function GuideImage({ src, alt, title }: ComponentProps<'img'>) {
  const [failedSource, setFailedSource] = useState<string>();
  return !src || failedSource === src
    ? <span className="guide-image-failed">图片暂时无法显示：{alt || '教程配图'}</span>
    : <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" onError={() => setFailedSource(src)} />;
}

export function UsageGuidePage({ markdown = guideSource }: { markdown?: string }) {
  const articleRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState('');
  function scrollToHeading(element: HTMLElement) {
    const article = articleRef.current;
    if (!article) return;
    article.scrollTo?.({ top: Math.max(0, article.scrollTop + element.getBoundingClientRect().top - article.getBoundingClientRect().top - 28) });
  }
  const { content, headings } = useMemo(() => {
    const headings: GuideHeading[] = [];
    // Markdown's synchronous API runs the plugins and renders in one pass;
    // heading IDs and the outline therefore come from the very same AST.
    const content = Markdown({
      children: markdown,
      skipHtml: true,
      remarkPlugins: [remarkGfm, [guideHeadings, { headings }]],
      rehypePlugins: [[rehypeHighlight, { detect: false, ignoreMissing: true }]],
      urlTransform: (url, key) => guideUrl(url, key, import.meta.env.BASE_URL),
      components: {
        pre: CodeBlock,
        img: GuideImage,
        table: ({ children }) => <div className="guide-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
        a: ({ href, children, title }) => <a href={href} title={title} {...(href && /^(https?:|mailto:)/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>,
      },
    });
    return { content, headings };
  }, [markdown]);

  useEffect(() => {
    const article = articleRef.current;
    const elements = headings.map(heading => document.getElementById(heading.id)).filter((element): element is HTMLElement => Boolean(element));
    function updateActive() {
      let current = elements[0];
      const threshold = (article?.getBoundingClientRect().top ?? 0) + 120;
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= threshold) current = element;
        else break;
      }
      if (current) setActiveId(current.id);
    }
    function visitHash() {
      let id: string;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      const target = articleRef.current?.querySelectorAll<HTMLElement>('[id]');
      const element = Array.from(target ?? []).find(heading => heading.id === id);
      if (element) { scrollToHeading(element); setActiveId(id); }
      else updateActive();
    }
    visitHash();
    let frame: number | undefined;
    function onScroll() {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; updateActive(); });
    }
    // Image loads and resizes can move a heading without a scroll event.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onScroll);
    if (articleRef.current) observer?.observe(articleRef.current);
    article?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('hashchange', visitHash);
    window.addEventListener('popstate', visitHash);
    return () => {
      article?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('hashchange', visitHash);
      window.removeEventListener('popstate', visitHash);
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [headings]);

  function navigate(event: MouseEvent<HTMLAnchorElement>, heading: GuideHeading) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const hash = `#${encodeURIComponent(heading.id)}`;
    if (window.location.hash !== hash) window.history.pushState({}, '', hash);
    const element = document.getElementById(heading.id);
    if (element) scrollToHeading(element);
    setActiveId(heading.id);
    const details = event.currentTarget.closest('details');
    if (details) details.open = false;
  }

  const outline = <ol>{headings.map(heading => <li key={heading.id} className={heading.level === 3 ? 'guide-toc-sub' : undefined}><a href={`#${heading.id}`} aria-current={activeId === heading.id ? 'location' : undefined} onClick={event => navigate(event, heading)}>{heading.text}</a></li>)}</ol>;

  return <section className="usage-guide" aria-label="使用教程">
    <header className="guide-masthead"><span><BookOpen size={18} aria-hidden="true" /> 使用教程</span><span>从连接项目到完成验收</span></header>
    <div className="guide-layout">
      {headings.length > 0 && <details className="guide-mobile-toc"><summary><List size={16} aria-hidden="true" />目录</summary><nav aria-label="移动端章节导航">{outline}</nav></details>}
      <article className="guide-article" ref={articleRef}>{content}</article>
      {headings.length > 0 && <aside className="guide-toc"><nav aria-label="本页大纲"><p>本页大纲</p>{outline}</nav><a className="guide-back-top" href="#" onClick={event => { event.preventDefault(); window.history.pushState({}, '', window.location.pathname + window.location.search); articleRef.current?.scrollTo?.({ top: 0 }); setActiveId(headings[0]?.id ?? ''); }}>返回顶部 ↑</a></aside>}
    </div>
  </section>;
}
