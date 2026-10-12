/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Tokens extracted from Figma frames 1:2 and 62:123
      colors: {
        // Header / nav
        'intacta-dark': '#05668d',
        'intacta-mid':  '#137ba6',
        // Code panel
        'intacta-panel': '#234053',
        // Text
        'intacta-text':  '#c6d6df',
        // Waveform bars
        'intacta-bar':   '#ebebeb',
        // Accent / pairing popup
        'intacta-accent': '#05668d',
      },
      fontFamily: {
        brand:  ['"Baloo Da 2"', 'cursive'],
        ui:     ['Inter', 'system-ui', 'sans-serif'],
        mono:   ['ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        'brand':  ['52px', { lineHeight: '1.2', fontWeight: '800' }],
        'tagline': ['20px', { lineHeight: '1.2', fontWeight: '500' }],
        'nav':    ['25px', { lineHeight: '1.4', fontWeight: '800' }],
        'greet':  ['40px', { lineHeight: '1.2', fontWeight: '800' }],
        'code':   ['30px', { lineHeight: '1.2', fontWeight: '800' }],
        'hint':   ['20px', { lineHeight: '1.25', fontWeight: '700' }],
        // Terminal clinical minimums
        'terminal-lg': ['32px', { lineHeight: '1.3', fontWeight: '600' }],
      },
      // 12 waveform bars from the Figma layout (12 bars, 78px wide, varying heights)
      // Heights extracted from Figma: [150,61,35,210,76,125,170,39,75,48,25]
      // We map them as a CSS animation via custom property
    },
  },
  plugins: [],
}
