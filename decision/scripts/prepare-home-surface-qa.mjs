import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output/playwright/surface-fix');
fs.mkdirSync(output,{recursive:true});
const source=fs.readFileSync(path.join(root,'frontend/home/scene.js'),'utf8');
const hook='window.__surfaceQA={world,map,renderer,camera,draw};draw();\n}';
if(!source.includes('  draw();\n}'))throw new Error('Homepage inspection hook moved');
await build({stdin:{contents:source.replace('  draw();\n}',hook),resolveDir:path.join(root,'frontend/home'),loader:'js'},bundle:true,format:'esm',outfile:path.join(output,'scene-qa.js')});
console.log(output);
