const KEY='collector.xiaohongshu.comment-replies-click-ledger.v1'; const MAX=100;
interface Entry{schemaVersion:1;workId:string;attempted:boolean;completed:boolean;updatedAt:string}
export async function prepareXiaohongshuCommentRepliesClick(workId:string){const entries=await load();
  if(entries.some((entry)=>entry.workId===workId&&entry.attempted))throw new Error('xiaohongshu_comment_replies_action_already_attempted');
  if(!entries.some((entry)=>entry.workId===workId))entries.push({schemaVersion:1,workId,attempted:false,completed:false,updatedAt:new Date().toISOString()});await save(entries);}
export async function recordXiaohongshuCommentRepliesClickIntent(workId:string){const entries=await load();const entry=entries.find((value)=>value.workId===workId);
  if(!entry||entry.attempted)throw new Error('xiaohongshu_comment_replies_ledger_out_of_sequence');entry.attempted=true;entry.updatedAt=new Date().toISOString();await save(entries);}
export async function completeXiaohongshuCommentRepliesClick(workId:string){const entries=await load();const entry=entries.find((value)=>value.workId===workId);
  if(!entry?.attempted)throw new Error('xiaohongshu_comment_replies_ledger_missing');entry.completed=true;entry.updatedAt=new Date().toISOString();await save(entries);}
export async function xiaohongshuCommentRepliesClickAttempted(workId:string){return (await load()).find((value)=>value.workId===workId)?.attempted??false;}
async function load():Promise<Entry[]>{const value=(await chrome.storage.local.get(KEY))[KEY];return Array.isArray(value)?value.filter(valid).slice(-MAX):[];}
async function save(entries:Entry[]){await chrome.storage.local.set({[KEY]:entries.slice(-MAX)});}
function valid(value:unknown):value is Entry{if(!value||typeof value!=='object'||Array.isArray(value))return false;const e=value as Partial<Entry>;
  return e.schemaVersion===1&&typeof e.workId==='string'&&/^[0-9a-f-]{36}$/i.test(e.workId)&&typeof e.attempted==='boolean'&&typeof e.completed==='boolean'&&
    (!e.completed||e.attempted)&&typeof e.updatedAt==='string'&&Number.isFinite(Date.parse(e.updatedAt));}
