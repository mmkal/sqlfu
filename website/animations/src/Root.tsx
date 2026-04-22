import React from 'react';
import {Composition} from 'remotion';
import {SchemaAnim} from './anim-1-schema';
import {GenerateAnim} from './anim-2-generate';
import {DraftAnim} from './anim-3-draft';
import {SequentialAnim, sequentialDurationInFrames} from './anim-sequential';
import {
  AltASchema,
  AltAGenerate,
  AltADraft,
  AltBSchema,
  AltBGenerate,
  AltBDraft,
  AltCSchema,
  AltCGenerate,
  AltCDraft,
  AltDSchema,
  AltDGenerate,
  AltDDraft,
} from './alternatives';
import {videoSize} from './theme';

const durationInFrames = 300;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Default landing-page animation: one long stage that plays all three
          beats in sequence. Served when the landing page is opened with
          `?animation=sequential`. */}
      <Composition
        id="anim-sequential"
        component={SequentialAnim}
        durationInFrames={sequentialDurationInFrames}
        fps={videoSize.fps}
        width={videoSize.width}
        height={videoSize.height}
      />

      {/* Original three-panel cards. Only rendered if someone wires them
          into a layout; retained so they remain callable from the Remotion
          studio as reference material. */}
      <Composition id="anim-1-schema" component={SchemaAnim} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="anim-2-generate" component={GenerateAnim} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="anim-3-draft" component={DraftAnim} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />

      {/* Alternative three-panel treatments, served when the landing page
          is opened with `?animation=a|b|c|d`. */}
      <Composition id="alt-a-schema" component={AltASchema} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-a-generate" component={AltAGenerate} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-a-draft" component={AltADraft} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />

      <Composition id="alt-b-schema" component={AltBSchema} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-b-generate" component={AltBGenerate} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-b-draft" component={AltBDraft} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />

      <Composition id="alt-c-schema" component={AltCSchema} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-c-generate" component={AltCGenerate} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-c-draft" component={AltCDraft} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />

      <Composition id="alt-d-schema" component={AltDSchema} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-d-generate" component={AltDGenerate} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
      <Composition id="alt-d-draft" component={AltDDraft} durationInFrames={durationInFrames} fps={videoSize.fps} width={videoSize.width} height={videoSize.height} />
    </>
  );
};

export const compositionIds = [
  'anim-sequential',
  'anim-1-schema',
  'anim-2-generate',
  'anim-3-draft',
  'alt-a-schema',
  'alt-a-generate',
  'alt-a-draft',
  'alt-b-schema',
  'alt-b-generate',
  'alt-b-draft',
  'alt-c-schema',
  'alt-c-generate',
  'alt-c-draft',
  'alt-d-schema',
  'alt-d-generate',
  'alt-d-draft',
] as const;
