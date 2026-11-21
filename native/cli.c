#include "pocket.h"
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "Usage: pocket-cli TOOLCHAIN REQUEST.json\n"); return 2; }
  FILE *f = fopen(argv[2], "rb"); if (!f) return 2;
  fseek(f, 0, SEEK_END); long size = ftell(f); rewind(f);
  if (size < 0 || size > 20000000) { fclose(f); return 2; }
  char *request = calloc((size_t)size + 1, 1);
  if (!request) { fclose(f); return 2; }
  fread(request, 1, size, f); fclose(f);
  char *result = pocket_run(argv[1], request);
  if (result) { puts(result); pocket_free(result); }
  free(request); return result ? 0 : 1;
}
