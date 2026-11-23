import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const binary = process.argv[2] ?? (process.platform === 'win32' ? 'native/build/Release/pocket-cli.exe' : 'native/build/pocket-cli');
const project = (code, rest = {}) => ({files:[{path:'main.cpp',content:code}],stdin:'',timeLimitMs:3000,...rest});
const tests = [
  ['c++17-stl', project('#include <bits/stdc++.h>\nusing namespace std; int main(){vector<int>a={3,1,2};sort(a.begin(),a.end());auto[x,y]=pair{8,12};optional<int>z=gcd(x,y);for(int v:a)cout<<v;cout<<" "<<*z<<"\\n";}'), r=>{assert.equal(r.error,'');assert.equal(r.stdout,'123 4\n');assert.equal(r.precompiledHeaders,true);}],
  ['pch-macro-fallback',project('#define CUSTOM_BEFORE_BITS 42\n#include <bits/stdc++.h>\nint main(){std::cout<<CUSTOM_BEFORE_BITS;}'),r=>{assert.equal(r.error,'');assert.equal(r.stdout,'42');assert.equal(r.precompiledHeaders,false);}],
  ['stdout-with-optional-out',project('#include <cstdio>\nint main(){puts("Hello bro!");}',{outputFile:'Project.OUT'}),r=>{assert.equal(r.error,'');assert.equal(r.stdout,'Hello bro!\n');assert.equal(r.exitCode,0);assert.ok(r.outputNote);}],
  ['pch-shadow-fallback',project('#include <bits/stdc++.h>\nint main(){return shadow;}',{files:[{path:'main.cpp',content:'#include <bits/stdc++.h>\nint main(){return shadow;}'},{path:'bits/stdc++.h',content:'constexpr int shadow=17;'}]}),r=>{assert.equal(r.error,'');assert.equal(r.exitCode,17);assert.equal(r.precompiledHeaders,false);}],
  ['stdin-unicode', project('#include <iostream>\n#include <string>\nint main(){std::string s; std::getline(std::cin,s); std::cout<<s<<"\\n";}', {stdin:'Xin chào Việt Nam\n'}),r=>{assert.equal(r.error,'');assert.equal(r.stdout,'Xin chào Việt Nam\n');}],
  ['inp-out', project('#include <bits/stdc++.h>\nusing namespace std;int main(){freopen("BAI.INP","r",stdin);freopen("BAI.OUT","w",stdout);long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}',{stdin:'1000000000 999999999\n',inputFile:'BAI.INP',outputFile:'BAI.OUT'}),r=>{assert.equal(r.error,'');assert.equal(r.files['BAI.OUT'],'1999999999\n');assert.equal(r.stdout,'');}],
  ['multi-file',project('#include <iostream>\n#include "math.h"\nint main(){std::cout<<sum(20,22);}',{files:[{path:'main.cpp',content:'#include <iostream>\n#include "math.h"\nint main(){std::cout<<sum(20,22);}'},{path:'math.h',content:'int sum(int,int);'},{path:'math.cpp',content:'#include "math.h"\nint sum(int a,int b){return a+b;}'}]}),r=>{assert.equal(r.error,'');assert.equal(r.stdout,'42');}],
  ['active-solution',project('',{entryFile:'solution.cpp',files:[{path:'main.cpp',content:'int main(){return 99;}'},{path:'solution.cpp',content:'#include <cstdio>\n#include "helper.cpp"\nint main(){printf("%d",answer());}'},{path:'helper.cpp',content:'int answer(){return 42;}'}]}),r=>{assert.equal(r.error,'');assert.equal(r.stdout,'42');assert.equal(r.exitCode,0);}],
  ['duplicate-main-project',project('',{files:[{path:'a.cpp',content:'int main(){return 1;}'},{path:'b.cpp',content:'int main(){return 2;}'}]}),r=>{assert.equal(r.error,'Linking failed');assert.match(r.buildLog,/duplicate symbol/);}],
  ['missing-entry',project('int main(){}',{entryFile:'missing.cpp'}),r=>assert.match(r.error,/Entry file not found/)],
  ['compile-error',project('int main() { broken syntax; }'),r=>{assert.match(r.error,/Compilation/);assert.match(r.buildLog,/main.cpp:1:/);assert.equal(r.phase,'compile');}],
  ['time-limit',project('int main(){volatile int x=0;for(;;){x++;}}',{timeLimitMs:100}),r=>{assert.match(r.error,/Time limit/);assert.equal(r.phase,'run');assert.ok(r.runMs<5000);}],
  ['memory-bounds',project('int main(){volatile int *p=(int*)0x7ffffffc;*p=42;}'),r=>{assert.match(r.error,/out of bounds memory/i);assert.equal(r.phase,'run');}],
  ['path-boundary',project('',{files:[{path:'../outside.cpp',content:'int main(){}'}]}),r=>assert.match(r.error,/Invalid project path/)],
];
await mkdir('artifacts/native-tests',{recursive:true});
let failures=0;
for(const [name,request,check] of tests){
  const filename=`artifacts/native-tests/${name}.json`;await writeFile(filename,JSON.stringify(request));
  try{const {stdout}=await exec(binary,['public/toolchain',filename],{timeout:240000,maxBuffer:4*1024*1024});const r=JSON.parse(stdout);await writeFile(`artifacts/native-tests/${name}.result.json`,JSON.stringify(r,null,2));check(r);console.log(`PASS ${name}: compile ${Math.round(r.compileMs)}ms, run ${Math.round(r.runMs)}ms`);}
  catch(e){failures++;console.error(`FAIL ${name}: ${e.message}`);}
}

