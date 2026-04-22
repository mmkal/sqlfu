import React from 'react';
import {AbsoluteFill, interpolate, Sequence, useCurrentFrame} from 'remotion';
import {Caption, CodeSurface, PanelBackdrop, TerminalStrip} from './components';
import {
  addEmailMigration,
  appTsCompletion,
  appTsSnippet,
  definitionsAfterEmail,
  definitionsAfterFK,
  definitionsAfterUsers,
  definitionsBeforeEmail,
  definitionsBeforeUsers,
  draftCommand,
  generateCommand,
  migrationsTreeAfter,
  migrationsTreeBefore,
  userByIdGeneratedTs,
  userByIdSql,
} from './fixtures';
import {theme} from './theme';

/**
 * Sequential landing-page animation: one large stage that plays all three
 * beats end-to-end. This replaces the three-card grid entirely (see
 * `?animation=sequential` in the landing page).
 *
 * Beats (30fps, 1280x720):
 *   - Beat 1 (0-300): schema refactor in definitions.sql (users + posts FK).
 *     Human-typed. The "schema lives in SQL" moment.
 *   - Beat 2 (300-600): sqlfu generate. Terminal runs the command; the
 *     generated .sql.ts file appears fully formed (NO typing — it's a
 *     generated output, not a human edit). Small app.ts pane shows the
 *     autocomplete payoff.
 *   - Beat 3 (600-840): sqlfu draft. Edit definitions.sql to add email,
 *     terminal runs `sqlfu draft`, a new migration file pops into the
 *     migrations tree, its SQL appears fully formed (also generated).
 *
 * Total: 840 frames = 28s at 30fps. Loops.
 */

export const sequentialDurationInFrames = 840;

const BEAT_1_START = 0;
const BEAT_1_END = 300;
const BEAT_2_START = 300;
const BEAT_2_END = 600;
const BEAT_3_START = 600;
const BEAT_3_END = 840;

export const SequentialAnim: React.FC = () => {
  return (
    <PanelBackdrop>
      <StageHeader />

      <Sequence from={BEAT_1_START} durationInFrames={BEAT_1_END - BEAT_1_START}>
        <Beat1Schema />
      </Sequence>

      <Sequence from={BEAT_2_START} durationInFrames={BEAT_2_END - BEAT_2_START}>
        <Beat2Generate />
      </Sequence>

      <Sequence from={BEAT_3_START} durationInFrames={BEAT_3_END - BEAT_3_START}>
        <Beat3Draft />
      </Sequence>
    </PanelBackdrop>
  );
};

