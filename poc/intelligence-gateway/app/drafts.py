from __future__ import annotations

import asyncio
import json
import uuid
from urllib.parse import urlsplit

from .config import Settings
from .connectors.article import validate_public_url
from .errors import MisconfiguredError, SourceUnavailableError


INSPECT_JAVASCRIPT = r"""
var visible=function(el){var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
var esc=function(v){return String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"');};
var selector=function(el){
  if(el.id){var x='#'+CSS.escape(el.id);if(document.querySelectorAll(x).length===1)return x;}
  var tag=el.tagName.toLowerCase();
  for(var a of ['name','placeholder','aria-label']){var v=el.getAttribute(a);if(v){var x=tag+'['+a+'="'+esc(v)+'"]';if(document.querySelectorAll(x).length===1)return x;}}
  var cls=Array.from(el.classList).filter(function(x){return x&&!/[0-9]{5,}/.test(x);}).slice(0,2);
  if(cls.length){var x=tag+'.'+cls.map(CSS.escape).join('.');if(document.querySelectorAll(x).length<=5)return x;}
  var parts=[];var cur=el;
  for(var i=0;cur&&cur!==document.body&&i<5;i++,cur=cur.parentElement){var t=cur.tagName.toLowerCase();var sib=Array.from(cur.parentElement.children).filter(function(x){return x.tagName===cur.tagName;});parts.unshift(t+(sib.length>1?':nth-of-type('+(sib.indexOf(cur)+1)+')':''));}
  return 'body > '+parts.join(' > ');
};
var terms=/search|query|keyword|搜索|搜一搜|检索/i;
var inputs=Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).filter(visible).map(function(el){
  var text=[el.id,el.name,el.type,el.placeholder,el.getAttribute('aria-label')].filter(Boolean).join(' ');
  var score=(el.type==='search'?8:0)+(terms.test(text)?10:0)+(el.tagName==='TEXTAREA'?1:0);
  return {selector:selector(el),tag:el.tagName.toLowerCase(),type:el.type||'',name:el.name||'',placeholder:el.placeholder||'',aria_label:el.getAttribute('aria-label')||'',score:score};
}).sort(function(a,b){return b.score-a.score;}).slice(0,10);
var submits=Array.from(document.querySelectorAll('button,input[type="submit"],[role="button"]')).filter(visible).map(function(el){
  var text=(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().slice(0,100);
  var score=(el.type==='submit'?6:0)+(terms.test(text)?10:0);
  return {selector:selector(el),text:text,score:score};
}).sort(function(a,b){return b.score-a.score;}).slice(0,10);
var body=(document.body.innerText||'').slice(0,20000);
var markers=['登录','扫码','验证码','sign in','log in'].filter(function(x){return body.toLowerCase().indexOf(x.toLowerCase())>=0;});
return {url:location.href,title:document.title,inputs:inputs,submits:submits,forms:document.forms.length,authentication_markers:markers};
"""


