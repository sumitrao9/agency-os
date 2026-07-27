import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hover: 'var(--border-hover)',
          active: 'var(--border-active)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          inverse: 'var(--text-inverse)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          bg: 'var(--accent-bg)',
          border: 'var(--accent-border)',
        },
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
      },
      fontSize: {
        'xs': ['11px', '1.5'],
        'sm': ['12px', '1.5'],
        'base': ['13px', '1.5'],
        'md': ['14px', '1.5'],
        'lg': ['16px', '1.4'],
        'xl': ['20px', '1.3'],
        '2xl': ['24px', '1.3'],
        '3xl': ['32px', '1.2'],
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'Inter', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"SF Mono"', '"Fira Code"', '"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        'full': '9999px',
      },
      animation: {
        'toast-in': 'toastIn 200ms ease forwards',
        'toast-out': 'toastOut 150ms ease forwards',
        'context-in': 'contextIn 150ms ease',
        'spin': 'spin 0.6s linear infinite',
      },
      keyframes: {
        toastIn: {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        toastOut: {
          from: { transform: 'translateX(0)', opacity: '1' },
          to: { transform: 'translateX(100%)', opacity: '0' },
        },
        contextIn: {
          from: { transform: 'scale(0.95)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
