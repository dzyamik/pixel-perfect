function h(n){const o=n.split(`
`),e=[];let p=!1,t="",d="";const c=[],i=[],r=/^\s*\/\/\s*@snippet\s+(\S+)\s*$/,l=/^\s*\/\/\s*@title\s+(.+?)\s*$/,s=/^\s*\/\/\s*@desc\s+(.+?)\s*$/,g=/^\s*\/\/\s*@endsnippet\s*$/;for(const a of o){if(!p){const u=r.exec(a);u&&(p=!0,t=u[1],d="",c.length=0,i.length=0);continue}if(g.test(a)){e.push({slug:t,title:d||t,description:c.join(`
`),code:b(i).join(`
`)}),p=!1;continue}const m=l.exec(a);if(m){d=m[1];continue}const f=s.exec(a);if(f){c.push(f[1]);continue}i.push(a)}return e}function b(n){let o=1/0;for(const e of n){if(e.trim()==="")continue;const p=/^(\s*)/.exec(e),t=p?p[1].length:0;t<o&&(o=t)}return o===1/0||o===0?n.slice():n.map(e=>e.trim()===""?"":e.slice(o))}function v(n){w();const o=h(n);let e=document.getElementById("pp-code-panel");e!==null&&e.remove(),e=document.createElement("aside"),e.id="pp-code-panel";const p=document.createElement("button");p.id="pp-code-panel-toggle",p.type="button",p.textContent="code ›",p.title="Toggle ready-to-paste snippets";const t=document.createElement("div");t.className="pp-code-drawer";const d=document.createElement("header"),c=document.createElement("h2");c.textContent="Snippets";const i=document.createElement("p");i.className="pp-code-subhead",i.textContent=o.length>0?`${o.length} ready-to-paste block${o.length===1?"":"s"} from this demo`:"No snippets annotated yet for this demo.",d.append(c,i),t.append(d);for(const s of o)t.append(y(s));e.append(p,t),document.body.append(e);const r="pp-code-panel-open";localStorage.getItem(r)==="1"&&e.classList.add("pp-open"),p.addEventListener("click",()=>{const s=!e.classList.contains("pp-open");e.classList.toggle("pp-open",s),localStorage.setItem(r,s?"1":"0")})}function y(n){const o=document.createElement("article");o.className="pp-snippet-card",o.id=`snippet-${n.slug}`;const e=document.createElement("header"),p=document.createElement("h3");if(p.textContent=n.title,e.append(p),n.description.length>0){const i=document.createElement("p");i.className="pp-snippet-desc",i.textContent=n.description,e.append(i)}const t=document.createElement("button");t.type="button",t.className="pp-snippet-copy",t.textContent="copy",t.addEventListener("click",()=>{navigator.clipboard.writeText(n.code).then(()=>{t.textContent="copied",window.setTimeout(()=>{t.textContent="copy"},1500)},()=>{t.textContent="failed"})});const d=document.createElement("pre");d.className="pp-snippet-code";const c=document.createElement("code");return c.textContent=n.code,d.append(c),o.append(e,t,d),o}let x=!1;function w(){if(x)return;x=!0;const n=document.createElement("style");n.textContent=E,document.head.append(n)}const E=`
#pp-code-panel {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    z-index: 999;
    display: flex;
    pointer-events: none;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
#pp-code-panel-toggle {
    pointer-events: auto;
    align-self: center;
    background: #1a1f29;
    color: #cfd6e0;
    border: 1px solid #2a2f3a;
    border-right: none;
    border-radius: 4px 0 0 4px;
    padding: 8px 6px;
    font-size: 11px;
    font-family: monospace;
    writing-mode: vertical-rl;
    cursor: pointer;
    margin-right: 0;
}
#pp-code-panel-toggle:hover { background: #232936; color: #fff; }
#pp-code-panel.pp-open #pp-code-panel-toggle::after { content: ''; }
.pp-code-drawer {
    pointer-events: auto;
    width: 0;
    background: #0d1117;
    border-left: 1px solid #1a1f29;
    overflow-y: auto;
    overflow-x: hidden;
    transition: width 200ms ease;
    box-sizing: border-box;
}
#pp-code-panel.pp-open .pp-code-drawer {
    width: min(480px, 90vw);
    padding: 16px 18px 80px;
}
.pp-code-drawer header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #cfd6e0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.pp-code-drawer header .pp-code-subhead {
    margin: 4px 0 16px;
    font-size: 12px;
    color: #8b949e;
}
.pp-snippet-card {
    background: #0f141c;
    border: 1px solid #1a1f29;
    border-radius: 4px;
    margin: 0 0 16px;
    padding: 12px 14px 14px;
    position: relative;
}
.pp-snippet-card h3 {
    margin: 0;
    font-size: 13px;
    color: #cfd6e0;
    font-weight: 600;
}
.pp-snippet-desc {
    margin: 6px 0 8px;
    font-size: 12px;
    line-height: 1.5;
    color: #8b949e;
    white-space: pre-line;
}
.pp-snippet-copy {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #14181f;
    color: #8b949e;
    border: 1px solid #1a1f29;
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    text-transform: lowercase;
}
.pp-snippet-copy:hover { color: #cfd6e0; background: #1a1f29; }
.pp-snippet-code {
    margin: 6px 0 0;
    padding: 10px 12px;
    background: #14181f;
    border-radius: 3px;
    overflow-x: auto;
    font-size: 11px;
    line-height: 1.55;
    color: #cfd6e0;
}
.pp-snippet-code code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (max-width: 720px) {
    #pp-code-panel {
        top: auto;
        bottom: 0;
        width: 100%;
        height: auto;
        flex-direction: column;
    }
    #pp-code-panel-toggle {
        writing-mode: horizontal-tb;
        align-self: flex-end;
        border: 1px solid #2a2f3a;
        border-bottom: none;
        border-radius: 4px 4px 0 0;
        margin-right: 12px;
    }
    .pp-code-drawer {
        width: 100% !important;
        height: 0;
        transition: height 200ms ease;
        border-left: none;
        border-top: 1px solid #1a1f29;
    }
    #pp-code-panel.pp-open .pp-code-drawer {
        height: 60vh;
        padding: 16px 18px 24px;
    }
}
`;export{v as m,h as p,y as r};
