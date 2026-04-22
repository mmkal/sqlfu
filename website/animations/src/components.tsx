import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {theme} from './theme';
import {sliceTokens, tokenizeSql, tokenizeTerminal, tokenizeTs} from './syntax';

type Lang = 'sql' | 'ts' | 'terminal';

const tokenize = {
  sql: tokenizeSql,
  ts: tokenizeTs,
  terminal: tokenizeTerminal,
};

type CodeSurfaceProps = {
  title: string;
  language: Lang;
  source: string;
  /** Characters visible so far — fractional values supported. */
  charCount?: number;
  /** Show a blinking cursor at the end of the revealed text. */
  cursor?: boolean;
  style?: React.CSSProperties;
  fontSize?: number;
  accent?: 'default' | 'generated';
  /** 0..1 opacity fade for generated/appearing surfaces. */
  fadeIn?: number;
  /** Lines to highlight with a soft additive background. 1-indexed. */
  addLines?: number[];
  /** Lines to highlight with a removal-colored background. */
  removeLines?: number[];
};

export function CodeSurface({
  title,
  language,
  source,
  charCount,
  cursor,
  style,
  fontSize = 22,
  accent = 'default',
  fadeIn,
  addLines,
  removeLines,
}: CodeSurfaceProps) {
  const frame = useCurrentFrame();
  const visibleCount = charCount ?? source.length;
  const allTokens = tokenize[language](source);
  const shown = sliceTokens(allTokens, Math.floor(visibleCount));

  const lines = tokensToLines(shown);
  const totalLines = (source.match(/\n/g)?.length ?? 0) + 1;
  const paddedLines: typeof lines = [];
  for (let i = 0; i < totalLines; i += 1) paddedLines.push(lines[i] || []);

  const cursorOpacity = cursor ? (Math.floor(frame / 12) % 2 === 0 ? 1 : 0) : 0;

  const tabColor =
    accent === 'generated' ? theme.accent : theme.codeMuted;

  return (
    <div
      style={{
        background: theme.codeBg,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        opacity: fadeIn ?? 1,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 18px',
          background: 'rgba(255, 255, 255, 0.04)',
          borderBottom: `1px solid rgba(255,255,255,0.07)`,
          fontFamily: theme.monoFont,
          fontSize: 15,
          color: tabColor,
          letterSpacing: 0.3,
        }}
      >
        <TrafficLights />
        <span>{title}</span>
      </div>
      <div
        style={{
          flex: 1,
          padding: '22px 26px',
          fontFamily: theme.monoFont,
          fontSize,
          lineHeight: 1.55,
          color: theme.codeText,
          whiteSpace: 'pre',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {paddedLines.map((tokens, lineIndex) => {
          const lineNumber = lineIndex + 1;
          const isAdd = addLines?.includes(lineNumber);
          const isRemove = removeLines?.includes(lineNumber);
          const background = isRemove
            ? theme.highlightRemove
            : isAdd
              ? theme.highlightAdd
              : 'transparent';
          return (
            <div
              key={lineIndex}
              style={{
                background,
                borderRadius: 4,
                padding: '0 6px',
                margin: '0 -6px',
              }}
            >
              {tokens.length === 0 ? (
                <span>&nbsp;</span>
              ) : (
                tokens.map((token, i) => (
                  <span key={i} style={{color: token.color}}>
                    {token.text}
                  </span>
                ))
              )}
              {cursor && lineIndex === paddedLines.length - 1 ? (
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: fontSize,
                    marginLeft: 2,
                    verticalAlign: 'text-bottom',
                    background: theme.accent,
                    opacity: cursorOpacity,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrafficLights() {
  return (
    <div style={{display: 'flex', gap: 6}}>
      {['#ff6157', '#febc2e', '#28c840'].map((color) => (
        <div
          key={color}
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: color,
            opacity: 0.72,
          }}
        />
      ))}
    </div>
  );
}

/** Utility — split tokens into arrays per physical line. */
function tokensToLines(tokens: {text: string; color: string}[]): {text: string; color: string}[][] {
  const lines: {text: string; color: string}[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length > 0) {
        lines[lines.length - 1]!.push({text: part, color: token.color});
      }
    });
  }
  return lines;
}

export function TerminalStrip({
  command,
  progress,
  output,
  style,
}: {
  command: string;
  /** 0..1 typing progress across `command`. */
  progress: number;
  output?: string;
  style?: React.CSSProperties;
}) {
  const frame = useCurrentFrame();
  const typedCount = Math.floor(command.length * progress);
  const typed = command.slice(0, typedCount);
  const cursorOn = Math.floor(frame / 12) % 2 === 0;
  const showOutput = progress >= 1 && output;

  return (
    <div
      style={{
        background: theme.terminalBg,
        borderRadius: theme.radius,
        color: theme.terminalText,
        fontFamily: theme.monoFont,
        fontSize: 20,
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: theme.shadow,
        ...style,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
        <span style={{color: theme.terminalPrompt}}>$</span>
        <span>{typed}</span>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 22,
            background: theme.terminalPrompt,
            opacity: cursorOn && progress < 1 ? 0.85 : 0,
          }}
        />
      </div>
      {showOutput ? (
        <div style={{color: theme.terminalDim, whiteSpace: 'pre-wrap'}}>{output}</div>
      ) : null}
    </div>
  );
}

export function FileTree({
  entries,
  style,
  highlightFlash,
}: {
  entries: {name: string; kind: 'dir' | 'file'; highlight?: boolean}[];
  style?: React.CSSProperties;
  /** 0..1 amount to animate the highlighted row's background intensity. */
  highlightFlash?: number;
}) {
  return (
    <div
      style={{
        background: theme.codeBg,
        color: theme.codeText,
        fontFamily: theme.monoFont,
        fontSize: 20,
        padding: '18px 22px',
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        ...style,
      }}
    >
      {entries.map((entry) => {
        const base = entry.kind === 'dir' ? theme.codeKeyword : theme.codeText;
        const flashAlpha = entry.highlight ? highlightFlash ?? 0 : 0;
        return (
          <div
            key={entry.name}
            style={{
              color: base,
              background: `rgba(158, 226, 148, ${0.36 * flashAlpha})`,
              padding: '2px 8px',
              borderRadius: 4,
              opacity: entry.highlight && flashAlpha === 0 ? 0 : 1,
            }}
          >
            {entry.name}
          </div>
        );
      })}
    </div>
  );
}

export function PanelBackdrop({children}: {children: React.ReactNode}) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 18% 0%, rgba(255, 214, 153, 0.3), transparent 640px), linear-gradient(180deg, ${theme.bgStrong} 0%, ${theme.bg} 22%, #fffdf9 100%)`,
        padding: 64,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

export function Caption({text, opacity}: {text: string; opacity: number}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 64,
        right: 64,
        bottom: 36,
        textAlign: 'center',
        color: theme.muted,
        fontFamily: theme.sansFont,
        fontSize: 26,
        letterSpacing: 0.2,
        opacity,
      }}
    >
      {text}
    </div>
  );
}

export function useEasedProgress({
  start,
  end,
  hold = 0,
}: {
  start: number;
  end: number;
  hold?: number;
}) {
  const frame = useCurrentFrame();
  const raw = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (hold === 0) return raw;
  return Math.min(1, raw);
}
