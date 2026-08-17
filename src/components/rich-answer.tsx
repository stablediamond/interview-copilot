import * as React from "react";

/**
 * Minimal Markdown renderer for streamed teleprompter answers. Supports the
 * subset the answer prompt emits: **bold**, "- " bullet lists, and short bold
 * question headers. Intentionally tiny (no markdown dependency).
 *
 * Any Chinese characters are automatically annotated with their pinyin
 * (rendered as ruby text above each character) so the candidate can read a
 * Chinese answer aloud. Non-Chinese text is untouched.
 */
export function RichAnswer({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) =>
        block.type === "list" ? (
          <ul key={i} className="ml-1 list-disc space-y-1 pl-4 marker:text-muted-foreground">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="leading-relaxed">
            <Inline text={block.text} />
          </p>
        )
      )}
    </div>
  );
}

type Block = { type: "p"; text: string } | { type: "list"; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*]\s+(.*)$/);

    if (bullet) {
      listItems.push(bullet[1]);
      continue;
    }

    // Any non-bullet line ends the current list. Each line is its own
    // paragraph so multi-question blocks and intentional line breaks are
    // preserved (don't merge separate lines into one run-on paragraph).
    flushList();
    if (line) blocks.push({ type: "p", text: line });
  }

  flushList();
  return blocks;
}

function Inline({ text }: { text: string }) {
  const parts = React.useMemo(() => splitBold(text), [text]);
  return (
    <>
      {parts.map((part, i) =>
        part.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            <Annotated text={part.text} />
          </strong>
        ) : (
          <React.Fragment key={i}>
            <Annotated text={part.text} />
          </React.Fragment>
        )
      )}
    </>
  );
}

function splitBold(text: string): Array<{ text: string; bold: boolean }> {
  const result: Array<{ text: string; bold: boolean }> = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    result.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex), bold: false });
  }
  return result.length ? result : [{ text, bold: false }];
}

// CJK ideographs (main block + extension A + compatibility). Each matched
// character gets a pinyin reading; everything else renders as-is.
const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/;
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+|[^\u3400-\u9fff\uf900-\ufaff]+/g;

type PinyinFn = (text: string, options: Record<string, unknown>) => string[];

// pinyin-pro ships a ~140KB dictionary, so it's loaded on demand the first time
// a Chinese answer actually renders. English-only users never pay for it.
let pinyinFn: PinyinFn | null = null;
let pinyinLoader: Promise<void> | null = null;

function usePinyin(): PinyinFn | null {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (pinyinFn) return;
    if (!pinyinLoader) {
      pinyinLoader = import("pinyin-pro")
        .then((m) => {
          pinyinFn = m.pinyin as unknown as PinyinFn;
        })
        .catch(() => {
          // Dictionary failed to load — characters just render without pinyin.
        });
    }
    let active = true;
    pinyinLoader.then(() => {
      if (active) force();
    });
    return () => {
      active = false;
    };
  }, []);
  return pinyinFn;
}

// Picks the CJK path only when needed so the pinyin loader (and its hook) never
// runs for plain English answers.
function Annotated({ text }: { text: string }) {
  if (!CJK_CHAR.test(text)) return <>{text}</>;
  return <AnnotatedCjk text={text} />;
}

/**
 * Renders a string with the pinyin stacked directly ABOVE each Chinese
 * character (not inline beside it), which reads far more cleanly. Pinyin is
 * computed per contiguous Chinese run so tones for context-sensitive
 * characters (多音字) stay correct, then zipped back per character. Until the
 * dictionary finishes loading, a non-breaking space holds the top line so the
 * characters don't jump when it arrives.
 */
function AnnotatedCjk({ text }: { text: string }) {
  const py = usePinyin();
  const segments = text.match(CJK_RUN) ?? [text];

  return (
    <>
      {segments.map((seg, si) => {
        if (!CJK_CHAR.test(seg)) {
          return <React.Fragment key={si}>{seg}</React.Fragment>;
        }
        const chars = Array.from(seg);
        const readings = py
          ? py(seg, { type: "array", toneType: "symbol", nonZh: "consecutive" })
          : [];
        return chars.map((ch, ci) => (
          <span
            key={`${si}-${ci}`}
            className="mx-[0.5px] inline-flex flex-col items-center align-bottom leading-tight"
          >
            <span className="text-[0.62em] leading-none text-muted-foreground">
              {readings[ci] || "\u00A0"}
            </span>
            <span>{ch}</span>
          </span>
        ));
      })}
    </>
  );
}
