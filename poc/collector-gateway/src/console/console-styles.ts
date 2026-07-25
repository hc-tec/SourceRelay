export const consoleStyles = `
:root {
  color-scheme: dark;
  --bg: #0a0d12;
  --panel: #11161e;
  --panel-2: #171d27;
  --line: #293141;
  --text: #eef2f8;
  --muted: #96a1b2;
  --accent: #75a7ff;
  --good: #43d19e;
  --warn: #f0b35a;
  --bad: #ff6b75;
  font-family: Inter, "Microsoft YaHei UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); }
button, input, select { font: inherit; }
button { border: 1px solid transparent; border-radius: 9px; padding: .65rem .9rem; background: var(--accent); color: #07101f; font-weight: 700; cursor: pointer; }
button:hover { filter: brightness(1.08); }
button:disabled { cursor: not-allowed; opacity: .5; }
button.secondary { background: transparent; border-color: var(--line); color: var(--text); }
button.danger { background: transparent; border-color: color-mix(in srgb, var(--bad), transparent 35%); color: var(--bad); }
.topbar { display: flex; justify-content: space-between; gap: 2rem; align-items: flex-end; padding: 2.2rem clamp(1rem, 5vw, 4.5rem); border-bottom: 1px solid var(--line); background: linear-gradient(135deg, #121925, #0a0d12 65%); }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: .35rem; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: -.04em; }
h2 { margin-bottom: .5rem; font-size: 1.15rem; }
.eyebrow { margin-bottom: .45rem; color: var(--accent); font-size: .72rem; font-weight: 800; letter-spacing: .16em; }
.subtitle, .muted { color: var(--muted); }
.host-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem; }
.badge { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: .45rem .7rem; font-size: .78rem; font-weight: 700; }
.badge.good { color: var(--good); border-color: color-mix(in srgb, var(--good), transparent 55%); }
.badge.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad), transparent 55%); }
.badge.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn), transparent 55%); }
.badge.neutral { color: var(--muted); }
main { width: min(1450px, calc(100% - 2rem)); margin: 1.5rem auto 4rem; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; margin-bottom: .8rem; }
.metrics article, .panel { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.metrics article { padding: 1rem; }
.metrics span { display: block; color: var(--muted); font-size: .78rem; }
.metrics strong { display: block; margin-top: .35rem; font-size: 1.45rem; }
.panel { padding: 1.2rem; margin-bottom: .8rem; }
.section-heading { display: flex; justify-content: space-between; align-items: center; }
.profile-form { display: grid; grid-template-columns: 1fr 1.4fr 1.6fr auto; align-items: end; gap: .75rem; padding: .9rem; margin: .75rem 0 1rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
label { display: grid; gap: .35rem; color: var(--muted); font-size: .78rem; }
input, select { width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 8px; padding: .62rem .7rem; background: #0c1118; color: var(--text); }
.profile-grid { display: grid; gap: .8rem; }
.profile-card { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel-2); }
.profile-header { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 1rem; }
.profile-title { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; }
.profile-title h3 { margin: 0; font-size: 1rem; }
.profile-actions { display: flex; gap: .5rem; }
.profile-meta { display: flex; flex-wrap: wrap; gap: 1rem; padding: 0 1rem 1rem; color: var(--muted); font-size: .78rem; }
.page-table { width: 100%; border-collapse: collapse; border-top: 1px solid var(--line); font-size: .78rem; }
.page-table th, .page-table td { padding: .65rem 1rem; text-align: left; border-bottom: 1px solid color-mix(in srgb, var(--line), transparent 35%); }
.page-table th { color: var(--muted); font-weight: 600; }
.page-table tr:last-child td { border-bottom: 0; }
.state-quarantined { color: var(--bad); }
.state-leased, .state-leased_pre_navigation { color: var(--warn); }
.state-idle_reusable { color: var(--good); }
.empty { padding: 2rem; text-align: center; color: var(--muted); }
.notice p { margin-bottom: 0; color: var(--muted); line-height: 1.65; }
.panel-copy { color: var(--muted); line-height: 1.65; }
.client-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: .75rem; padding: .9rem; margin: .75rem 0; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
.issued-token { display: grid; gap: .65rem; margin: .75rem 0; padding: .9rem; border: 1px solid color-mix(in srgb, var(--warn), transparent 45%); border-radius: 12px; background: color-mix(in srgb, var(--warn), transparent 92%); }
.issued-token p { margin: 0; color: var(--muted); line-height: 1.55; }
.issued-token code { display: block; overflow-wrap: anywhere; padding: .65rem; border: 1px solid var(--line); border-radius: 8px; background: #0c1118; color: var(--text); }
.issued-token button { justify-self: start; }
.client-grid { display: grid; gap: .6rem; }
.client-card { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .9rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); }
.client-card h3, .client-card p { margin: 0; }
.client-card h3 { font-size: 1rem; }
.client-card p { margin-top: .35rem; color: var(--muted); font-size: .78rem; overflow-wrap: anywhere; }
#toast { position: fixed; right: 1rem; bottom: 1rem; max-width: min(420px, calc(100% - 2rem)); border: 1px solid var(--line); border-radius: 10px; padding: .8rem 1rem; background: #161d27; box-shadow: 0 12px 40px #0008; opacity: 0; transform: translateY(8px); pointer-events: none; transition: .18s ease; }
#toast.visible { opacity: 1; transform: translateY(0); }
@media (max-width: 900px) {
  .topbar { align-items: flex-start; flex-direction: column; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .profile-form { grid-template-columns: 1fr; }
  .client-form { grid-template-columns: 1fr; }
  .profile-header { align-items: flex-start; flex-direction: column; }
  .client-card { align-items: flex-start; flex-direction: column; }
  .page-table { display: block; overflow-x: auto; }
}
`;