/** Header sits at the top of the stage, labelling the current beat. */
function StageHeader() {
  const frame = useCurrentFrame();

  const label =
    frame < BEAT_2_START
      ? '1 / 3  ·  schema lives in sql.'
      : frame < BEAT_3_START
        ? '2 / 3  ·  types follow sql.'
        : '3 / 3  ·  migrations draft themselves.';

  // Soft crossfade between beats so the label change isn't abrupt.
  const beat1to2 = interpolate(frame, [BEAT_2_START - 12, BEAT_2_START + 12], [1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const beat2to3 = interpolate(frame, [BEAT_3_START - 12, BEAT_3_START + 12], [1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(beat1to2, beat2to3);

  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        left: 64,
        right: 64,
        display: 'flex',
        justifyContent: 'center',
        fontFamily: theme.sansFont,
        fontSize: 20,
        letterSpacing: 0.4,
        color: theme.muted,
        opacity,
      }}
    >
      {label}
    </div>
  );
}

/** Beat 1: schema refactor. Mirrors the standalone anim-1-schema but with
 *  frame numbers local to its 300-frame window (Sequence shifts useCurrentFrame). */
function Beat1Schema() {
  const frame = useCurrentFrame();

  const usersEnd = definitionsBeforeUsers.length;
  const postsEnd = definitionsAfterUsers.length;
  const finalEnd = definitionsAfterFK.length;

  const phaseA = interpolate(frame, [0, 54], [0, usersEnd], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const phaseB = interpolate(frame, [78, 156], [usersEnd, postsEnd], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const phaseCRemove = interpolate(frame, [192, 210], [postsEnd, postsEnd - 'author_name text,'.length - 3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const phaseCType = interpolate(frame, [210, 258], [0, finalEnd], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const authorNameLineIndex = 9;
  const highlighting = frame >= 174 && frame < 210;

  let visibleSource = definitionsBeforeUsers;
  let visibleCount: number = phaseA;
  let removeLines: number[] | undefined;
  let addLines: number[] | undefined;

  if (frame >= 54 && frame < 78) {
    visibleSource = definitionsBeforeUsers;
    visibleCount = usersEnd;
  } else if (frame >= 78 && frame < 174) {
    visibleSource = definitionsAfterUsers;
    visibleCount = phaseB;
  } else if (frame >= 174 && frame < 192) {
    visibleSource = definitionsAfterUsers;
    visibleCount = postsEnd;
    removeLines = [authorNameLineIndex];
  } else if (frame >= 192 && frame < 210) {
    visibleSource = definitionsAfterUsers;
    visibleCount = phaseCRemove;
    removeLines = [authorNameLineIndex];
  } else if (frame >= 210) {
    visibleSource = definitionsAfterFK;
    visibleCount = phaseCType;
    addLines = [authorNameLineIndex];
  }

  const captionOpacity = interpolate(frame, [258, 282, 300], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <BeatFrame>
      <CodeSurface
        title="definitions.sql"
        language="sql"
        source={visibleSource}
        charCount={visibleCount}
        cursor
        fontSize={28}
        addLines={addLines}
        removeLines={highlighting ? removeLines : undefined}
        style={{width: '100%', height: '100%'}}
      />
      <Caption text="your schema is one .sql file. edit it like code." opacity={captionOpacity} />
    </BeatFrame>
  );
}

/** Beat 2: sqlfu generate. Shows a .sql query file on the left, a terminal
 *  types `sqlfu generate`, and the generated .sql.ts file fades in fully
 *  formed on the right — NO typing, because it's a generator output.
 *  After that the right pane swaps to app.ts with autocomplete on the row
 *  types. Layout is one row (left = source SQL, right = generated/app)
 *  with the terminal as a strip underneath. */
function Beat2Generate() {
  const frame = useCurrentFrame();

  // Beat 2 local timing (0-300):
  //   0-60     type the .sql query file on the left
  //   60-78    pause
  //   78-114   terminal types `sqlfu generate`
  //   120+     terminal shows `wrote ...` output
  //   138-180  generated .sql.ts fades in on the right (fully formed)
  //   210-240  right pane slides out, app.ts slides in
  //   240-270  app.ts shows call + autocomplete popover
  //   270+     caption fades in, hold
  const sqlQueryProgress = interpolate(frame, [6, 60], [0, userByIdSql.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cmdProgress = interpolate(frame, [78, 114], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const terminalOutput = frame >= 120 ? 'wrote sql/.generated/user-by-id.sql.ts' : undefined;

  // Right pane appears fully formed (no typing). After a hold, it swaps to
  // app.ts for the autocomplete payoff. Uses two stacked panes with
  // crossfading opacity; the generated TS pane never gets a typing cursor.
  const generatedOpacity = interpolate(frame, [138, 180, 210, 228], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const generatedSlide = interpolate(frame, [138, 180], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const appOpacity = interpolate(frame, [216, 240], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const appSlide = interpolate(frame, [216, 240], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const appChars = interpolate(frame, [228, 258], [0, appTsSnippet.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const popoverOpacity = interpolate(frame, [258, 276], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const popoverHighlight = Math.floor(
    interpolate(frame, [264, 294], [0, appTsCompletion.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const captionOpacity = interpolate(frame, [270, 294], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <BeatFrame>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '0.8fr 1fr',
          gridTemplateRows: '1fr auto',
          gap: 18,
          height: '100%',
        }}
      >
        <CodeSurface
          title="sql/user-by-id.sql"
          language="sql"
          source={userByIdSql}
          charCount={sqlQueryProgress}
          cursor={frame < 60}
          fontSize={20}
          style={{gridColumn: '1 / 2', gridRow: '1 / 2'}}
        />

        {/* Right pane — stacked: generated TS on top, app.ts crossfades in
            once the generator beat has landed. */}
        <div style={{gridColumn: '2 / 3', gridRow: '1 / 2', position: 'relative'}}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: generatedOpacity,
              transform: `translateY(${generatedSlide}px)`,
            }}
          >
            <CodeSurface
              title="sql/.generated/user-by-id.sql.ts"
              language="ts"
              source={userByIdGeneratedTs}
              fontSize={14}
              accent="generated"
              style={{height: '100%'}}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: appOpacity,
              transform: `translateY(${appSlide}px)`,
            }}
          >
            <AppTsPane
              chars={appChars}
              blink={frame % 24 < 12}
              popoverOpacity={popoverOpacity}
              popoverHighlight={popoverHighlight}
            />
          </div>
        </div>

        <div style={{gridColumn: '1 / 3', gridRow: '2 / 3'}}>
          <TerminalStrip command={generateCommand} progress={cmdProgress} output={terminalOutput} />
        </div>
      </div>

      <Caption text="you write sql. sqlfu generates the typescript." opacity={captionOpacity} />
    </BeatFrame>
  );
}

/** app.ts preview pane with its autocomplete popover — used as the payoff
 *  in beat 2. The pane itself is static; the popover is animated. */
function AppTsPane({
  chars,
  blink,
  popoverOpacity,
  popoverHighlight,
}: {
  chars: number;
  blink: boolean;
  popoverOpacity: number;
  popoverHighlight: number;
}) {
  return (
    <div
      style={{
        background: theme.codeBg,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        overflow: 'hidden',
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 18px',
          fontFamily: theme.monoFont,
          color: theme.accent,
          fontSize: 15,
          borderBottom: `1px solid rgba(255,255,255,0.07)`,
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        <span>app.ts</span>
      </div>
      <div
        style={{
          fontFamily: theme.monoFont,
          fontSize: 18,
          color: theme.codeText,
          padding: '18px 22px',
          whiteSpace: 'pre',
          lineHeight: 1.6,
          flex: 1,
          position: 'relative',
        }}
      >
        {appTsSnippet.slice(0, Math.floor(chars))}
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 18,
            background: theme.accent,
            verticalAlign: 'text-bottom',
            opacity: blink ? 1 : 0,
          }}
        />
        <AutocompletePopover
          opacity={popoverOpacity}
          highlightIndex={popoverHighlight % appTsCompletion.length}
        />
      </div>
    </div>
  );
}

/** Beat 3: sqlfu draft. Edit definitions.sql (add email), terminal runs
 *  `sqlfu draft`, a new migration file pops into the tree fully formed. */
function Beat3Draft() {
  const frame = useCurrentFrame();

  const editProgress = interpolate(
    frame,
    [12, 78],
    [definitionsBeforeEmail.length, definitionsAfterEmail.length],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const editing = frame >= 12 && frame < 78;
  const emailLine = 4; // 1-indexed line number for highlight

  const cmdProgress = interpolate(frame, [96, 132], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const terminalOutput = frame >= 144 ? 'drafted migrations/20260419000000_add_email.sql' : undefined;

  // Tree + migration file appear AT THE SAME TIME after the terminal finishes.
  // The migration SQL fades in fully formed (generator output).
  const treeFlash = interpolate(frame, [162, 180, 216], [0, 1, 0.55], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const migrationFade = interpolate(frame, [174, 210], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const activeTree = frame >= 162 ? migrationsTreeAfter : migrationsTreeBefore;

  const captionOpacity = interpolate(frame, [216, 234], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <BeatFrame>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.1fr 1fr',
          gridTemplateRows: '1fr auto',
          gap: 20,
          height: '100%',
        }}
      >
        <CodeSurface
          title="definitions.sql"
          language="sql"
          source={frame < 12 ? definitionsBeforeEmail : definitionsAfterEmail}
          charCount={frame < 12 ? definitionsBeforeEmail.length : editProgress}
          cursor={editing}
          fontSize={22}
          addLines={frame >= 42 ? [emailLine] : undefined}
          style={{gridColumn: '1 / 2', gridRow: '1 / 2'}}
        />
        <div
          style={{
            gridColumn: '2 / 3',
            gridRow: '1 / 2',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            height: '100%',
            minHeight: 0,
          }}
        >
          <MigrationsTreePane entries={activeTree} flash={treeFlash} />
          <div style={{opacity: migrationFade, flex: 1, minHeight: 0}}>
            <CodeSurface
              title="migrations/20260419_add_email.sql"
              language="sql"
              source={addEmailMigration}
              fontSize={16}
              accent="generated"
              style={{height: '100%'}}
            />
          </div>
        </div>
        <div style={{gridColumn: '1 / 3', gridRow: '2 / 3'}}>
          <TerminalStrip command={draftCommand} progress={cmdProgress} output={terminalOutput} />
        </div>
      </div>

      <Caption text="declare the end state. sqlfu writes the migration." opacity={captionOpacity} />
    </BeatFrame>
  );
}

/** Tiny wrapper for tree entries, same vibe as FileTree but tighter for the
 *  sequential stage (which has to fit three zones in one 1280x720 frame). */
function MigrationsTreePane({
  entries,
  flash,
}: {
  entries: {name: string; kind: 'dir' | 'file'; highlight?: boolean}[];
  flash: number;
}) {
  return (
    <div
      style={{
        background: theme.codeBg,
        color: theme.codeText,
        fontFamily: theme.monoFont,
        fontSize: 16,
        padding: '14px 18px',
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {entries.map((entry) => {
        const base = entry.kind === 'dir' ? theme.codeKeyword : theme.codeText;
        const flashAlpha = entry.highlight ? flash : 0;
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

/** BeatFrame inset matches the PanelBackdrop's padding so each beat's content
 *  doesn't run into the header label at the top. */
function BeatFrame({children}: {children: React.ReactNode}) {
  return (
    <AbsoluteFill
      style={{
        padding: '88px 64px 64px 64px',
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function AutocompletePopover({opacity, highlightIndex}: {opacity: number; highlightIndex: number}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 250,
        bottom: 28,
        background: '#2b1d15',
        border: `1px solid ${theme.accent}`,
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
        fontFamily: theme.monoFont,
        fontSize: 14,
        color: theme.codeText,
        minWidth: 170,
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
            <span style={{color: theme.codeKeyword, marginRight: 10, fontSize: 10}}>●</span>
            {name}
          </span>
          <span style={{color: theme.codeType, fontSize: 12}}>
            {name === 'id' ? 'number' : 'string'}
          </span>
        </div>
      ))}
    </div>
  );
}
