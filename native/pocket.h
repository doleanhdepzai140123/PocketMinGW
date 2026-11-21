#ifndef POCKET_H
#define POCKET_H
#ifdef __cplusplus
extern "C" {
#endif
// Returns malloc-owned UTF-8 JSON. All guest files live in an isolated memory FS.
char *pocket_run(const char *toolchain_directory, const char *request_json);
void pocket_cancel(void);
void pocket_free(void *pointer);
#ifdef __cplusplus
}
#endif
#endif