RESULT_JAVASCRIPT = r"""
var visible=function(el){var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
var candidateSelector=function(el){var cls=Array.from(el.classList).filter(function(x){return x&&!/[0-9]{5,}/.test(x);}).slice(0,2);if(!cls.length)return '';return el.tagName.toLowerCase()+'.'+cls.map(CSS.escape).join('.');};
var forced=__RESULT_SELECTOR__;var query=__QUERY__.toLowerCase().trim();var queryTerms=query.split(/\s+/).filter(function(x){return x.length>=2;});if(!queryTerms.length&&query)queryTerms=[query];var selectors={};
if(!forced){
  ['h2','h3','h4'].forEach(function(sel){if(document.querySelectorAll(sel).length>=2)selectors[sel]=1;});
  Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0,500).forEach(function(a){var p=a;for(var i=0;p&&i<5;i++,p=p.parentElement){if(!/^(ARTICLE|LI|SECTION|DIV|H2|H3|H4)$/.test(p.tagName))continue;var sel=candidateSelector(p);if(sel)selectors[sel]=1;}});
}
var candidates=Object.keys(selectors).map(function(sel){
  var nodes=Array.from(document.querySelectorAll(sel)).slice(0,100);var urls={};var usable=0;var relevant=0;var linkTotal=0;var textTotal=0;
  nodes.forEach(function(node){var links=Array.from(node.querySelectorAll('a[href]'));var a=node.matches('a[href]')?node:links[0];var t=node.matches('h1,h2,h3,h4')?node:node.querySelector('h1,h2,h3,h4,[class*="title"],a[href]');var title=((t&&t.textContent)||(a&&a.textContent)||'').trim();linkTotal+=links.length;textTotal+=(node.innerText||'').length;if(a&&a.href&&title){usable++;urls[a.href]=1;if(queryTerms.some(function(term){return title.toLowerCase().indexOf(term)>=0;}))relevant++;}});
  var count=nodes.length;var averageLinks=count?linkTotal/count:0;var uniqueUrls=Object.keys(urls).length;var heading=/^h[2-4](?:[.#]|$)/.test(sel);var score=relevant*100+usable*10+Math.min(count,30)+(heading?50:0)+(count&&textTotal/count>20?10:0)-Math.max(0,averageLinks-3)*15;
  return {selector:sel,count:count,usable_count:usable,relevant_count:relevant,unique_urls:uniqueUrls,average_links:averageLinks,score:score};
}).filter(function(g){return g.count>=2&&g.count<=100&&g.usable_count>=2&&g.unique_urls>=2;}).sort(function(a,b){return b.score-a.score;}).slice(0,10);
var selected=forced||(candidates[0]&&candidates[0].selector)||'';
var items=selected?Array.from(document.querySelectorAll(selected)).slice(0,__LIMIT__).map(function(node,i){var a=node.matches('a[href]')?node:node.querySelector('a[href]');var t=node.matches('h1,h2,h3,h4')?node:node.querySelector('h1,h2,h3,h4,[class*="title"],a[href]');return {rank:i+1,title:((t&&t.textContent)||(a&&a.textContent)||'').trim().slice(0,300),url:a?a.href:'',text:(node.innerText||'').trim().slice(0,500)};}):[];
return {url:location.href,title:document.title,selected_selector:selected,candidates:candidates,items:items};
"""


