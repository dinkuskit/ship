#!/usr/bin/env node
import {appendFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findMajorViolation} from './check-no-major.mjs';
import {effectiveSelector} from '../../scripts/beta-release.mjs';

// Recovery may publish an already-tagged version from a later CI-only repair.
// Its provenance must name that actual repair source, never pretend the tag moved.
const runtimeInputs=['src','scripts','cli','bin','package.json','package-lock.json','emdash-plugin.jsonc','tsconfig.json','.nvmrc'];
export function registryRecovery({cwd,eventName,ref,requested,sourceSha}) {
 if(eventName!=='workflow_dispatch'||ref!=='refs/heads/main'||requested!=='true')throw new Error('Registry recovery requires explicit publish-only dispatch on main');
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const pkg=JSON.parse(readFileSync(join(cwd,'package.json'),'utf8'));
 const manifest=JSON.parse(readFileSync(join(cwd,'emdash-plugin.jsonc'),'utf8'));
 if(pkg.name!=='@dinkuskit/ship'||manifest.slug!=='dinkus-ship'||pkg.version!==manifest.version||findMajorViolation(pkg.version))throw new Error('Recovery package and plugin identity/version must agree on 0.x');
 let pre;
 try{pre=JSON.parse(readFileSync(join(cwd,'.changeset/pre.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(pkg.version.includes('-')?pre?.mode!=='pre'||pre.tag!=='beta'||!/-beta\.\d+$/.test(pkg.version):pre?.mode==='pre')throw new Error('Recovery must preserve the current stable or beta release mode');
 const head=git('rev-parse','HEAD');if(head!==sourceSha)throw new Error('Recovery source must match the dispatched SHA');
 const tag='v'+pkg.version;
 let tagSha;
 try{tagSha=git('rev-parse','--verify',`refs/tags/${tag}^{commit}`);git('merge-base','--is-ancestor',tagSha,head);}catch{throw new Error('An existing ancestor release tag is required for Registry recovery');}
 const taggedPackage=JSON.parse(git('show',`${tagSha}:package.json`));
 const taggedManifest=JSON.parse(git('show',`${tagSha}:emdash-plugin.jsonc`));
 if(taggedPackage.name!==pkg.name||taggedPackage.version!==pkg.version||taggedManifest.slug!==manifest.slug||taggedManifest.version!==manifest.version)throw new Error('Existing release tag must name this exact package version');
 try{git('diff','--quiet',tagSha,head,'--',...runtimeInputs);git('diff','--quiet','HEAD','--',...runtimeInputs);}catch{throw new Error('Runtime or build inputs differ from the existing release tag');}
 return {packages:[{name:pkg.name,version:pkg.version}],selector:effectiveSelector(`${manifest.slug}@${pkg.version}`),tag,tagSha,sourceSha:head};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const result=registryRecovery({cwd:process.cwd(),eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,requested:process.env.REGISTRY_RECOVERY_REQUESTED,sourceSha:process.env.GITHUB_SHA});
 if(!process.env.GITHUB_OUTPUT)throw new Error('Recovery requires GitHub step outputs');
 appendFileSync(process.env.GITHUB_OUTPUT,`ready=true\npublished-packages=${JSON.stringify(result.packages)}\n`);
 console.log(`Registry recovery ready: ${result.selector}; existing tag ${result.tagSha}; actual source ${result.sourceSha}`);
}
