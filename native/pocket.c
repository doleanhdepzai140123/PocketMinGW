// PocketMinGW interpreter bridge. No JIT, executable mappings, process spawning,
// host filesystem imports, sockets, or dynamic code loading are exposed to guests.
#include "pocket.h"
#include "wasm3.h"
#include "m3_config.h"
#if d_m3GuardedMemory || d_m3SkipMemoryBoundsCheck
#error PocketMinGW requires software bounds checks and bounded address-space allocation
#endif
#include "cJSON.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <stdatomic.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <sys/time.h>
#endif

#define OUTPUT_LIMIT (1024 * 1024)
#define FILE_LIMIT (2 * 1024 * 1024)
#define CHECK(expr) do { const char *e_ = (expr); if (e_) return e_; } while (0)
typedef struct {
  IM3Environment env;
  IM3Runtime fsrt, apprt;
  IM3Module fsmod, appmod;
  uint8_t *fsbytes, *appbytes;
  size_t fslen, applen;
  int pch_used;
  const char **argv; int argc, exit_code;
  const char *input; size_t input_pos, input_len;
  char *output; size_t output_len;
  char error_detail[512];
  uint32_t fd_map[1024];
  double deadline;
} Engine;
static atomic_bool cancelled = 0;
static atomic_bool busy = 0;
static _Thread_local Engine *active_engine;
static const char *EXIT_TRAP = "pocket: exit";

static double now_ms(void) {
#ifdef _WIN32
  LARGE_INTEGER a,b; QueryPerformanceCounter(&a); QueryPerformanceFrequency(&b);
  return (double)a.QuadPart * 1000.0 / (double)b.QuadPart;
#else
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1000.0 + ts.tv_nsec / 1000000.0;
#endif
}
// Both interpreter runtimes call this at function entries and loop back edges.
M3Result pocket_yield(void) {
  if (atomic_load(&cancelled)) return "Cancelled";
  if (active_engine && now_ms() > active_engine->deadline) return "Time limit exceeded";
  return NULL;
}
void pocket_cancel(void) { atomic_store(&cancelled, 1); }
void pocket_free(void *p) { free(p); }

static uint8_t *memory(IM3Module m, uint32_t offset, size_t len) {
  size_t size = 0; uint8_t *p = m3_GetMemory(m, &size, 0);
  if (!p || offset > size || len > size - offset) return NULL;
  return p + offset;
}
static uint32_t get32(const void *p) { uint32_t v; memcpy(&v,p,4); return v; }
static void put32(void *p,uint32_t v) { memcpy(p,&v,4); }
static const char *append(Engine *e, const void *data, size_t len) {
  if (len > OUTPUT_LIMIT - e->output_len) return "Output limit exceeded (1 MiB)";
  memcpy(e->output + e->output_len,data,len); e->output_len += len;
  e->output[e->output_len] = 0; return NULL;
}
static const char *invoke(IM3Runtime rt, const char *name, uint32_t n, uint64_t *values, uint32_t *result) {
  IM3Function f; CHECK(m3_FindFunction(&f,rt,name));
  const void *args[12]; if(n>12) return "Too many WASI arguments";
  for(uint32_t i=0;i<n;i++) args[i]=&values[i];
  CHECK(m3_Call(f,n,args));
  if(result) { uint64_t v=0; const void *ret[] = {&v}; CHECK(m3_GetResults(f,1,ret)); *result=(uint32_t)v; }
  return NULL;
}
static const char *pathbuf(Engine *e,const char *path,uint32_t *len) {
  uint32_t at,cap; CHECK(invoke(e->fsrt,"GetPathBuf",0,NULL,&at));
  CHECK(invoke(e->fsrt,"GetPathBufLen",0,NULL,&cap));
  *len=(uint32_t)strlen(path); if(*len>=cap) return "Path is too long";
  uint8_t *p=memory(e->fsmod,at,*len+1); if(!p) return "Invalid filesystem memory";
  memcpy(p,path,*len+1); return NULL;
}
static const char *add_dir(Engine *e,const char *path) {
  uint32_t n; CHECK(pathbuf(e,path,&n)); uint64_t args[]={n};
  return invoke(e->fsrt,"AddDirectoryNode",1,args,NULL);
}
static const char *add_file(Engine *e,const char *path,const void *data,size_t size) {
  uint32_t n,inode,at; CHECK(pathbuf(e,path,&n)); uint64_t args[]={n,size};
  CHECK(invoke(e->fsrt,"AddFileNode",2,args,&inode)); uint64_t node[]={inode};
  CHECK(invoke(e->fsrt,"GetFileNodeAddress",1,node,&at));
  uint8_t *p=memory(e->fsmod,at,size); if(!p) return "Invalid file buffer";
  if(size) memcpy(p,data,size); return NULL;
}
static const char *read_file(Engine *e,const char *path,uint8_t **data,size_t *size) {
  uint32_t n,inode,at,len; CHECK(pathbuf(e,path,&n)); uint64_t args[]={n};
  // The pinned memfs FindNode asserts lookup.node instead of returning ENOENT.
  // Translate only that lookup trap; errors reading an existing node still fail.
  const char *lookup=invoke(e->fsrt,"FindNode",1,args,&inode);
  if(lookup&&!strcmp(lookup,"[trap] unreachable"))return "File not found";
  if(lookup)return lookup;if(inode==0 || inode==UINT32_MAX) return "File not found";
  uint64_t node[]={inode}; CHECK(invoke(e->fsrt,"GetFileNodeAddress",1,node,&at));
  CHECK(invoke(e->fsrt,"GetFileNodeSize",1,node,&len));
  uint8_t *p=memory(e->fsmod,at,len); if(!p) return "Invalid file result";
  *data=malloc((size_t)len+1); if(!*data) return "Out of memory";
  memcpy(*data,p,len); (*data)[len]=0; *size=len; return NULL;
}

