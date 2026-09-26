import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix',path.join(root,'.runtime'),'--no-save','--package-lock=false','node@24.21.0'],{stdio:'inherit'});
console.log('Project-local Node 24.21.0 installed. Your global Node is unchanged.');
