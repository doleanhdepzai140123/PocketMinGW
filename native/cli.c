#include "pocket.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int pocket_prepare_pch(const char *dir,const char *destination);
int main(int argc, char **argv) {
  if(argc==4 && !strcmp(argv[2],"--prepare-pch"))return pocket_prepare_pch(argv[1],argv[3]);
  if (argc < 3) { fprintf(stderr, "Usage: pocket-cli TOOLCHAIN REQUEST.json [REQUEST.json ...]\n"); return 2; }
  for(int i=2;i<argc;i++){
  FILE *f = fopen(argv[i], "rb"); if (!f) return 2;
  fseek(f, 0, SEEK_END); long size = ftell(f); rewind(f);
  if (size < 0 || size > 20000000) { fclose(f); return 2; }
  char *request = calloc((size_t)size + 1, 1);
  if (!request) { fclose(f); return 2; }
  fread(request, 1, size, f); fclose(f);
  char *result = pocket_run(argv[1], request);
  if (result) { puts(result); pocket_free(result); }
  free(request); if(!result)return 1;
  }return 0;
}
