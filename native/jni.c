#include <jni.h>
#include "pocket.h"
#include <stdlib.h>
#include <string.h>
JNIEXPORT jbyteArray JNICALL Java_com_pocketmingw_ide_PocketRuntimePlugin_executeNative(JNIEnv *env,jobject self,jbyteArray dir,jbyteArray req) {
  jsize dl=(*env)->GetArrayLength(env,dir),rl=(*env)->GetArrayLength(env,req);
  char *d=calloc(dl+1,1),*r=calloc(rl+1,1);if(!d||!r){free(d);free(r);return NULL;}
  (*env)->GetByteArrayRegion(env,dir,0,dl,(jbyte*)d);(*env)->GetByteArrayRegion(env,req,0,rl,(jbyte*)r);
  char *response=pocket_run(d,r);free(d);free(r);if(!response)return NULL;
  jsize len=(jsize)strlen(response);jbyteArray result=(*env)->NewByteArray(env,len);
  if(result)(*env)->SetByteArrayRegion(env,result,0,len,(const jbyte*)response);pocket_free(response);return result;
}
JNIEXPORT void JNICALL Java_com_pocketmingw_ide_PocketRuntimePlugin_cancelNative(JNIEnv *env,jobject self) { pocket_cancel(); }