// Same-process requests exercise the cache used by the mobile plugin, including
// input-only reruns, fresh OUT files, header invalidation and failed builds.
try {
  const base=project('#include <bits/stdc++.h>\n#include "answer.h"\n#warning cache-warning\nusing namespace std;int main(){int x;cin>>x;if(x>0)freopen("BAI.OUT","w",stdout);cout<<x+answer;} ',{
    entryFile:'main.cpp',stdin:'2',outputFile:'BAI.OUT'
  });
  base.files.push({path:'answer.h',content:'constexpr int answer=40;'}, {path:'BAI.OUT',content:'stale result'});
  const changed=JSON.parse(JSON.stringify(base));changed.files[1].content='constexpr int answer=41;';
  const broken=JSON.parse(JSON.stringify(changed));broken.files[0].content='int main(){broken syntax;}';
  const generated=JSON.parse(JSON.stringify(base));generated.files[2].content='42';generated.stdin='-1';
  const sequence=[base,generated,changed,broken,{...changed,stdin:'-2'}, {...changed,entryFile:'missing.cpp'}];
  const paths=[];
  for(let i=0;i<sequence.length;i++){const path=`artifacts/native-tests/cache-${i}.json`;await writeFile(path,JSON.stringify(sequence[i]));paths.push(path);}
  const {stdout}=await exec(binary,['public/toolchain',...paths],{timeout:240000,maxBuffer:8*1024*1024});
  const r=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  await writeFile('artifacts/native-tests/cache-sequence.result.json',JSON.stringify(r,null,2));
  assert.equal(r.length,6);
  assert.equal(r[0].cacheHit,false);assert.equal(r[0].files['BAI.OUT'],'42');
  assert.equal(r[1].cacheHit,true);assert.equal(r[1].error,'');assert.equal(r[1].stdout,'39');assert.deepEqual(r[1].files,{});assert.ok(r[1].outputNote);assert.equal(r[1].buildLog,r[0].buildLog);
  assert.equal(r[2].cacheHit,false);assert.equal(r[2].files['BAI.OUT'],'43');
  assert.match(r[3].error,/Compilation/);assert.equal(r[3].cacheHit,false);
  assert.equal(r[4].cacheHit,true);assert.equal(r[4].stdout,'39');assert.equal(r[4].exitCode,0);
  assert.equal(r[5].cacheHit,false);assert.match(r[5].error,/Entry file not found/);
  await writeFile('artifacts/native-tests/cache-sequence.result.json',JSON.stringify(r,null,2));
  console.log(`PASS cache/output regression: cold ${Math.round(r[0].compileMs)}ms, cached ${Math.round(r[1].compileMs)}ms; header edit ${Math.round(r[2].compileMs)}ms`);
} catch(e){failures++;console.error(`FAIL cache/output regression: ${e.message}`);}
if(failures)process.exitCode=1;
