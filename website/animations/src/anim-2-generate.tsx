import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Caption, CodeSurface, PanelBackdrop, TerminalStrip} from './components';
import {
  appTsCompletion,
  appTsSnippet,
  generateCommand,
  userByIdGeneratedTs,
  userByIdSql,
} from './fixtures';
import {theme} from './theme';

/**
 * Animation 2: ".sql → .sql.ts" with an autocomplete payoff.
 *
 * Beats (30fps):
 *   0-48     Left panel: type user-by-id.sql
 *   48-72    Terminal strip flashes `$ sqlfu generate`
 *   72-96    Small pause
 *   96-192   Right panel: materialize user-by-id.sql.ts
 *   192-216  app.ts pane slides up
 *   216-264  Autocomplete popover appears with .id .name .email
 *   264-300  Hold + caption
 * Total: 300 frames = 10s at 30fps
 */
export const GenerateAnim: React.FC = () => {
  const frame = useCurrentFrame();

  const sqlProgress = interpolate(frame, [6, 48], [0, userByIdSql.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cmdProgress = interpolate(frame, [48, 66], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const terminalOpacity = interpolate(frame, [48, 60, 78, 96], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const generatedFade = interpolate(frame, [96, 132], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const generatedChars = interpolate(frame, [108, 192], [0, userByIdGeneratedTs.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const appSlide = interpolate(frame, [192, 216], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const appChars = interpolate(frame, [196, 226], [0, appTsSnippet.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const popoverOpacity = interpolate(frame, [226, 246], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const popoverHighlight = Math.floor(interpolate(frame, [246, 264], [0, appTsCompletion.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }));

  const captionOpacity = interpolate(frame, [270, 288], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <PanelBackdrop>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr',
          gap: 32,
          height: '100%',
        }}
      >
        <CodeSurface
          title="sql/user-by-id.sql"
          language="sql"
          source={userByIdSql}
          charCount={sqlProgress}
          cursor={frame < 48}
          fontSize={26}
          style={{height: '100%'}}
        />
        <CodeSurface
          title="sql/.generated/user-by-id.sql.ts"
          language="ts"
          source={userByIdGeneratedTs}
          charCount={generatedChars}
          fadeIn={generatedFade}
          cursor={frame >= 108 && frame < 192}
          fontSize={16}
          accent="generated"
          style={{height: '100%'}}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          top: '38%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${interpolate(terminalOpacity, [0, 1], [0.92, 1])})`,
          opacity: terminalOpacity,
          width: 420,
        }}
      >
        <TerminalStrip command={generateCommand} progress={cmdProgress} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 64,
          bottom: 64 + interpolate(appSlide, [0, 1], [120, 0]),
          opacity: appSlide,
          width: 520,
        }}
      >
        <div
          style={{
            background: theme.codeBg,
            borderRadius: theme.radius,
            padding: 0,
            boxShadow: theme.shadow,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              padding: '10px 16px',
              fontFamily: theme.monoFont,
              color: theme.accent,
              fontSize: 14,
              borderBottom: `1px solid rgba(255,255,255,0.08)`,
            }}
          >
            app.ts
          </div>
          <div
            style={{
              fontFamily: theme.monoFont,
              fontSize: 16,
              color: theme.codeText,
              padding: '16px 18px',
              whiteSpace: 'pre',
              lineHeight: 1.6,
              minHeight: 120,
            }}
          >
            {appTsSnippet.slice(0, Math.floor(appChars))}
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 16,
                background: theme.accent,
                verticalAlign: 'text-bottom',
                opacity: frame % 24 < 12 ? 1 : 0,
              }}
            />
          </div>

          <AutocompletePopover opacity={popoverOpacity} highlightIndex={popoverHighlight % appTsCompletion.length} />
        </div>
      </div>

      <Caption text="types follow sql. autocomplete for free." opacity={captionOpacity} />
    </PanelBackdrop>
  );
};

function AutocompletePopover({opacity, highlightIndex}: {opacity: number; highlightIndex: number}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 260,
        bottom: 28,
        background: '#2b1d15',
        border: `1px solid ${theme.accent}`,
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
        fontFamily: theme.monoFont,
        fontSize: 15,
        color: theme.codeText,
        minWidth: 180,
        opacity,
        transform: `translateY(${interpolate(opacity, [0, 1], [6, 0])}px)`,
      }}
    >
      {appTsCompletion.map((name, i) => (
        <div
          key={name}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: i === highlightIndex ? 'rgba(157, 77, 18, 0.35)' : 'transparent',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <span>
            <span style={{color: theme.codeKeyword, marginRight: 10, fontSize: 11}}>●</span>
            {name}
          </span>
          <span style={{color: theme.codeType, fontSize: 13}}>
            {name === 'id' ? 'number' : 'string'}
          </span>
        </div>
      ))}
    </div>
  );
}
