import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Caption, CodeSurface, FileTree, PanelBackdrop, TerminalStrip} from './components';
import {
  addEmailMigration,
  definitionsAfterEmail,
  definitionsBeforeEmail,
  draftCommand,
  migrationsTreeAfter,
  migrationsTreeBefore,
} from './fixtures';

/**
 * Animation 3: edit schema → sqlfu draft → new migration file.
 *
 * Beats (30fps):
 *   0-12     Hold on initial state (definitions + migrations tree)
 *   12-96    Edit definitions.sql to add `email text not null default ''`
 *   96-120   Pause
 *   120-150  Terminal types `$ sqlfu draft --name add_email`
 *   150-180  Pause; terminal shows "drafted migration..." output
 *   180-210  New migration file pops into the tree (green flash)
 *   210-270  Migration file's SQL appears below tree
 *   270-300  Hold + caption
 * Total: 300 frames = 10s at 30fps
 */
export const DraftAnim: React.FC = () => {
  const frame = useCurrentFrame();

  const editProgress = interpolate(frame, [12, 96], [definitionsBeforeEmail.length, definitionsAfterEmail.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const editing = frame >= 12 && frame < 96;
  const emailLine = 4; // 1-indexed: new email column line

  const cmdProgress = interpolate(frame, [120, 150], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const terminalOutput = frame >= 150 ? 'drafted migrations/20260419000000_add_email.sql' : undefined;

  const treeFlash = interpolate(frame, [180, 198, 240], [0, 1, 0.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const migrationFade = interpolate(frame, [210, 240], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const migrationChars = interpolate(frame, [216, 264], [0, addEmailMigration.length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const captionOpacity = interpolate(frame, [270, 288], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const activeTree = frame >= 180 ? migrationsTreeAfter : migrationsTreeBefore;

  return (
    <PanelBackdrop>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.25fr 1fr',
          gridTemplateRows: '1.6fr auto',
          gap: 24,
          height: '100%',
        }}
      >
        <CodeSurface
          title="definitions.sql"
          language="sql"
          source={frame < 12 ? definitionsBeforeEmail : definitionsAfterEmail}
          charCount={frame < 12 ? definitionsBeforeEmail.length : editProgress}
          cursor={editing}
          fontSize={24}
          addLines={frame >= 60 ? [emailLine] : undefined}
          style={{gridRow: '1 / 2', gridColumn: '1 / 2'}}
        />
        <FileTree
          entries={activeTree}
          highlightFlash={treeFlash}
          style={{gridRow: '1 / 2', gridColumn: '2 / 3'}}
        />
        <TerminalStrip
          command={draftCommand}
          progress={cmdProgress}
          output={terminalOutput}
          style={{gridRow: '2 / 3', gridColumn: '1 / 2'}}
        />
        <CodeSurface
          title="migrations/20260419_add_email.sql"
          language="sql"
          source={addEmailMigration}
          charCount={migrationChars}
          fadeIn={migrationFade}
          cursor={frame >= 216 && frame < 264}
          fontSize={14}
          accent="generated"
          style={{gridRow: '2 / 3', gridColumn: '2 / 3'}}
        />
      </div>
      <Caption text="declare the end state. sqlfu writes the migration." opacity={captionOpacity} />
    </PanelBackdrop>
  );
};
