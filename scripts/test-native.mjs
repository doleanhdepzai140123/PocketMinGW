import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const binary = process.argv[2] ?? (process.platform === 'win32' ? 'native/build/Release/pocket-cli.exe' : 'native/build/pocket-cli');
const project = (code, rest = {}) => ({files:[{path:'main.cpp',content:code}],stdin:'',timeLimitMs:3000,...rest});
const tests = [
  ['c++17-stl', project('#include <bits/stdc++.h>\nusing namespace std; int main(){vector<int>a={3,1,2};sort(a.begin(),a.end());auto[x,y]=pair{8,12};optional<int>z=gcd(x,y);for(int v:a)cout<<v;cout<<" "<<*z<<"\\n";}'), r=>{assert.equal(r.error,'');assert.equal(r.stdout,'123 4\n');}],
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
if(failures)process.exitCode=1;
