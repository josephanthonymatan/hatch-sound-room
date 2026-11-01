// Inspect tracked content only, never runtime data or local credentials.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const issues=[];
const forbiddenPath=/(^|\/)(?:private|node_modules|data|\.git)(\/|$)|(^|\/)\.env(?!\.example$)(?:\.|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|log)$/i;
const privateText=[/\/Users\/[^\s/]+\//,/\/home\/(?!runner\/)[^\s/]+\//,/\b192\.168\.\d+\.\d+\b/,/\b10\.\d+\.\d+\.\d+\b/,/\b172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+\b/,/https?:\/\/[^\s/]+\.onrender\.com\b/,/\b(?:srv|dsk|tea|dep)-[a-z0-9]{16,}\b/];
for(const file of files){
 if(forbiddenPath.test(file))issues.push(`${file}: private/runtime path is tracked`);
 if(lstatSync(file).isSymbolicLink()){issues.push(`${file}: review symlink before publishing`);continue;}
 const bytes=readFileSync(file);
 if(bytes.includes(0) || /\.(?:mp3|woff2?|png|jpe?g)$/i.test(file))continue;
 if(privateText.some(pattern=>pattern.test(bytes.toString('utf8').replaceAll('\\.', '.'))))issues.push(`${file}: personal infrastructure or local-machine reference`);
}
if(!files.length)issues.push('Stage the intended source tree before running this check.');
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}
else console.log(`Public-tree check passed for ${files.length} tracked files. Run a credential scanner separately.`);
