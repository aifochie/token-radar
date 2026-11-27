import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [a,b,label] = process.argv.slice(2);
if(!a||!b||!['a','b'].includes(label))throw new Error('usage: node scripts/run-validation-v3.mjs <output> <repeat> a|b');
const args=['scripts/validate-build.ts',a,b],start=Date.now();
const result=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:8*1024*1024});
const record={command:['node',...args],exit:result.status,elapsed_seconds:(Date.now()-start)/1000,stdout:result.stdout,stderr:result.stderr};
writeFileSync('v3-evidence/validate-'+label+'.json',JSON.stringify(record,null,2)+'\n');
if(result.status!==0){console.error(result.stderr.slice(0,1800));process.exitCode=1;}else console.log(result.stdout);