class BrowserWingDraftExplorer:
    def __init__(self, settings: Settings, lock: asyncio.Lock) -> None:
        self.settings = settings
        self.lock = lock
        self.binary = (
            settings.browserwing_root
            / "node_modules"
            / "browserwing"
            / "bin"
            / "browserwing.exe"
        )

    async def _command(self, *arguments: str, timeout: float = 60) -> dict:
        if not self.binary.is_file():
            raise MisconfiguredError("BrowserWing executable is missing.")
        process = await asyncio.create_subprocess_exec(
            str(self.binary),
            *arguments,
            cwd=str(self.settings.browserwing_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError as exc:
            cleanup = await asyncio.create_subprocess_exec(
                "taskkill.exe",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await cleanup.wait()
            await process.wait()
            raise SourceUnavailableError("BrowserWing draft command timed out.") from exc
        if process.returncode != 0:
            diagnostic = (stderr or stdout).decode("utf-8", errors="replace").strip()
            raise SourceUnavailableError(
                "BrowserWing draft command failed.",
                warnings=[diagnostic.splitlines()[-1][:300] if diagnostic else "No diagnostic output."],
            )
        try:
            return json.loads(stdout.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SourceUnavailableError("BrowserWing command did not return valid UTF-8 JSON.") from exc

    async def _start_service(self) -> None:
        start_script = self.settings.browserwing_root / "scripts" / "start.ps1"
        if not start_script.is_file():
            raise MisconfiguredError("BrowserWing start script is missing.")
        service = await asyncio.create_subprocess_exec(
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(start_script),
            cwd=str(self.settings.browserwing_root),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await service.wait()

    async def _ensure_browser(self) -> None:
        await self._start_service()
        try:
            await self._command("exec", "page-info", timeout=10)
            return
        except SourceUnavailableError:
            pass
        # BrowserWing can retain an instance record after its Chrome control
        # connection has died. Starting that record again only reports
        # "already running", so replace the stale instance while holding the
        # shared profile lock.
        await self._replace_browser()

    async def _replace_browser(self) -> None:
        try:
            await self._command("browser", "stop", "default", timeout=30)
        except SourceUnavailableError:
            pass
        await self._command("browser", "start", "default", timeout=30)

    async def _navigate(self, url: str) -> None:
        try:
            await self._command("exec", "navigate", url, timeout=60)
        except SourceUnavailableError as exc:
            diagnostic = " ".join([str(exc), *exc.warnings]).casefold()
            stale_markers = (
                "connection is closed",
                "closed network connection",
                "failed to get browser pages",
                "browser connection is closed or invalid",
            )
            if not any(marker in diagnostic for marker in stale_markers):
                raise
            await self._replace_browser()
            await self._command("exec", "navigate", url, timeout=60)

    async def _inspect_unlocked(self, url: str) -> dict:
        await self._navigate(url)
        await asyncio.sleep(3)
        result = await self._command("exec", "eval", INSPECT_JAVASCRIPT, timeout=30)
        return result.get("data", {}).get("result") or {}

    @staticmethod
    def _submit_javascript(input_selector: str, submit_selector: str, query: str) -> str:
        input_json = json.dumps(input_selector, ensure_ascii=False)
        submit_json = json.dumps(submit_selector, ensure_ascii=False)
        # BrowserWing's Windows CLI can corrupt non-ASCII command-line
        # arguments before JavaScript evaluation. JSON unicode escapes keep the
        # subprocess argument ASCII while the browser receives the original text.
        query_json = json.dumps(query, ensure_ascii=True)
        return f"""
var el=document.querySelector({input_json});
if(!el){{return {{ok:false,error:'input selector not found'}};}}
el.focus();
var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
var descriptor=Object.getOwnPropertyDescriptor(proto,'value');
if(descriptor&&descriptor.set){{descriptor.set.call(el,{query_json});}}else{{el.value={query_json};}}
el.dispatchEvent(new Event('input',{{bubbles:true}}));
el.dispatchEvent(new Event('change',{{bubbles:true}}));
var submit={submit_json}?document.querySelector({submit_json}):null;
if(submit){{submit.click();return {{ok:true,method:'click'}};}}
if(el.form){{if(el.form.requestSubmit){{el.form.requestSubmit();}}else{{el.form.submit();}}return {{ok:true,method:'form'}};}}
el.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}}));
return {{ok:true,method:'enter'}};
"""

    async def _search_unlocked(
        self,
        *,
        url: str,
        query: str,
        input_selector: str | None = None,
        submit_selector: str | None = None,
        result_selector: str | None = None,
        expected_host: str | None = None,
        limit: int = 10,
    ) -> dict:
        inspection = await self._inspect_unlocked(url)
        inputs = inspection.get("inputs") or []
        submits = inspection.get("submits") or []
        chosen_input = input_selector or (inputs[0].get("selector") if inputs else "")
        chosen_submit = submit_selector
        if chosen_submit is None:
            chosen_submit = submits[0].get("selector") if submits else ""
        if not chosen_input:
            return {
                "inspection": inspection,
                "validation": {
                    "passed": False,
                    "issues": ["No visible search input candidate was found."],
                },
                "recipe": None,
                "items": [],
            }
        submitted = await self._command(
            "exec",
            "eval",
            self._submit_javascript(chosen_input, chosen_submit or "", query),
            timeout=30,
        )
        submission = submitted.get("data", {}).get("result") or {}
        if not submission.get("ok"):
            return {
                "inspection": inspection,
                "validation": {
                    "passed": False,
                    "issues": ["The inferred search input could not be submitted."],
                },
                "recipe": None,
                "items": [],
            }
        await asyncio.sleep(8)
        page_info = await self._command("exec", "page-info", timeout=30)
        final_url = str(page_info.get("data", {}).get("url") or "")
        result_js = RESULT_JAVASCRIPT.replace(
            "__RESULT_SELECTOR__", json.dumps(result_selector or "", ensure_ascii=False)
        ).replace("__QUERY__", json.dumps(query, ensure_ascii=True)).replace(
            "__LIMIT__", str(max(1, min(limit, 100)))
        )
        result_payload = await self._command("exec", "eval", result_js, timeout=30)
        result = result_payload.get("data", {}).get("result") or {}
        start_host = (expected_host or urlsplit(url).hostname or "").lower()
        final_host = (urlsplit(final_url).hostname or "").lower()
        host_allowed = final_host == start_host or final_host.endswith(f".{start_host}")
        valid_items = [
            item
            for item in (result.get("items") or [])
            if str(item.get("url") or "").startswith(("http://", "https://"))
            and str(item.get("title") or "").strip()
        ]
        query_terms = [term.casefold() for term in query.split() if len(term) >= 2]
        if not query_terms and query:
            query_terms = [query.casefold()]
        relevant_items = [
            item
            for item in valid_items
            if any(
                term in f"{item.get('title', '')} {item.get('text', '')}".casefold()
                for term in query_terms
            )
        ]
        relevant_ids = {id(item) for item in relevant_items}
        ordered_items = [
            *relevant_items,
            *(item for item in valid_items if id(item) not in relevant_ids),
        ]
        issues: list[str] = []
        if not host_allowed:
            issues.append("Search navigation left the allowed hostname.")
        if not result.get("selected_selector"):
            issues.append("No repeated result-item selector was inferred.")
        if len(valid_items) < 2:
            issues.append("Fewer than two result items with title and URL were extracted.")
        if not relevant_items:
            issues.append("Extracted items did not contain the sample query terms.")
        authentication_markers = inspection.get("authentication_markers") or []
        if authentication_markers and len(valid_items) < 2:
            issues.append(
                "Authentication or verification markers were present while usable results were unavailable."
            )
        passed = not issues
        recipe = None
        if passed:
            recipe = {
                "start_url": inspection.get("url") or url,
                "input_selector": chosen_input,
                "submit_selector": chosen_submit or "",
                "result_item_selector": result.get("selected_selector"),
                "expected_host": start_host,
            }
        return {
            "inspection": inspection,
            "validation": {
                "passed": passed,
                "issues": issues,
                "final_url": final_url,
                "final_title": page_info.get("data", {}).get("title") or "",
                "item_count": len(valid_items),
                "relevant_item_count": len(relevant_items),
                "submit_method": submission.get("method") or "",
                "result_candidates": result.get("candidates") or [],
                "authentication_markers": authentication_markers,
                "authentication_gate_suspected": bool(authentication_markers)
                and len(valid_items) < 2,
            },
            "recipe": recipe,
            "items": ordered_items,
        }

    def _write_artifact(self, payload: dict) -> None:
        raw_dir = self.settings.runtime_dir / "raw" / "drafts"
        raw_dir.mkdir(parents=True, exist_ok=True)
        path = raw_dir / f"draft-{uuid.uuid4()}.json"
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    async def inspect(self, url: str) -> dict:
        await validate_public_url(url)
        async with self.lock:
            await self._ensure_browser()
            inspection = await self._inspect_unlocked(url)
        payload = {
            "inspection": inspection,
            "validation": None,
            "recipe": {
                "start_url": inspection.get("url") or url,
                "input_selector": (inspection.get("inputs") or [{}])[0].get(
                    "selector", ""
                ),
                "submit_selector": (inspection.get("submits") or [{}])[0].get(
                    "selector", ""
                ),
                "result_item_selector": "",
            },
            "items": [],
        }
        self._write_artifact(payload)
        return payload

    async def validate(self, url: str, sample_query: str) -> dict:
        await validate_public_url(url)
        async with self.lock:
            await self._ensure_browser()
            payload = await self._search_unlocked(url=url, query=sample_query)
        self._write_artifact(payload)
        return payload

    async def execute_recipe(self, recipe: dict, query: str, limit: int = 20) -> dict:
        url = str(recipe["start_url"])
        await validate_public_url(url)
        async with self.lock:
            await self._ensure_browser()
            payload = await self._search_unlocked(
                url=url,
                query=query,
                input_selector=str(recipe["input_selector"]),
                submit_selector=str(recipe.get("submit_selector") or ""),
                result_selector=str(recipe["result_item_selector"]),
                expected_host=str(recipe["expected_host"]),
                limit=limit,
            )
        self._write_artifact(payload)
        return payload
