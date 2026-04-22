import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Caption, CodeSurface, FileTree, PanelBackdrop, TerminalStrip} from './components';
import {
  addEmailMigration,
  definitionsAfterEmail,
  definitionsAfterFK,
  definitionsBeforeEmail,
  draftCommand,
  generateCommand,
  migrationsTreeAfter,
  migrationsTreeBefore,
  userByIdGeneratedTs,
  userByIdSql,
} from './fixtures';
import {theme} from './theme';

/**
 * Four alternative combinations of the three landing-page animations.
 *
 * These are compositions — some are full beats, some are deliberate sketches
 * that get the shape across without polishing every frame. Reviewer can mix
 * and match from here.
 */

// ---------- ALT A: single-card showreel (all three beats in one panel) ----------

/**
 * Premise: three value cards become one *big* card. The animation cycles
 * through all three beats in a single continuous surface. Lower stakes on the
 * grid, higher stakes on pacing. 18s total.
 */
export const AltASchema = () => <SchemaFromAnim1 showreel />;
export const AltAGenerate = () => <GenerateShort />;
export const AltADraft = () => <DraftShort />;

// ---------- ALT B: terminal-first — everything is a CLI transcript ----------

/**
 * Premise: the hero image is the `sqlfu` CLI itself. Each card shows the
 * command and its effect in the terminal. Readers who live in the shell
 * "get" it immediately. Weakness: pure CLI can feel dry.
 */
export const AltBSchema = () => (
  <PanelBackdrop>
    <TerminalOnlyCard
      commands={[
        {cmd: 'cat definitions.sql', output: definitionsAfterFK.trim()},
      ]}
    />
    <Caption text="schema lives in sql." opacity={fadeInLate()} />
  </PanelBackdrop>
);

export const AltBGenerate = () => (
  <PanelBackdrop>
    <TerminalOnlyCard
      commands={[
        {cmd: `$ ${generateCommand}`, output: 'wrote sql/.generated/user-by-id.sql.ts'},
        {cmd: 'head sql/.generated/user-by-id.sql.ts', output: userByIdGeneratedTs.split('\n').slice(0, 8).join('\n')},
      ]}
    />
    <Caption text="types follow sql." opacity={fadeInLate()} />
  </PanelBackdrop>
);

export const AltBDraft = () => (
  <PanelBackdrop>
    <TerminalOnlyCard
      commands={[
        {cmd: `$ ${draftCommand}`, output: 'drafted migrations/20260419000000_add_email.sql'},
        {cmd: 'cat migrations/20260419000000_add_email.sql', output: addEmailMigration.trim()},
      ]}
    />
    <Caption text="migrations draft themselves." opacity={fadeInLate()} />
  </PanelBackdrop>
);

// ---------- ALT C: diff-centric — two files side by side, diff overlay ----------

/**
 * Premise: every card is a diff. Schema card shows definitions.sql diff.
 * Generate card shows SQL vs generated TS. Draft card shows migration SQL as
 * the diff itself. Makes "sqlfu is change-tracking" the organizing idea.
 */
export const AltCSchema = () => {
  const frame = useCurrentFrame();
  const revealProgress = interpolate(frame, [0, 60], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <PanelBackdrop>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: '100%'}}>
        <DiffFile
          title="definitions.sql (before)"
          language="sql"
          source="create table users (\n  id integer primary key,\n  name text\n);\n"
          opacity={1}
        />
        <DiffFile
          title="definitions.sql (after)"
          language="sql"
          source={definitionsAfterFK}
          opacity={revealProgress}
          addLines={[8, 9]}
        />
      </div>
      <Caption text="just sql, before and after." opacity={fadeInLate()} />
    </PanelBackdrop>
  );
};

export const AltCGenerate = () => {
  return (
    <PanelBackdrop>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: '100%'}}>
        <DiffFile title="sql/user-by-id.sql" language="sql" source={userByIdSql} opacity={1} />
        <DiffFile
          title="sql/.generated/user-by-id.sql.ts"
          language="ts"
          source={userByIdGeneratedTs}
          opacity={fadeInLate(40, 80)}
        />
      </div>
      <Caption text="sql on the left. types on the right." opacity={fadeInLate()} />
    </PanelBackdrop>
  );
};

export const AltCDraft = () => (
  <PanelBackdrop>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: '100%'}}>
      <DiffFile title="definitions.sql (before)" language="sql" source={definitionsBeforeEmail} opacity={1} />
      <DiffFile
        title="definitions.sql (after)"
        language="sql"
        source={definitionsAfterEmail}
        opacity={1}
        addLines={[4]}
      />
    </div>
    <div
      style={{
        position: 'absolute',
        bottom: 40,
        left: 80,
        right: 80,
      }}
    >
      <CodeSurface
        title="drafted migration"
        language="sql"
        source={addEmailMigration}
        fontSize={18}
        accent="generated"
        fadeIn={fadeInLate(90, 150)}
        style={{height: 100}}
      />
    </div>
    <Caption text="describe the destination. sqlfu writes the path." opacity={fadeInLate(180, 240)} />
  </PanelBackdrop>
);

// ---------- ALT D: playful — bouncy springs, heavier motion ----------

/**
 * Premise: same beats as A, but amped up. Hero panels spring in, code types
 * with a subtle bounce, emoji sparkle when generation completes. Risky, but
 * feels a lot friendlier — good for landing-page energy.
 */
export const AltDSchema = () => <SchemaFromAnim1 playful />;
export const AltDGenerate = () => <GenerateShort playful />;
export const AltDDraft = () => <DraftShort playful />;

