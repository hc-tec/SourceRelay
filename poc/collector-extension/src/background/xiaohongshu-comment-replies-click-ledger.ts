const KEY='collector.xiaohongshu.comment-replies-click-ledger.v1'; const MAX=100;
interface Entry{schemaVersion:1;workId:string;attemptCount:0|1|2|3;completedCount:0|1|2|3;updatedAt:string}
export async function prepareXiaohongshuCommentRepliesClick(workId:string){const entries=await load();
  if(entries.some((entry)=>entry.workId===workId&&entry.attemptCount>0))throw new Error('xiaohongshu_comment_replies_action_already_attempted');
  if(!entries.some((entry)=>entry.workId===workId))entries.push({schemaVersion:1,workId,attemptCount:0,completedCount:0,updatedAt:new Date().toISOString()});await save(entries);}
export async function recordXiaohongshuCommentRepliesClickIntent(workId:string,ordinal:1|2|3=1){const entries=await load();const entry=entries.find((value)=>value.workId===workId);
  if(!entry||ordinal!==entry.attemptCount+1)throw new Error('xiaohongshu_comment_replies_ledger_out_of_sequence');entry.attemptCount=ordinal;entry.updatedAt=new Date().toISOString();await save(entries);}
export async function completeXiaohongshuCommentRepliesClick(workId:string,ordinal:1|2|3=1){const entries=await load();const entry=entries.find((value)=>value.workId===workId);
  if(!entry||ordinal>entry.attemptCount||ordinal!==entry.completedCount+1)throw new Error('xiaohongshu_comment_replies_ledger_missing');entry.completedCount=ordinal;entry.updatedAt=new Date().toISOString();await save(entries);}
export async function xiaohongshuCommentRepliesClickAttempted(workId:string){return ((await load()).find((value)=>value.workId===workId)?.attemptCount ?? 0)>0;}
export async function xiaohongshuCommentRepliesClickCounts(workId:string):Promise<{attemptCount:0|1|2|3;completedCount:0|1|2|3}>{
  const entry=(await load()).find((value)=>value.workId===workId);
  return {attemptCount:entry?.attemptCount??0,completedCount:entry?.completedCount??0};
}
async function load():Promise<Entry[]>{const value=(await chrome.storage.local.get(KEY))[KEY];return Array.isArray(value)?value.filter(valid).slice(-MAX):[];}
async function save(entries:Entry[]){await chrome.storage.local.set({[KEY]:entries.slice(-MAX)});}
function valid(value:unknown):value is Entry{if(!value||typeof value!=='object'||Array.isArray(value))return false;const e=value as Partial<Entry>;
  return e.schemaVersion===1&&typeof e.workId==='string'&&/^[0-9a-f-]{36}$/i.test(e.workId)&&
    Number.isInteger(e.attemptCount)&&Number(e.attemptCount)>=0&&Number(e.attemptCount)<=3&&
    Number.isInteger(e.completedCount)&&Number(e.completedCount)>=0&&Number(e.completedCount)<=Number(e.attemptCount)&&
    typeof e.updatedAt==='string'&&Number.isFinite(Date.parse(e.updatedAt));}