m3ApiRawFunction(copy_out) {
  m3ApiGetArg(uint32_t,dst); m3ApiGetArg(uint32_t,src); m3ApiGetArg(uint32_t,n);
  Engine *e=m3_GetUserData(runtime); uint8_t *a=memory(e->appmod,dst,n),*b=memory(e->fsmod,src,n);
  if(!a||!b) return "Memory access out of bounds"; memcpy(a,b,n); return NULL;
}
m3ApiRawFunction(copy_in) {
  m3ApiGetArg(uint32_t,dst); m3ApiGetArg(uint32_t,src); m3ApiGetArg(uint32_t,n);
  Engine *e=m3_GetUserData(runtime); uint8_t *a=memory(e->fsmod,dst,n),*b=memory(e->appmod,src,n);
  if(!a||!b) return "Memory access out of bounds"; memcpy(a,b,n); return NULL;
}
m3ApiRawFunction(fs_log) { return NULL; }
m3ApiRawFunction(host_write) {
  m3ApiReturnType(uint32_t); m3ApiGetArg(uint32_t,fd); m3ApiGetArg(uint32_t,iovs);
  m3ApiGetArg(uint32_t,count); m3ApiGetArg(uint32_t,out);
  Engine *e=m3_GetUserData(runtime); uint32_t total=0;
  if(fd!=1&&fd!=2) m3ApiReturn(8);
  if(count>65536) return "Too many output buffers";
  for(uint32_t i=0;i<count;i++) {
    uint8_t *v=memory(e->appmod,iovs+i*8,8); if(!v) return "Invalid output vector";
    uint32_t n=get32(v+4); uint8_t *p=memory(e->appmod,get32(v),n); if(!p) return "Invalid output memory";
    CHECK(append(e,p,n)); total+=n;
  }
  uint8_t *p=memory(e->appmod,out,4); if(!p) return "Invalid write result"; put32(p,total); m3ApiReturn(0);
}
m3ApiRawFunction(host_read) {
  m3ApiReturnType(uint32_t); m3ApiGetArg(uint32_t,fd); m3ApiGetArg(uint32_t,iovs);
  m3ApiGetArg(uint32_t,count); m3ApiGetArg(uint32_t,out);
  Engine *e=m3_GetUserData(runtime); uint32_t total=0; if(fd!=0) m3ApiReturn(8);
  if(count>65536) return "Too many input buffers";
  for(uint32_t i=0;i<count;i++) {
    uint8_t *v=memory(e->appmod,iovs+i*8,8); if(!v) return "Invalid input vector";
    size_t n=get32(v+4),left=e->input_len-e->input_pos; if(n>left)n=left;
    uint8_t *p=memory(e->appmod,get32(v),n); if(!p) return "Invalid input memory";
    memcpy(p,e->input+e->input_pos,n); e->input_pos+=n; total+=(uint32_t)n;
  }
  uint8_t *p=memory(e->appmod,out,4); if(!p)return "Invalid read result"; put32(p,total); m3ApiReturn(0);
}
m3ApiRawFunction(forward_fs) {
  Engine *e=m3_GetUserData(runtime); IM3Function f=(IM3Function)_ctx->userdata;
  uint32_t n=m3_GetArgCount(f),r=m3_GetRetCount(f); const void *args[12];
  uint64_t values[12]; const char *name=m3_GetFunctionName(f);
  if(n>12||r>1) return "Invalid filesystem signature";
  for(uint32_t i=0;i<n;i++){values[i]=_sp[r+i];args[i]=&values[i];}
  if(strncmp(name,"fd_",3)==0&&n) { uint32_t fd=(uint32_t)values[0]; if(fd>=1024||e->fd_map[fd]==UINT32_MAX){_sp[0]=8;return NULL;} values[0]=e->fd_map[fd]; }
  CHECK(m3_Call(f,n,args)); if(r){_sp[0]=0;const void *ret[]={&_sp[0]}; CHECK(m3_GetResults(f,1,ret));}
  if(_sp[0]==0 && strcmp(name,"path_open")==0) {
    uint8_t *at=memory(e->appmod,(uint32_t)values[n-1],4);if(!at)return "Invalid opened descriptor";uint32_t fd=get32(at);if(fd<1024)e->fd_map[fd]=fd;
  }
  if(_sp[0]==0 && strcmp(name,"fd_close")==0) { uint32_t fd=(uint32_t)_sp[r];if(fd<1024)e->fd_map[fd]=UINT32_MAX; }
  return NULL;
}
m3ApiRawFunction(fd_renumber) {
  m3ApiReturnType(uint32_t); m3ApiGetArg(uint32_t,from); m3ApiGetArg(uint32_t,to);
  Engine *e=m3_GetUserData(runtime);if(from>=1024||to>=1024||e->fd_map[from]==UINT32_MAX)m3ApiReturn(8);
  if(from!=to){
    if(e->fd_map[to]>=3&&e->fd_map[to]!=UINT32_MAX){uint64_t a[]={e->fd_map[to]};uint32_t ignored;CHECK(invoke(e->fsrt,"fd_close",1,a,&ignored));}
    e->fd_map[to]=e->fd_map[from];e->fd_map[from]=UINT32_MAX;
  }m3ApiReturn(0);
}
m3ApiRawFunction(proc_exit) { m3ApiGetArg(uint32_t,code); Engine *e=m3_GetUserData(runtime); e->exit_code=(int)code; return EXIT_TRAP; }
m3ApiRawFunction(args_sizes) {
  m3ApiReturnType(uint32_t); m3ApiGetArgMem(uint32_t*,a); m3ApiGetArgMem(uint32_t*,b);
  m3ApiCheckMem(a,4); m3ApiCheckMem(b,4); Engine *e=m3_GetUserData(runtime); uint32_t n=0;
  for(int i=0;i<e->argc;i++) n+=(uint32_t)strlen(e->argv[i])+1; put32(a,e->argc); put32(b,n); m3ApiReturn(0);
}
m3ApiRawFunction(args_get) {
  m3ApiReturnType(uint32_t); m3ApiGetArg(uint32_t,ptr); m3ApiGetArg(uint32_t,buf); Engine *e=m3_GetUserData(runtime);
  for(int i=0;i<e->argc;i++) { size_t n=strlen(e->argv[i])+1; uint8_t *a=memory(e->appmod,ptr+i*4,4),*b=memory(e->appmod,buf,n);
    if(!a||!b)return "Invalid argument memory"; put32(a,buf); memcpy(b,e->argv[i],n); buf+=(uint32_t)n; } m3ApiReturn(0);
}
m3ApiRawFunction(env_sizes) {
  m3ApiReturnType(uint32_t); m3ApiGetArgMem(uint32_t*,a); m3ApiGetArgMem(uint32_t*,b); m3ApiCheckMem(a,4); m3ApiCheckMem(b,4); put32(a,0); put32(b,0); m3ApiReturn(0);
}
m3ApiRawFunction(env_get) { m3ApiReturnType(uint32_t); m3ApiReturn(0); }
m3ApiRawFunction(clock_get) {
  m3ApiReturnType(uint32_t); m3ApiGetArg(uint32_t,id); m3ApiGetArg(uint64_t,precision); m3ApiGetArgMem(uint64_t*,p);
  m3ApiCheckMem(p,8); uint64_t t=(uint64_t)(now_ms()*1000000.0); memcpy(p,&t,8); m3ApiReturn(0);
}
m3ApiRawFunction(random_get) {
  m3ApiReturnType(uint32_t); m3ApiGetArgMem(uint8_t*,p); m3ApiGetArg(uint32_t,n); m3ApiCheckMem(p,n);
  // This runtime's random source is for algorithms, not cryptography.
  for(uint32_t i=0;i<n;i++)p[i]=(uint8_t)rand(); m3ApiReturn(0);
}
m3ApiRawFunction(not_supported) { m3ApiReturnType(uint32_t); m3ApiReturn(52); }

