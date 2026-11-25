import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown renderer for untrusted model output.
 *
 * Images are not loaded: an image URL is fetched automatically by the browser,
 * so a prompt-injected response could exfiltrate conversation text through it.
 * The image is shown as a plain link the user can choose to open.
 * GFM (tables, strikethrough, task lists) is enabled: models often answer with tables.
 */
const components = {
  img: ({ src, alt }) => (
    <a href={src} target="_blank" rel="noopener noreferrer nofollow">
      [image: {alt || src}]
    </a>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

export default function SafeMarkdown({ children }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>;
}
