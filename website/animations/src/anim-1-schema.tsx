import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Caption, CodeSurface, PanelBackdrop} from './components';
import {definitionsAfterFK, definitionsAfterUsers, definitionsBeforeUsers} from './fixtures';

/**
 * Animation 1: "Source of truth" — schema refactor in definitions.sql.
 *
 * Beats (30fps):
 *   0-54   Type out `create table users (id integer primary key, name text);`
 *   54-78  Pause, cursor drops
 *   78-156 Type out `create table posts` with author_name text
 *   156-174 Pause
 *   174-192 Highlight the author_name line (about to refactor)
 *   192-210 Line removal (flash red, then gone)
 *   210-258 Type author_id integer references users (id)
 *   258-300 Hold and fade caption
 * Total: 300 frames = 10s at 30fps
 */
export const SchemaAnim: React.FC = () => {
  const frame = useCurrentFrame();

  const usersEnd = definitionsBeforeUsers.length;
  const postsEnd = definitionsAfterUsers.length;
  const finalEnd = definitionsAfterFK.length;

  // Phase A: type users table
  const phaseA = interpolate(frame, [0, 54], [0, usersEnd], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Phase B: type posts (with author_name)
  const phaseB = interpolate(frame, [78, 156], [usersEnd, postsEnd], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Phase C: refactor — remove author_name, replace with author_id references
  // frame 174-192 highlights, 192-210 erases back to where `author_name` begins,
  // then 210-258 retypes author_id references
  const authorNameLineIndex = 9; // 1-indexed line number of `author_name text` in definitionsAfterUsers

  const phaseCRemove = interpolate(frame, [192, 210], [postsEnd, postsEnd - 'author_name text,'.length - 3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const phaseCType = interpolate(frame, [210, 258], [0, finalEnd], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const inPhaseC = frame >= 174;
  const highlighting = frame >= 174 && frame < 210;

  let visibleSource = definitionsBeforeUsers;
  let visibleCount = phaseA;
  let removeLines: number[] | undefined;
  let addLines: number[] | undefined;
  let cursor = true;
  let title = 'definitions.sql';

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

  if (!cursor) void cursor;

  const captionOpacity = interpolate(frame, [258, 282], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <PanelBackdrop>
      <CodeSurface
        title={title}
        language="sql"
        source={visibleSource}
        charCount={visibleCount}
        cursor
        fontSize={26}
        addLines={addLines}
        removeLines={highlighting ? removeLines : undefined}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
      <Caption text="schema lives in sql. edit it like code." opacity={captionOpacity} />
    </PanelBackdrop>
  );
};
