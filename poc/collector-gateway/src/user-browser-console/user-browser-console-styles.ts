export const userBrowserConsoleStyles = `
:root {
  color-scheme: dark;
  --bg: #091019;
  --panel: #111b28;
  --panel-2: #172434;
  --line: #2d3c50;
  --text: #eff6ff;
  --muted: #a5b4c7;
  --accent: #7dd3fc;
  --good: #5eead4;
  --warn: #fbbf24;
  --bad: #fb7185;
  font-family: Inter, "Microsoft YaHei UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; color: var(--text); background: var(--bg); }
button, input { font: inherit; }
button { border: 1px solid transparent; border-radius: 9px; padding: .65rem .9rem; color: #08202e; background: var(--accent); font-weight: 750; cursor: pointer; }
button:hover { filter: brightness(1.07); }
button:disabled { cursor: not-allowed; opacity: .55; }
button.secondary, button.danger { color: var(--text); background: transparent; border-color: var(--line); }
button.danger { color: var(--bad); border-color: #713144; }
.topbar { display: flex; align-items: end; justify-content: space-between; gap: 2rem; padding: 2rem clamp(1rem, 5vw, 4.5rem); border-bottom: 1px solid var(--line); background: linear-gradient(135deg, #15273a, var(--bg) 70%); }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: .3rem; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: -.045em; }
h2 { margin-bottom: .45rem; font-size: 1.15rem; }
.eyebrow { margin-bottom: .45rem; color: var(--accent); font-size: .72rem; font-weight: 800; letter-spacing: .14em; }
.subtitle, .panel-copy, .boundary p { color: var(--muted); line-height: 1.65; }
.topbar-actions { display: flex; align-items: center; gap: .65rem; flex-wrap: wrap; }
main { width: min(1050px, calc(100% - 2rem)); margin: 1.4rem auto 4rem; }
.panel { padding: 1.2rem; margin-bottom: .85rem; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.boundary { border-color: #26576c; background: linear-gradient(135deg, #102a3a, var(--panel)); }
.onboarding { border-color: #3d536d; background: linear-gradient(135deg, #151f30, var(--panel)); }
.path-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin-top: 1rem; }
.path-card { display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; min-height: 13rem; padding: 1rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
.path-card h3 { margin: .7rem 0 .35rem; font-size: 1rem; }
.path-card p { margin: 0; color: var(--muted); line-height: 1.55; font-size: .82rem; }
.path-card button { align-self: flex-start; }
.onboarding-status { margin: .9rem 0 0; color: var(--accent); line-height: 1.5; }
.provider-status { margin: .85rem 0; padding: .85rem; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); }
.provider-state-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .6rem; }
.provider-state-grid div { display: grid; gap: .25rem; padding: .65rem; border: 1px solid var(--line); border-radius: 8px; background: #101b29; }
.provider-state-grid span { color: var(--muted); font-size: .72rem; }
.provider-state-grid strong { font-size: .84rem; overflow-wrap: anywhere; }
.provider-capabilities, .provider-help, .provider-warning, .provider-note { color: var(--muted); line-height: 1.55; font-size: .8rem; }
.provider-capabilities { margin: .8rem 0 0; color: var(--text); }
.provider-help, .provider-warning { margin: .55rem 0 0; }
.provider-warning { color: var(--warn); }
.provider-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .75rem; align-items: end; padding: .9rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
.provider-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.provider-note { margin: .8rem 0 0; }
.provider-note code { color: var(--text); }
.path-card a, .panel a { color: var(--accent); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .7rem; margin: 1rem 0 0; }
.facts div { padding: .75rem; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); }
.facts dt { color: var(--muted); font-size: .75rem; }
.facts dd { margin: .25rem 0 0; overflow-wrap: anywhere; font-weight: 700; }
.badge { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: .42rem .7rem; color: var(--muted); font-size: .78rem; font-weight: 700; }
.badge.good { color: var(--good); border-color: #276b66; }
.badge.warn { color: var(--warn); border-color: #6e5420; }
.badge.bad { color: var(--bad); border-color: #713144; }
.badge.neutral { color: var(--muted); }
.pairing-ticket, .issued-token { margin: .8rem 0; padding: .9rem; border: 1px solid #28596c; border-radius: 12px; background: #102433; }
.pairing-ticket dl { display: grid; gap: .5rem; margin: 0; }
.pairing-ticket dl div { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .6rem; }
.pairing-ticket dt { color: var(--muted); font-size: .8rem; }
.pairing-ticket dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
code { overflow-wrap: anywhere; }
.pairing-ticket code, .issued-token code { display: block; padding: .5rem .65rem; border: 1px solid var(--line); border-radius: 8px; background: #091019; }
.card-grid { display: grid; gap: .65rem; }
.card { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .9rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
.card h3, .card p { margin: 0; }
.card h3 { font-size: .98rem; }
.card p { margin-top: .35rem; color: var(--muted); font-size: .78rem; overflow-wrap: anywhere; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: .5rem; flex-wrap: wrap; }
.empty { margin-bottom: 0; padding: 1.4rem; text-align: center; color: var(--muted); }
.client-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr) auto; gap: .75rem; align-items: end; padding: .9rem; margin: .8rem 0; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
label { display: grid; gap: .35rem; color: var(--muted); font-size: .78rem; }
input { width: 100%; min-width: 0; padding: .6rem .7rem; color: var(--text); border: 1px solid var(--line); border-radius: 8px; background: #091019; }
.scope-selector { display: flex; flex-wrap: wrap; gap: .55rem .75rem; margin: 0; padding: .6rem .7rem .7rem; border: 1px solid var(--line); border-radius: 8px; }
.scope-selector legend { padding: 0 .2rem; color: var(--muted); font-size: .78rem; }
.scope-selector label { display: flex; align-items: center; gap: .35rem; color: var(--text); }
.scope-selector input { width: auto; margin: 0; accent-color: var(--accent); }
.issued-token { display: grid; gap: .65rem; border-color: #775a23; background: #2a2416; }
.issued-token p { margin: 0; color: var(--muted); line-height: 1.5; }
.issued-token button { justify-self: start; }
#toast { position: fixed; right: 1rem; bottom: 1rem; max-width: min(430px, calc(100% - 2rem)); padding: .8rem 1rem; border: 1px solid var(--line); border-radius: 10px; color: var(--text); background: #182434; box-shadow: 0 12px 36px #0008; opacity: 0; transform: translateY(8px); pointer-events: none; transition: .18s ease; }
#toast.visible { opacity: 1; transform: translateY(0); }
@media (max-width: 760px) {
  .topbar, .card { align-items: flex-start; flex-direction: column; }
  .facts, .client-form, .path-grid, .provider-form, .provider-state-grid { grid-template-columns: 1fr; }
  .actions { justify-content: flex-start; }
}
`;
