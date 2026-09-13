/// A compact, collapsible "how it works" + "where's the proof" callout.
/// Native <details> so it's accessible and needs no client JS. Drop it near the
/// top of a page's content with tailored steps + evidence links.
export function Explainer({
  title = "How it works",
  steps,
  links,
  defaultOpen = false,
}: {
  title?: string;
  steps: React.ReactNode[];
  links?: { label: string; href: string }[];
  defaultOpen?: boolean;
}) {
  return (
    <details className="explainer" open={defaultOpen}>
      <summary>
        <span className="explainer-q">?</span>
        {title}
        <span className="explainer-chev" aria-hidden>›</span>
      </summary>
      <div className="explainer-body">
        <ol className="explainer-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {links && links.length > 0 && (
          <div className="explainer-links">
            <span className="explainer-links-k mono">Where&apos;s the proof:</span>
            {links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
