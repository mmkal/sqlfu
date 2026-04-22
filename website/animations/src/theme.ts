/**
 * Palette pulled from website/src/styles.css. The site landing page uses a
 * warm paper-cream base with a deep brown for code surfaces; we match that
 * exactly so the animations read as extensions of the existing panels rather
 * than foreign objects.
 */
export const theme = {
  bg: '#f6efe2',
  bgStrong: '#efe1c6',
  surface: '#fffaf1',
  line: 'rgba(85, 52, 24, 0.16)',
  text: '#201710',
  muted: '#6f5947',
  accent: '#9d4d12',
  accentStrong: '#6f2d00',

  // Code surface (matches .panel pre in the site CSS)
  codeBg: '#20140f',
  codeText: '#fff4e8',
  codeMuted: '#b7a290',
  codeKeyword: '#ff9a5a',
  codeString: '#d6c27a',
  codeIdent: '#fff4e8',
  codeType: '#7ec8b3',
  codeComment: '#6f5947',
  codeParam: '#ffc47a',
  codeNumber: '#d6c27a',
  codePunct: '#b7a290',

  // Terminal / CLI strip
  terminalBg: '#120c09',
  terminalText: '#fff4e8',
  terminalPrompt: '#ff9a5a',
  terminalDim: '#b7a290',

  // Highlight flash for newly typed / edited regions
  highlightAdd: 'rgba(158, 226, 148, 0.24)',
  highlightRemove: 'rgba(236, 128, 114, 0.28)',

  shadow: '0 24px 70px rgba(74, 43, 15, 0.28)',
  radius: 20,
  monoFont:
    "ui-monospace, 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace",
  sansFont: "ui-sans-serif, system-ui, 'Helvetica Neue', sans-serif",
};

export const videoSize = {
  width: 1280,
  height: 720,
  fps: 30,
};
