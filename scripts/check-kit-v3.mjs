// One local official check. Native rows are copied unchanged; no run record/context is invented.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const evidence = resolve('v3-evidence'), native = join(evidence,'probe-native');
const output = join(native,'opencode.db'), report = resolve('KIT-CHECK-V3.json');
assert(!existsSync(output)&&!existsSync(report),'V3 official check is single-attempt; never replay it');
mkdirSync(native,{recursive:true});
const source='/home/hatch/sepuh1/.local/share/opencode/opencode.db';
const src=new DatabaseSync(source,{readOnly:true});src.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;');
const ids=new Set(['ses_de5883638ffeHfJ0CgenXtei7A','ses_de5bfc9faffep9R37w4xwgmGWM','ses_de5de7259ffetnamV9v3uXpVup']);
const all=src.prepare('SELECT id,parent_id FROM session').all();
let change=true;while(change){change=false;for(const r of all)if(ids.has(r.id)||ids.has(r.parent_id)){for(const id of [r.id,r.parent_id])if(id&&!ids.has(id)){ids.add(id);change=true;}}}
const sessions=[...ids].sort().map(id=>src.prepare('SELECT id,project_id,directory,title,time_created,time_updated FROM session WHERE id=?').get(id));
assert(sessions.every(Boolean),'Every selected session must be native, not synthesized');
const projects=new Set(sessions.map(s=>s.project_id)),dst=new DatabaseSync(output,{enableForeignKeyConstraints:false});
dst.exec('PRAGMA journal_mode=DELETE; BEGIN;');
const quote=s=>'"'+s.replaceAll('"','""')+'"',schemas=src.prepare("SELECT name,tbl_name,sql,type FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
const tables=[];
for(const [table,column,values]of [['project','id',projects],...['session','message','part','session_v2','session_message','session_part','session_input','session_context_epoch','instruction_state','todo'].map(t=>[t,t==='session'||t==='session_v2'?'id':'session_id',ids])]){
  const schema=schemas.find(s=>s.type==='table'&&s.name===table);if(!schema)continue;dst.exec(schema.sql);
  const cols=src.prepare('PRAGMA table_info('+quote(table)+')').all().map(c=>c.name);
  const select=src.prepare('SELECT * FROM '+quote(table)+' WHERE '+quote(column)+'=? ORDER BY rowid');select.setReadBigInts(true);
  const insert=dst.prepare('INSERT INTO '+quote(table)+' ('+cols.map(quote).join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')');
  const digest=createHash('sha256');let rows=0;
  for(const id of [...values].sort())for(const row of select.all(id)){insert.run(...cols.map(c=>row[c]??null));digest.update(JSON.stringify(row,(_,v)=>typeof v==='bigint'?String(v):v));rows++;}
  tables.push({table,rows,unchanged_row_digest:digest.digest('hex')});
}
for(const index of schemas.filter(s=>s.type==='index'&&tables.some(t=>t.table===s.tbl_name)))dst.exec(index.sql);
dst.exec('COMMIT');dst.close();src.exec('COMMIT');src.close();
writeFileSync(join(evidence,'native-export-v3.json'),JSON.stringify({source,output,method:'Selected native SQLite rows copied unchanged; no transcript reconstruction, system prompt or submission run record',sessions,tables},null,2)+'\n');
const absent=join(evidence,'probe-absent-access.json'),tmp=join(evidence,'probe-tmp');assert(!existsSync(absent));mkdirSync(tmp,{recursive:true});
const args=['kit/cli/makefun.mjs','check','--kit','kit','--repo','.','--worktree','--transcripts',output,'--json'];
const started=new Date().toISOString();
const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:{PATH:process.env.PATH,MAKEFUN_OFFLINE:'1',MAKEFUN_CREDENTIALS:absent,TMPDIR:tmp}});
const record={started,completed:new Date().toISOString(),command:['MAKEFUN_OFFLINE=1','MAKEFUN_CREDENTIALS=<nonexistent local path>','node',...args],exit_code:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr};
writeFileSync(join(evidence,'kit-check-v3.json'),JSON.stringify(record,null,2)+'\n');
assert(result.stdout,'Official check returned no stdout; do not retry automatically');
const parsed=JSON.parse(result.stdout);writeFileSync(report,JSON.stringify(parsed,null,2)+'\n');console.log(JSON.stringify(record,null,2));
