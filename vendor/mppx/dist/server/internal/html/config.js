import { Json } from 'ox';
import { tabScript } from './compose.main.gen.js';
export { attrs, classNames, ids, params } from './constants.js';
import { attrs, classNames, ids } from './constants.js';
function logoColorScheme(colorScheme) {
    return colorScheme === 'dark' || colorScheme === 'light'
        ? `${classNames.logo}--${colorScheme}`
        : undefined;
}
class CssVar {
    name;
    constructor(token) {
        this.name = `--mppx-${token}`;
    }
    toString() {
        return `var(${this.name})`;
    }
}
export const vars = {
    accent: new CssVar('accent'),
    background: new CssVar('background'),
    border: new CssVar('border'),
    foreground: new CssVar('foreground'),
    muted: new CssVar('muted'),
    negative: new CssVar('negative'),
    positive: new CssVar('positive'),
    surface: new CssVar('surface'),
    fontFamily: new CssVar('font-family'),
    fontSizeBase: new CssVar('font-size-base'),
    radius: new CssVar('radius'),
    spacingUnit: new CssVar('spacing-unit'),
};
export const defaultText = {
    expires: 'Expires at',
    pay: 'Pay',
    paymentRequired: 'Payment Required',
    title: 'Payment Required',
};
export const defaultTheme = {
    colorScheme: 'light dark',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSizeBase: '16px',
    radius: '6px',
    spacingUnit: '2px',
    accent: ['#171717', '#ededed'],
    background: ['#ffffff', '#0a0a0a'],
    border: ['#e5e5e5', '#2e2e2e'],
    foreground: ['#0a0a0a', '#ededed'],
    muted: ['#666666', '#a1a1a1'],
    negative: ['#e5484d', '#e5484d'],
    positive: ['#30a46c', '#30a46c'],
    surface: ['#f5f5f5', '#1a1a1a'],
};
function resolveColor(value, fallback) {
    if (!value)
        return fallback;
    if (typeof value === 'string')
        return [value, value];
    return value;
}
const colorTokens = [
    'accent',
    'negative',
    'positive',
    'background',
    'foreground',
    'muted',
    'surface',
    'border',
];
export function resolveOptions(options) {
    const theme = mergeDefined({
        favicon: undefined,
        fontUrl: undefined,
        logo: undefined,
        ...defaultTheme,
    }, options.theme ?? {});
    const textOverrides = options.text ?? undefined;
    const mergedText = mergeDefined(defaultText, textOverrides ?? {});
    const text = sanitizeRecord({
        ...mergedText,
        title: typeof textOverrides?.title === 'string' && textOverrides.title.length > 0
            ? mergedText.title
            : mergedText.paymentRequired,
    });
    return { theme, text };
}
const html = String.raw;
export function render(options) {
    const { entries, dataMap, formattedAmount, text, theme } = options;
    const firstChallenge = entries[0].challenge;
    const hasTabs = entries.length > 1;
    const hasPanels = options.panels ?? hasTabs;
    const dataValues = Object.values(dataMap);
    const tabListHtml = hasTabs
        ? html `<nav class="${classNames.tabList}" role="tablist" aria-label="Payment methods">
        ${dataValues
            .map((data, i) => html `<button
                class="${classNames.tab}"
                role="tab"
                id="mppx-tab-${i}"
                aria-selected="${i === 0 ? 'true' : 'false'}"
                aria-controls="mppx-panel-${i}"
                ${i !== 0 ? 'tabindex="-1"' : ''}
                data-amount="${sanitize(data.formattedAmount)}"
                ${data.challenge.description
            ? `data-description="${sanitize(data.challenge.description)}"`
            : ''}
                ${data.challenge.expires ? `data-expires="${sanitize(data.challenge.expires)}"` : ''}
                ${data.challenge.expires ? `data-expires-label="${sanitize(text.expires)}"` : ''}
              >
                ${sanitize(data.label)}
              </button>`)
            .join('')}
      </nav>`
        : '';
    const panelsHtml = hasPanels
        ? entries
            .map((_entry, i) => html `<div
              ${hasTabs ? `role="tabpanel" aria-labelledby="mppx-tab-${i}"` : ''}
              id="mppx-panel-${i}"
              ${i !== 0 ? 'hidden' : ''}
            >
              <div id="${ids.root}-${i}" aria-label="Payment form"></div>
            </div>`)
            .join('')
        : html `<div id="${ids.root}" aria-label="Payment form"></div>`;
    const contentScripts = hasTabs
        ? entries
            .map((entry) => entry.content.replace('<script>', `<script ${attrs.challengeId}="${sanitize(entry.challenge.id)}">`))
            .join('\n')
        : entries[0].content;
    return html `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="robots" content="noindex" />
        <meta name="color-scheme" content="${theme.colorScheme}" />
        <title>${text.title}</title>
        ${preflight} ${favicon(theme, firstChallenge.realm)} ${font(theme)} ${style(theme)}
        ${hasTabs ? tabStyle() : ''}
      </head>
      <body>
        <main>
          <header class="${classNames.header}">
            ${logo(theme)}
            <span>${text.paymentRequired}</span>
          </header>
          <section class="${classNames.summary}" aria-label="Payment summary">
            <h1 class="${classNames.summaryAmount}">${sanitize(formattedAmount)}</h1>
            ${firstChallenge.description
        ? `<p class="${classNames.summaryDescription}">${sanitize(firstChallenge.description)}</p>`
        : ''}
            ${firstChallenge.expires
        ? `<p class="${classNames.summaryExpires}">${text.expires} <time datetime="${new Date(firstChallenge.expires).toISOString()}">${new Date(firstChallenge.expires).toLocaleString()}</time></p>`
        : ''}
          </section>
          ${tabListHtml} ${panelsHtml}
          <script
            id="${ids.data}"
            type="application/json"
            ${entries.length > 1 ? ` ${attrs.remaining}="${entries.length}"` : ''}
          >
            ${Json.stringify(dataMap).replace(/</g, '\\u003c')}
          </script>
          ${contentScripts} ${hasTabs ? tabScript : ''}
        </main>
      </body>
    </html>`;
}
function style(theme) {
    const colors = Object.fromEntries(colorTokens.map((name) => [name, resolveColor(theme[name], defaultTheme[name])]));
    const lightVars = colorTokens
        .map((token) => `${vars[token].name}: ${colors[token][0]};`)
        .join('\n      ');
    const darkVars = colorTokens
        .map((token) => `${vars[token].name}: ${colors[token][1]};`)
        .join('\n      ');
    const isLightOnly = theme.colorScheme === 'light';
    const isDarkOnly = theme.colorScheme === 'dark';
    const rootVars = isDarkOnly ? darkVars : lightVars;
    const darkMedia = !isLightOnly && !isDarkOnly
        ? `\n    @media (prefers-color-scheme: dark) {\n      :root {\n        ${darkVars}\n      }\n    }`
        : '';
    return html `
    <style>
      :root {
        color-scheme: ${theme.colorScheme};
        ${vars.fontFamily.name}: ${theme.fontFamily};
        ${vars.fontSizeBase.name}: ${theme.fontSizeBase};
        ${vars.radius.name}: ${theme.radius};
        ${vars.spacingUnit.name}: ${theme.spacingUnit};
        ${rootVars}
      }${darkMedia}
      *:focus-visible {
        outline-color: ${vars.accent};
        outline-offset: 0.15rem;
        outline-style: solid;
        outline-width: 2px;
      }
      body {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        background: ${vars.background};
        color: ${vars.foreground};
        font-family: ${vars.fontFamily};
        font-size: ${vars.fontSizeBase};
      }
      main {
        display: flex;
        flex-direction: column;
        gap: calc(${vars.spacingUnit} * 8);
        margin-left: auto;
        margin-right: auto;
        max-width: clamp(300px, calc(${vars.spacingUnit} * 224), 896px);
        padding: calc(${vars.spacingUnit} * 12) calc(${vars.spacingUnit} * 8) calc(${vars.spacingUnit} * 16);
      }
      .${classNames.header} {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: calc(${vars.spacingUnit} * 4);
        justify-content: space-between;
        span {
          background: ${vars.surface};
          border: 1px solid ${vars.border};
          border-radius: calc(${vars.spacingUnit} * 50);
          font-size: 0.75rem;
          font-weight: 500;
          letter-spacing: 0.025em;
          padding: calc(${vars.spacingUnit} * 1) calc(${vars.spacingUnit} * 4);
        }
      }
      .${classNames.logo} {
        max-height: 1.75rem;
      }
      .${logoColorScheme('dark')} {
        @media (prefers-color-scheme: light) {
          display: none;
        }
      }
      .${logoColorScheme('light')} {
        @media (prefers-color-scheme: dark) {
          display: none;
        }
      }
      .${classNames.summary} {
        background: ${vars.surface};
        border: 1px solid ${vars.border};
        border-radius: ${vars.radius};
        display: flex;
        flex-direction: column;
        gap: calc(${vars.spacingUnit} * 3);
        padding: calc(${vars.spacingUnit} * 6) calc(${vars.spacingUnit} * 6);
      }
      .${classNames.summaryAmount} {
        font-size: 2.5rem;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        line-height: 1.2;
      }
      .${classNames.summaryDescription} {
        font-size: 1.25rem;
      }
      .${classNames.summaryExpires} {
        color: ${vars.muted};
      }
      .${classNames.error} {
        color: ${vars.negative};
        font-size: 0.95rem;
        margin-top: calc(${vars.spacingUnit} * -1.5);
        text-align: center;
      }
    </style>
  `;
}
function favicon(theme, realm) {
    if (typeof theme.favicon === 'string')
        return html `<link rel="icon" href="${sanitize(theme.favicon)}" />`;
    if (typeof theme.favicon === 'object') {
        return html `<link
        rel="icon"
        href="${sanitize(theme.favicon.light)}"
        media="(prefers-color-scheme: light)"
      />
      <link
        rel="icon"
        href="${sanitize(theme.favicon.dark)}"
        media="(prefers-color-scheme: dark)"
      />`;
    }
    // Fallback: use host's favicon via Google S2 service
    try {
        const domain = new URL(realm).hostname;
        return html `<link
      rel="icon"
      href="https://www.google.com/s2/favicons?domain=${domain}&sz=64"
    />`;
    }
    catch {
        return '';
    }
}
function font(theme) {
    if (!theme.fontUrl)
        return '';
    return html `<link
      rel="preconnect"
      href="${sanitize(new URL(theme.fontUrl).origin)}"
      crossorigin
    />
    <link rel="stylesheet" href="${sanitize(theme.fontUrl)}" />`;
}
function logo(value) {
    if (typeof value.logo === 'undefined')
        return '';
    if (typeof value.logo === 'string')
        return html `<img alt="" class="${classNames.logo}" src="${sanitize(value.logo)}" />`;
    return Object.entries(value.logo)
        .map((entry) => html `<img
          alt=""
          class="${classNames.logo} ${logoColorScheme(entry[0])}"
          src="${sanitize(entry[1])}"
        />`)
        .join('\n');
}
function tabStyle() {
    return html `
    <style>
      .${classNames.tabList} {
        display: flex;
        gap: calc(${vars.spacingUnit} * 2);
        border-bottom: 1px solid ${vars.border};
      }
      .${classNames.tab} {
        background: none !important;
        border: none !important;
        border-bottom: 1px solid transparent !important;
        border-radius: 0 !important;
        color: ${vars.muted} !important;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: -1px !important;
        padding: calc(${vars.spacingUnit} * 2) calc(${vars.spacingUnit} * 4) !important;
        text-transform: capitalize;
        width: auto !important;
      }
      .${classNames.tab}[aria-selected='true'] {
        border-bottom-color: ${vars.foreground} !important;
        color: ${vars.foreground} !important;
      }
      .${classNames.tab}:hover:not([aria-selected='true']) {
        color: ${vars.foreground} !important;
      }
      .${classNames.tabPanel}[hidden] {
        display: none;
      }
    </style>
  `;
}
// Slimmed down Tailwind preflight
// https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/preflight.css
const preflight = html `<style>
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0 solid;
    border-color: ${vars.border};
  }
  html,
  :host {
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
    -webkit-tap-highlight-color: transparent;
  }
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-size: inherit;
    font-weight: inherit;
  }
  a {
    color: inherit;
    -webkit-text-decoration: inherit;
    text-decoration: inherit;
  }
  b,
  strong {
    font-weight: bolder;
  }
  code,
  kbd,
  samp,
  pre {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 1em;
  }
  small {
    font-size: 80%;
  }
  ol,
  ul,
  menu {
    list-style: none;
  }
  img,
  svg,
  video,
  canvas,
  audio,
  iframe,
  embed,
  object {
    display: block;
    vertical-align: middle;
  }
  img,
  video {
    max-width: 100%;
    height: auto;
  }
  button,
  input,
  select,
  optgroup,
  textarea,
  ::file-selector-button {
    font: inherit;
    font-feature-settings: inherit;
    font-variation-settings: inherit;
    letter-spacing: inherit;
    color: inherit;
    border-radius: 0;
    background-color: transparent;
    opacity: 1;
  }
  ::file-selector-button {
    margin-inline-end: 4px;
  }
  ::placeholder {
    opacity: 1;
  }
  @supports (not (-webkit-appearance: -apple-pay-button)) or (contain-intrinsic-size: 1px) {
    ::placeholder {
      color: color-mix(in oklab, currentcolor 50%, transparent);
    }
  }
  textarea {
    resize: vertical;
  }
  ::-webkit-search-decoration {
    -webkit-appearance: none;
  }
  :-moz-ui-invalid {
    box-shadow: none;
  }
  button,
  input:where([type='button'], [type='reset'], [type='submit']),
  ::file-selector-button {
    appearance: button;
  }
  ::-webkit-inner-spin-button,
  ::-webkit-outer-spin-button {
    height: auto;
  }
  [hidden]:where(:not([hidden='until-found'])) {
    display: none !important;
  }
</style>`;
function sanitize(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function sanitizeRecord(record) {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, sanitize(value)]));
}
export function mergeDefined(defaults, value) {
    if (value === undefined || value === null)
        return defaults;
    if (!isPlainObject(defaults) || !isPlainObject(value))
        return (value ?? defaults);
    const result = { ...defaults };
    for (const [key, nextValue] of Object.entries(value)) {
        if (nextValue === undefined || nextValue === null || nextValue === '')
            continue;
        const currentValue = result[key];
        result[key] =
            isPlainObject(currentValue) && isPlainObject(nextValue)
                ? mergeDefined(currentValue, nextValue)
                : nextValue;
    }
    return result;
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=config.js.map