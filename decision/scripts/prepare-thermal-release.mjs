import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frontendOnly=process.argv.includes('--frontend-only');
const lczRefinement=process.argv.includes('--lcz-refinement');
const lczWorkflow=process.argv.includes('--lcz-workflow');
if(frontendOnly&&lczRefinement)throw new Error('LCZ refinement includes its backend');
if(lczWorkflow&&(lczRefinement||frontendOnly))throw new Error('Choose one release mode');
const releaseId=(lczWorkflow?'lcz-workflow-':lczRefinement?'lcz-refinement-':frontendOnly?'workspace-core-':'thermal-evidence-')+Date.now();
const release=path.join(root,'output/releases',releaseId),files=new Map();
const runtime=lczWorkflow?['lcz.py','sandbox.py','data_contract.py','collection.py','routing.py','aic/regional.py','aic/decision.py','aic/router.py']:lczRefinement?['lcz.py']:frontendOnly?[]:['sandbox.py','data_contract.py','aic/router.py','aic/retrieval.py','aic/manage.py','aic/decision.py'];
const tests=frontendOnly?[]:['test_sandbox.py','test_lcz.py','aic/test_aic.py','aic/test_regional.py','aic/test_decision.py',...(lczWorkflow?['test_collection.py','test_routing_temporal.py']:[])];
const testModules=['backend.test_sandbox','backend.test_lcz','backend.aic.test_aic','backend.aic.test_regional','backend.aic.test_decision',...(lczWorkflow?['backend.test_collection','backend.test_routing_temporal']:[])];
const dataFiles=lczRefinement||lczWorkflow?['data/campus-lcz-simulation.geojson','data/campus-lcz-constraints.geojson']:[];
const extraStatic=lczRefinement||lczWorkflow?['aic/assets/landcover.png']:[];
for(const name of dataFiles){const data=fs.readFileSync(path.join(root,'public',name));files.set('public/'+name,data);files.set('dist/'+name,data);}
for(const name of extraStatic)files.set('dist/'+name,fs.readFileSync(path.join(root,'dist',name)));
for(const name of [...runtime,...tests])files.set('backend/'+name,fs.readFileSync(path.join(root,'backend',name)));
for(const name of fs.readdirSync(path.join(root,'dist/assets')))if(fs.statSync(path.join(root,'dist/assets',name)).isFile())files.set('dist/assets/'+name,fs.readFileSync(path.join(root,'dist/assets',name)));
for(const name of ['index.html','aic/index.html'])files.set('dist/'+name,fs.readFileSync(path.join(root,'dist',name)));
files.set('scripts/deploy-thermal-release.sh',Buffer.from(fs.readFileSync(path.join(root,'scripts/deploy-thermal-release.sh'),'utf8').replaceAll('\r\n','\n')));
const hashes={};
for(const [name,data]of files){const dest=path.join(release,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);hashes[name]=crypto.createHash('sha256').update(data).digest('hex');}
fs.writeFileSync(path.join(release,'release.sha256'),Object.entries(hashes).map(([name,hash])=>hash+'  '+name+'\n').join(''));
fs.writeFileSync(path.join(release,'manifest.json'),JSON.stringify({releaseId,frontendOnly,lczRefinement,lczWorkflow,runtime,dataFiles,extraStatic,testModules,hashes},null,2));
console.log(JSON.stringify({releaseId,release,files:files.size}));
