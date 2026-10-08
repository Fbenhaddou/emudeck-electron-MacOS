import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export type Page =
  | 'Library'
  | 'Emulators'
  | 'Firmware'
  | 'Console Mode'
  | 'Controllers'
  | 'This Mac'
  | 'Development';
export const sections: { title: string; pages: Page[] }[] = [
  {
    title: 'Workspace',
    pages: ['Library', 'Emulators', 'Firmware', 'Console Mode', 'Controllers'],
  },
  { title: 'System', pages: ['This Mac', 'Development'] },
];
export const pages = sections.flatMap((section) => section.pages);
const icons: Record<Page, string> = {
  Library: 'M3 7V5h6l2 2h10v13H3V7Z',
  Emulators: 'M6 7h12l3 10-3 2-4-4h-4l-4 4-3-2L6 7Zm1 4h4m-2-2v4m7-3h.1m2 2h.1',
  Firmware:
    'M7 5h10v14H7V5Zm3 3h4v4h-4V8ZM4 8h3M4 12h3M4 16h3m10-8h3m-3 4h3m-3 4h3',
  'Console Mode':
    'M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2v-5Zm2 5v2m16-2v2',
  Controllers:
    'M6 7h12l3 10-3 2-4-4h-4l-4 4-3-2L6 7Zm1 4h4m-2-2v4m7-3h.1m2 2h.1',
  'This Mac': 'M3 4h18v13H3V4ZM8 21h8m-4-4v4',
  Development: 'M8 5 2 12l6 7m8-14 6 7-6 7M14 3l-4 18',
};

const symbolKeys: Record<Page, string> = {
  Library: 'library',
  Emulators: 'emulators',
  Firmware: 'firmware',
  'Console Mode': 'console',
  Controllers: 'controllers',
  'This Mac': 'this-mac',
  Development: 'development',
};

/** Main masks this with the native SF Symbol when the Mac can render it. */
export function Symbol({ page, fill }: { page: Page; fill: boolean }) {
  return (
    <span
      className="symbol"
      data-symbol={`${symbolKeys[page]}${fill ? '-fill' : ''}`}
      aria-hidden="true"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icons[page]} />
      </svg>
    </span>
  );
}

/** System Settings–style pane header: tinted symbol tile, title and summary. */
export function Hero({
  page,
  tint,
  title,
  children,
}: {
  page: Page;
  tint: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="group hero" aria-label={title}>
      <span className={`tile ${tint}`}>
        <Symbol page={page} fill />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export function Caution() {
  return (
    <svg className="caution" viewBox="0 0 20 18" aria-hidden="true">
      <path d="M8.3 1.2a2 2 0 0 1 3.4 0l7.9 13.5A2 2 0 0 1 17.9 18H2.1a2 2 0 0 1-1.7-3.3L8.3 1.2Z" />
      <path className="mark" d="M10 5.5v6M10 14.2v.1" />
    </svg>
  );
}

/**
 * Finder-style middle truncation: keeps the volume/root and the meaningful end
 * of a path. The full path stays available as a tooltip and to VoiceOver.
 */
export function MiddlePath({ value }: { value: string }) {
  const element = useRef<HTMLParagraphElement | null>(null);
  const [shown, setShown] = useState(value);
  useLayoutEffect(() => {
    const target = element.current;
    const context =
      typeof ResizeObserver === 'undefined' || !target
        ? null
        : document.createElement('canvas').getContext('2d');
    if (!target || !context) {
      setShown(value);
      return undefined;
    }
    const fit = () => {
      const style = getComputedStyle(target);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = target.clientWidth;
      if (!width || context.measureText(value).width <= width) {
        setShown(value);
        return;
      }
      const characters = Array.from(value);
      let low = 1;
      let high = characters.length - 1;
      let best = '…';
      while (low <= high) {
        const keep = Math.floor((low + high) / 2);
        const head = Math.ceil(keep * 0.4);
        const candidate = `${characters.slice(0, head).join('')}…${characters
          .slice(characters.length - (keep - head))
          .join('')}`;
        if (context.measureText(candidate).width <= width) {
          best = candidate;
          low = keep + 1;
        } else high = keep - 1;
      }
      setShown(best);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => observer.disconnect();
  }, [value]);
  return (
    <p ref={element} className="path" title={value} aria-label={value}>
      {shown}
    </p>
  );
}

/** Indeterminate progress, drawn like NSProgressIndicator's spinning style. */
export function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 16 16" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <rect
          // eslint-disable-next-line react/no-array-index-key -- Fixed decorative spokes.
          key={index}
          x="7.25"
          y="1"
          width="1.5"
          height="4"
          rx="0.75"
          transform={`rotate(${index * 45} 8 8)`}
          opacity={0.25 + (index / 8) * 0.75}
        />
      ))}
    </svg>
  );
}

/** Segmented control with radio semantics; arrow keys move the selection. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (next: T) => void;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = options.findIndex((option) => option.value === value);
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    (
      event.currentTarget.parentElement?.querySelector(
        `[data-value="${next.value}"]`,
      ) as HTMLButtonElement | null
    )?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          data-value={option.value}
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={move}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