static const char *load_bytes(const char *dir,const char *name,uint8_t **bytes,size_t *size) {
  char path[4096]; if(snprintf(path,sizeof(path),"%s/%s",dir,name)>=(int)sizeof(path))return "Toolchain path too long";
  FILE *f=fopen(path,"rb"); if(!f)return "Bundled toolchain asset missing";
  fseek(f,0,SEEK_END); long n=ftell(f); rewind(f); if(n<0||n>100000000){fclose(f);return "Invalid toolchain asset size";}
  *bytes=malloc((size_t)n); if(!*bytes){fclose(f);return "Out of memory";}
  *size=fread(*bytes,1,n,f); fclose(f); if(*size!=(size_t)n)return "Cannot read toolchain asset"; return NULL;
}
static const char *load_module(Engine *e,IM3Runtime *rt,IM3Module *mod,uint8_t *bytes,size_t n,size_t limit) {
  *rt=m3_NewRuntime(e->env,2*1024*1024,e); if(!*rt)return "Cannot create interpreter";
  CHECK(m3_SetResourceLimit(*rt,c_m3Limit_MemoryBytes,limit));
  CHECK(m3_ParseModule(e->env,mod,bytes,(uint32_t)n));
  const char *err=m3_LoadModule(*rt,*mod); if(err) return err; return NULL;
}
static const char *init_fs(Engine *e,const char *dir) {
  e->env=m3_NewEnvironment(); if(!e->env)return "Cannot create interpreter environment";
  CHECK(load_bytes(dir,"memfs.wasm",&e->fsbytes,&e->fslen));
  CHECK(load_module(e,&e->fsrt,&e->fsmod,e->fsbytes,e->fslen,256*1024*1024));
  CHECK(m3_LinkRawFunction(e->fsmod,"env","copy_out","v(iii)",copy_out));
  CHECK(m3_LinkRawFunction(e->fsmod,"env","copy_in","v(iii)",copy_in));
  CHECK(m3_LinkRawFunction(e->fsmod,"env","host_write","i(iiii)",host_write));
  CHECK(m3_LinkRawFunction(e->fsmod,"env","host_read","i(iiii)",host_read));
  CHECK(m3_LinkRawFunction(e->fsmod,"env","memfs_log","v(ii)",fs_log));
  return invoke(e->fsrt,"init",0,NULL,NULL);
}
static const char *untar(Engine *e,const char *dir) {
  uint8_t *tar=NULL;size_t size=0; const char *err=load_bytes(dir,"sysroot.tar",&tar,&size); if(err)return err;
  for(size_t p=0;p+512<=size && tar[p];) {
    char name[256]={0},oct[13]={0};memcpy(name,tar+p,100);memcpy(oct,tar+p+124,12);size_t n=(size_t)strtoul(oct,NULL,8);
    if(n>size-p-512){err="Invalid sysroot archive";break;}
    if(tar[p+156]=='5')err=add_dir(e,name); else if(tar[p+156]=='0'||tar[p+156]==0)err=add_file(e,name,tar+p+512,n);
    if(err)break;p+=512+((n+511)/512)*512;
  }free(tar);return err;
}
static const char *link_optional(IM3Module m,const char *name,const char *sig,M3RawCall f) {
  const char *r=m3_LinkRawFunction(m,"wasi_unstable",name,sig,f);return r==m3Err_functionLookupFailed?NULL:r;
}
static const char *execute(Engine *e,uint8_t *bytes,size_t n,const char **argv,int argc,size_t limit) {
  e->argv=argv;e->argc=argc;e->exit_code=0;
  for(uint32_t i=0;i<1024;i++)e->fd_map[i]=i;
  CHECK(load_module(e,&e->apprt,&e->appmod,bytes,n,limit));
  const char *names[]={"fd_allocate","fd_close","fd_fdstat_get","fd_fdstat_set_flags","fd_filestat_get","fd_filestat_set_size","fd_pread","fd_prestat_dir_name","fd_prestat_get","fd_read","fd_readdir","fd_seek","fd_write","path_create_directory","path_filestat_get","path_open","path_readlink","path_remove_directory","path_rename","path_symlink","path_unlink_file"};
  for(size_t i=0;i<sizeof(names)/sizeof(names[0]);i++) {
    IM3Function f; CHECK(m3_FindFunction(&f,e->fsrt,names[i]));
    char sig[40];uint32_t ret=m3_GetRetCount(f),args=m3_GetArgCount(f);sig[0]=ret?'i':'v';sig[1]='(';
    for(uint32_t j=0;j<args;j++)sig[j+2]=m3_GetArgType(f,j)==c_m3Type_i64?'I':'i';sig[args+2]=')';sig[args+3]=0;
    const char *r=m3_LinkRawFunctionEx(e->appmod,"wasi_unstable",names[i],sig,forward_fs,f);
    if(r && r!=m3Err_functionLookupFailed)return r;
  }
  CHECK(link_optional(e->appmod,"proc_exit","v(i)",proc_exit));
  CHECK(link_optional(e->appmod,"fd_renumber","i(ii)",fd_renumber));
  CHECK(link_optional(e->appmod,"args_sizes_get","i(ii)",args_sizes));CHECK(link_optional(e->appmod,"args_get","i(ii)",args_get));
  CHECK(link_optional(e->appmod,"environ_sizes_get","i(ii)",env_sizes));CHECK(link_optional(e->appmod,"environ_get","i(ii)",env_get));
  CHECK(link_optional(e->appmod,"clock_time_get","i(iIi)",clock_get));CHECK(link_optional(e->appmod,"random_get","i(ii)",random_get));
  CHECK(link_optional(e->appmod,"poll_oneoff","i(iiii)",not_supported));
  const char *r=invoke(e->apprt,"_start",0,NULL,NULL); if(r==EXIT_TRAP)r=NULL;
  if(r) { M3ErrorInfo info={0}; m3_GetErrorInfo(e->apprt,&info); if(info.message && *info.message) { snprintf(e->error_detail,sizeof(e->error_detail),"%s: %s",r,info.message); r=e->error_detail; } }
  m3_FreeRuntime(e->apprt);e->apprt=NULL;e->appmod=NULL;return r;
}
static int safe_path(const char *p) {
  if(!p||!*p||strlen(p)>200||p[0]=='/'||strchr(p,'\\')||strchr(p,':'))return 0;
  const char *s=p;for(const char *q=p;;q++)if(*q=='/'||!*q){size_t n=q-s;if(!n||(n==1&&s[0]=='.')||(n==2&&s[0]=='.'&&s[1]=='.'))return 0;if(!*q)break;s=q+1;}
  for(const unsigned char *q=(const unsigned char*)p;*q;q++)if(*q<32)return 0;return 1;
}
static const char *string(cJSON *o,const char *key,const char *fallback) {cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);return cJSON_IsString(v)?v->valuestring:fallback;}
static int number(cJSON *o,const char *key,int fallback,int low,int high){cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);int n=cJSON_IsNumber(v)?v->valueint:fallback;return n<low?low:n>high?high:n;}
static const char *project_files(Engine *e,cJSON *request,const char *omit) {
  cJSON *files=cJSON_GetObjectItemCaseSensitive(request,"files"),*f; if(!cJSON_IsArray(files)||cJSON_GetArraySize(files)>100)return "Expected at most 100 project files";
  size_t total=0;cJSON_ArrayForEach(f,files){const char *p=string(f,"path",""),*data=string(f,"content","");
    if(!safe_path(p))return "Invalid project path";if(strncmp(p,"include/",8)==0||strncmp(p,"lib/",4)==0||strncmp(p,".pocket",7)==0)return "Reserved runtime path";
    size_t n=strlen(data);total+=n;if(n>FILE_LIMIT||total>10*FILE_LIMIT)return "Project file limit exceeded";
    char dir[256];strcpy(dir,p);for(char *c=dir;*c;c++)if(*c=='/'){*c=0;CHECK(add_dir(e,dir));*c='/';}
    if(!omit||strcmp(p,omit))CHECK(add_file(e,p,data,n));}return NULL;
}
// Shared options keep the bundled PCH and normal compilation compatible.
#define CLANG_COMMON "-isysroot","/","-internal-isystem","/include/c++/v1","-internal-isystem","/include","-internal-isystem","/lib/clang/8.0.1/include","-I",".","-std=c++17","-O2","-Wall","-Wextra","-ferror-limit","8"
static const char *install_headers(Engine *e,const char *dir) {
  CHECK(untar(e,dir));
  uint8_t *bits=NULL;size_t bits_size=0;CHECK(load_bytes(dir,"stdc++.h",&bits,&bits_size));
  const char *r=add_dir(e,"include/bits");if(!r)r=add_file(e,"include/bits/stdc++.h",bits,bits_size);free(bits);if(r)return r;
  return NULL;
}
// Only inject a PCH when bits/stdc++.h is the very first source directive.
// Macro customizations/preambles retain the normal preprocessing path.
static int starts_with_bits(const char *source) {
  source+=strspn(source," \r\n\t");
  const char *forms[]={"#include <bits/stdc++.h>","#include<bits/stdc++.h>"};
  for(int i=0;i<2;i++){size_t n=strlen(forms[i]);if(!strncmp(source,forms[i],n)){
    const char *tail=source+n;tail+=strspn(tail," \t\r");if(!*tail||*tail=='\n')return 1;}}
  return 0;
}
static int pch_project_safe(cJSON *req) {
  // A project can shadow standard headers via -I. Fall back conservatively
  // for .h/extensionless/custom files rather than change preprocessing semantics.
  cJSON *f;cJSON_ArrayForEach(f,cJSON_GetObjectItemCaseSensitive(req,"files")){
    const char *ext=strrchr(string(f,"path",""),'.');
    if(!ext||(strcmp(ext,".cpp")&&strcmp(ext,".cc")&&strcmp(ext,".cxx")&&strcmp(ext,".hpp")&&strcmp(ext,".INP")&&strcmp(ext,".OUT")&&strcmp(ext,".inp")&&strcmp(ext,".out")&&strcmp(ext,".txt")))return 0;
  }return 1;
}
static const char *compile(Engine *e,const char *dir,cJSON *req,uint8_t **program,size_t *program_size) {
  const char *entry=string(req,"entryFile","");
  if(*entry) {
    if(!safe_path(entry))return "Invalid entry file";
    cJSON *item;int found=0;cJSON_ArrayForEach(item,cJSON_GetObjectItemCaseSensitive(req,"files"))if(strcmp(string(item,"path",""),entry)==0)found=1;
    if(!found)return "Entry file not found in project";
  }
  CHECK(install_headers(e,dir));CHECK(project_files(e,req,string(req,"outputFile","")));
  CHECK(load_bytes(dir,"clang.wasm",&e->appbytes,&e->applen));
  cJSON *files=cJSON_GetObjectItemCaseSensitive(req,"files"),*f;int count=0;char objects[100][32];const char *objptrs[100];
  cJSON_ArrayForEach(f,files){const char *p=string(f,"path","");const char *ext=strrchr(p,'.');if(!ext||(strcmp(ext,".cpp")&&strcmp(ext,".cc")&&strcmp(ext,".cxx")))continue;
    if(*entry&&strcmp(p,entry)!=0)continue;
    snprintf(objects[count],32,".pocket%d.o",count);objptrs[count]=objects[count];
    const char *base[]={"clang","-cc1","-emit-obj",CLANG_COMMON,"-o",objects[count],"-x","c++",p};
    const char *args[40];int argn=sizeof(base)/sizeof(base[0]);for(int a=0;a<argn;a++)args[a]=base[a];
    if(pch_project_safe(req)&&starts_with_bits(string(f,"content",""))){
      uint8_t *pch=NULL;size_t pch_size=0;
      if(!load_bytes(dir,"stdc++.pch",&pch,&pch_size)){
        const char *install=add_file(e,".pocket-stdc++.pch",pch,pch_size);free(pch);if(install)return install;
        args[argn++]="-include-pch";args[argn++]=".pocket-stdc++.pch";e->pch_used=1;
      }
    }
    CHECK(execute(e,e->appbytes,e->applen,args,argn,512*1024*1024));if(e->exit_code)return "Compilation failed";count++;
  }free(e->appbytes);e->appbytes=NULL;if(!count)return "Project has no C++ source file";
  CHECK(load_bytes(dir,"lld.wasm",&e->appbytes,&e->applen));
  const char *args[128]={"wasm-ld","--no-threads","-z","stack-size=4194304","--max-memory=134217728","-Llib/wasm32-wasi","lib/wasm32-wasi/crt1.o"};int argc=7;
  for(int i=0;i<count;i++)args[argc++]=objptrs[i];args[argc++]="-lc";args[argc++]="-lc++";args[argc++]="-lc++abi";args[argc++]="lib/clang/8.0.1/lib/wasi/libclang_rt.builtins-wasm32.a";args[argc++]="-o";args[argc++]=".pocket.wasm";
  CHECK(execute(e,e->appbytes,e->applen,args,argc,512*1024*1024));if(e->exit_code)return "Linking failed";
  free(e->appbytes);e->appbytes=NULL;return read_file(e,".pocket.wasm",program,program_size);
}
static void cleanup(Engine *e) {
  if(e->apprt)m3_FreeRuntime(e->apprt);if(e->fsrt)m3_FreeRuntime(e->fsrt);if(e->env)m3_FreeEnvironment(e->env);
  free(e->appbytes);free(e->fsbytes);free(e->output);memset(e,0,sizeof(*e));
}
#ifdef POCKET_BUILD_TOOLS
// Build hosts generate this with the same interpreted WASM compiler as the app.
// Only the data artifact ships; this host-file writer is absent from mobile builds.
int pocket_prepare_pch(const char *dir,const char *destination) {
  Engine e={0};e.deadline=now_ms()+180000;active_engine=&e;e.input="";e.output=calloc(OUTPUT_LIMIT+1,1);
  const char *err=e.output?init_fs(&e,dir):"Out of memory";
  if(!err)err=install_headers(&e,dir);
  if(!err)err=load_bytes(dir,"clang.wasm",&e.appbytes,&e.applen);
  const char *args[]={"clang","-cc1","-emit-pch",CLANG_COMMON,"-fno-pch-timestamp","-o",".pocket-stdc++.pch","-x","c++-header","/include/bits/stdc++.h"};
  if(!err)err=execute(&e,e.appbytes,e.applen,args,sizeof(args)/sizeof(args[0]),512*1024*1024);
  if(!err&&e.exit_code)err="PCH compilation failed";
  uint8_t *data=NULL;size_t size=0;if(!err)err=read_file(&e,".pocket-stdc++.pch",&data,&size);
  if(!err){FILE *out=fopen(destination,"wb");if(!out)err="Cannot write PCH";else{if(fwrite(data,1,size,out)!=size)err="Incomplete PCH write";if(fclose(out))err="Cannot close PCH";}}
  if(err)fprintf(stderr,"%s\n%s\n",err,e.output?e.output:"");else printf("Prepared PCH: %zu bytes\n",size);
  free(data);cleanup(&e);active_engine=NULL;return err?1:0;
}
#endif
// One bounded, process-local cache of WASM bytecode, never executable/JIT memory.
// Exact keys include every compile input, entry and toolchain directory. The
// configured OUT is a generated result, excluded from BOTH compiler FS and key.
// Changing that filename changes the key. Run input/limits do not affect it.
// Access is serialized by busy. A cache allocation failure only disables caching.
static char *cached_key=NULL,*cached_log=NULL;
static uint8_t *cached_program=NULL;
static size_t cached_size=0;
static char *compile_key(const char *dir,cJSON *req) {
  cJSON *files=cJSON_GetObjectItemCaseSensitive(req,"files"),*f;
  if(!cJSON_IsArray(files)||cJSON_GetArraySize(files)>100)return NULL;
  size_t total=0;
  cJSON_ArrayForEach(f,files){const char *s=string(f,"content","");total+=strlen(s);
    if(total>10*FILE_LIMIT||strstr(s,"__TIME__")||strstr(s,"__DATE__")||strstr(s,"__TIMESTAMP__"))return NULL;}
  cJSON *key=cJSON_CreateArray();cJSON_AddItemToArray(key,cJSON_CreateString(dir));
  cJSON_AddItemToArray(key,cJSON_CreateString(string(req,"entryFile","")));
  const char *out=string(req,"outputFile","");cJSON_AddItemToArray(key,cJSON_CreateString(out));
  cJSON *inputs=cJSON_CreateArray();cJSON_AddItemToArray(key,inputs);
  cJSON_ArrayForEach(f,files)if(strcmp(string(f,"path",""),out))cJSON_AddItemReferenceToArray(inputs,f);
  char *text=cJSON_PrintUnformatted(key);cJSON_Delete(key);return text;
}
static void cache_program(char **key,const uint8_t *program,size_t size,const char *log) {
  if(!*key||size>16*1024*1024)return;
  uint8_t *copy=malloc(size);char *logs=malloc(strlen(log)+1);
  if(!copy||!logs){free(copy);free(logs);return;}
  memcpy(copy,program,size);strcpy(logs,log);
  free(cached_key);free(cached_program);free(cached_log);
  cached_key=*key;*key=NULL;cached_program=copy;cached_size=size;cached_log=logs;
}
char *pocket_run(const char *dir,const char *json) {
  if(atomic_exchange(&busy,1))return cJSON_PrintUnformatted(cJSON_CreateString("Runtime is busy"));
  atomic_store(&cancelled,0);Engine e={0};e.deadline=now_ms()+180000;active_engine=&e;e.input="";
  e.output=calloc(OUTPUT_LIMIT+1,1);cJSON *req=cJSON_Parse(json),*result=cJSON_CreateObject();
  const char *err=NULL,*phase="compile";uint8_t *program=NULL;size_t program_size=0;double start=now_ms(),run_start=0,run_ms=0;
  if(!req||!cJSON_IsObject(req))err="Invalid request";else if(!e.output)err="Out of memory";
  char *key=!err?compile_key(dir,req):NULL;int cache_hit=0;
  if(!err&&key&&cached_key&&!strcmp(key,cached_key)){
    program=malloc(cached_size);if(program){memcpy(program,cached_program,cached_size);program_size=cached_size;cache_hit=1;}
  }
  if(!err&&!cache_hit){if(!err)err=init_fs(&e,dir);if(!err)err=compile(&e,dir,req,&program,&program_size);
    if(!err)cache_program(&key,program,program_size,e.output?e.output:"");}
  free(key);
  cJSON_AddBoolToObject(result,"cacheHit",cache_hit);
  cJSON_AddBoolToObject(result,"precompiledHeaders",e.pch_used);
  cJSON_AddStringToObject(result,"buildLog",cache_hit?cached_log:e.output?e.output:"");cJSON_AddNumberToObject(result,"compileMs",now_ms()-start);
  if(!err){
    // Destroy the compiler sandbox. Each program gets a fresh FS containing only its project.
    cleanup(&e);e.deadline=now_ms()+30000;e.output=calloc(OUTPUT_LIMIT+1,1);e.input=string(req,"stdin","");e.input_len=strlen(e.input);phase="run";
    if(!e.output)err="Out of memory";
    if(!err)err=init_fs(&e,dir);if(!err)err=project_files(&e,req,string(req,"outputFile",""));
    const char *input_file=string(req,"inputFile","");if(!err&&*input_file){if(!safe_path(input_file)||strchr(input_file,'/'))err="Invalid INP filename";else err=add_file(&e,input_file,e.input,e.input_len);}
    if(!err){const char *args[]={"program"};run_start=now_ms();e.deadline=run_start+number(req,"timeLimitMs",3000,100,30000);err=execute(&e,program,program_size,args,1,128*1024*1024);run_ms=now_ms()-run_start;}
    cJSON *outputs=cJSON_AddObjectToObject(result,"files");const char *out=string(req,"outputFile","");
    if(!err&&*out){if(!safe_path(out)||strchr(out,'/'))err="Invalid OUT filename";else{uint8_t *data=NULL;size_t size=0;const char *readerr=read_file(&e,out,&data,&size);if(!readerr&&size<=FILE_LIMIT)cJSON_AddStringToObject(outputs,out,(char*)data);else if(!readerr)err="OUT file exceeds 2 MiB";else if(!strcmp(readerr,"File not found"))cJSON_AddStringToObject(result,"outputNote","Không tạo file OUT; kết quả lấy từ stdout (cout/printf).");else err=readerr;free(data);}}
  }
  cJSON_AddStringToObject(result,"stdout",strcmp(phase,"run")==0&&e.output?e.output:"");
  cJSON_AddStringToObject(result,"phase",phase);cJSON_AddStringToObject(result,"error",err?err:"");
  cJSON_AddNumberToObject(result,"exitCode",err?-1:e.exit_code);cJSON_AddNumberToObject(result,"runMs",run_ms);
  cJSON_AddStringToObject(result,"engine","Clang 8 / wasm3 interpreter (no JIT)");
  free(program);cleanup(&e);active_engine=NULL;cJSON_Delete(req);char *response=cJSON_PrintUnformatted(result);cJSON_Delete(result);atomic_store(&busy,0);return response;
}