// ---------- internal helpers / sub-compositions ----------

function SchemaFromAnim1({showreel, playful}: {showreel?: boolean; playful?: boolean}) {
  const frame = useCurrentFrame();
  const source = definitionsAfterFK;
  const chars = interpolate(frame, [0, 90], [0, source.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const springy = playful
    ? 1 + Math.sin(frame / 8) * 0.004
    : 1;
  return (
    <PanelBackdrop>
      <CodeSurface
        title={showreel ? 'definitions.sql — schema, generate, draft' : 'definitions.sql'}
        language="sql"
        source={source}
        charCount={chars}
        cursor={frame < 90}
        fontSize={28}
        style={{width: '100%', height: '100%', transform: `scale(${springy})`}}
      />
      {showreel ? (
        <Caption text="one file. schema, types, migrations all follow." opacity={fadeInLate()} />
      ) : (
        <Caption text="schema lives in sql." opacity={fadeInLate()} />
      )}
    </PanelBackdrop>
  );
}

function GenerateShort({playful}: {playful?: boolean} = {}) {
  const frame = useCurrentFrame();
  const left = interpolate(frame, [0, 36], [0, userByIdSql.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const right = interpolate(frame, [60, 180], [0, userByIdGeneratedTs.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rightFade = interpolate(frame, [48, 72], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = playful ? 1 + Math.abs(Math.sin(frame / 20)) * 0.01 : 1;
  return (
    <PanelBackdrop>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, height: '100%', transform: `scale(${scale})`}}>
        <CodeSurface title="sql/user-by-id.sql" language="sql" source={userByIdSql} charCount={left} cursor={frame < 36} fontSize={26} />
        <CodeSurface
          title="sql/.generated/user-by-id.sql.ts"
          language="ts"
          source={userByIdGeneratedTs}
          charCount={right}
          fadeIn={rightFade}
          accent="generated"
          fontSize={16}
        />
      </div>
      <Caption text="types follow sql." opacity={fadeInLate(200, 240)} />
    </PanelBackdrop>
  );
}

function DraftShort({playful}: {playful?: boolean} = {}) {
  const frame = useCurrentFrame();
  const edit = interpolate(frame, [0, 60], [definitionsBeforeEmail.length, definitionsAfterEmail.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cmd = interpolate(frame, [72, 96], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const migrationChars = interpolate(frame, [120, 180], [0, addEmailMigration.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const treeFlash = interpolate(frame, [110, 132, 180], [0, 1, 0.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const activeTree = frame >= 110 ? migrationsTreeAfter : migrationsTreeBefore;
  const scale = playful ? 1 + Math.sin(frame / 14) * 0.005 : 1;
  return (
    <PanelBackdrop>
      <div style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gridTemplateRows: '1.4fr 1fr', gap: 20, height: '100%', transform: `scale(${scale})`}}>
        <CodeSurface
          title="definitions.sql"
          language="sql"
          source={definitionsAfterEmail}
          charCount={edit}
          cursor={frame < 60}
          addLines={frame >= 36 ? [4] : undefined}
          fontSize={22}
          style={{gridRow: '1 / 2', gridColumn: '1 / 2'}}
        />
        <FileTree entries={activeTree} highlightFlash={treeFlash} style={{gridRow: '1 / 2', gridColumn: '2 / 3'}} />
        <TerminalStrip command={draftCommand} progress={cmd} style={{gridRow: '2 / 3', gridColumn: '1 / 2'}} />
        <CodeSurface
          title="migrations/20260419000000_add_email.sql"
          language="sql"
          source={addEmailMigration}
          charCount={migrationChars}
          accent="generated"
          fontSize={18}
          style={{gridRow: '2 / 3', gridColumn: '2 / 3'}}
        />
      </div>
      <Caption text="migrations draft themselves." opacity={fadeInLate(200, 240)} />
    </PanelBackdrop>
  );
}

function TerminalOnlyCard({
  commands,
}: {
  commands: {cmd: string; output?: string}[];
}) {
  const frame = useCurrentFrame();
  const beats = commands.length;
  const beatDuration = Math.floor(300 / beats);
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 24, height: '100%'}}>
      {commands.map((command, i) => {
        const start = beatDuration * i;
        const end = start + beatDuration - 12;
        const progress = interpolate(frame, [start, end], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <TerminalStrip
            key={i}
            command={command.cmd}
            progress={progress}
            output={progress >= 1 ? command.output : undefined}
          />
        );
      })}
    </div>
  );
}

function DiffFile({
  title,
  language,
  source,
  opacity,
  addLines,
}: {
  title: string;
  language: 'sql' | 'ts';
  source: string;
  opacity: number;
  addLines?: number[];
}) {
  return (
    <CodeSurface
      title={title}
      language={language}
      source={source}
      fadeIn={opacity}
      fontSize={language === 'ts' ? 16 : 22}
      addLines={addLines}
      accent={title.includes('generated') || title.includes('after') ? 'generated' : 'default'}
      style={{height: '100%'}}
    />
  );
}

function fadeInLate(start = 260, end = 286) {
  // Shared helper that returns a 0..1 opacity based on current frame — used
  // by captions so the payoff reads only after the animation plays.
  const frame = useCurrentFrameSafe();
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/**
 * Small shim: `fadeInLate` is called from many places; wrap in case remotion's
 * hook rules bite us — we only ever call this at component top-level.
 */
function useCurrentFrameSafe() {
  return useCurrentFrame();
}

// Ensure theme import is considered used even when all alternatives trim down
void theme;
