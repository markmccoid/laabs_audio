#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <objc/runtime.h>

////////////////////////////////////////////////////////////
// CarPlay scene-cast crash guard
//
// React core enumerates UIApplication.connectedScenes blind-cast to
// UIWindowScene in several places (-[RCTAppearance setColorScheme:],
// RCTDevMenu's shake handler, …) and calls -windows on each scene. A CarPlay
// CPTemplateApplicationScene does not implement -windows, so any of those
// paths aborts with doesNotRecognizeSelector while the car is connected —
// e.g. opening the phone app after a CarPlay cold launch crashed the moment
// JS applied the color scheme. React core ships as a PREBUILT xcframework in
// this app (Pods/React-Core-prebuilt), so the patch-package source fix in
// patches/react-native+0.85.3.patch is never compiled; this runtime shim is
// the operative guard. It only installs when the method is missing, so a
// future CarPlay SDK that adds -windows wins.
////////////////////////////////////////////////////////////

static NSArray *AudioProCarPlaySceneWindowsShim(id self, SEL _cmd)
{
  return @[];
}

static id AudioProCarPlaySceneKeyWindowShim(id self, SEL _cmd)
{
  return nil;
}

__attribute__((constructor)) static void AudioProInstallCarPlaySceneShims(void)
{
  Class sceneClass = objc_getClass("CPTemplateApplicationScene");
  if (sceneClass == Nil) {
    return;
  }
  if (![sceneClass instancesRespondToSelector:@selector(windows)]) {
    class_addMethod(sceneClass, @selector(windows), (IMP)AudioProCarPlaySceneWindowsShim, "@@:");
  }
  if (![sceneClass instancesRespondToSelector:NSSelectorFromString(@"keyWindow")]) {
    class_addMethod(
        sceneClass, NSSelectorFromString(@"keyWindow"), (IMP)AudioProCarPlaySceneKeyWindowShim, "@@:");
  }
}

@interface RCT_EXTERN_MODULE(AudioPro, RCTEventEmitter)

RCT_EXTERN_METHOD(play:(NSDictionary *)track withOptions:(NSDictionary *)options)
RCT_EXTERN_METHOD(updateConfiguration:(NSDictionary *)options)
RCT_EXTERN_METHOD(pause)
RCT_EXTERN_METHOD(resume)
RCT_EXTERN_METHOD(stop)
RCT_EXTERN_METHOD(seekTo:(double)position)
RCT_EXTERN_METHOD(seekForward:(double)amount)
RCT_EXTERN_METHOD(seekBack:(double)amount)
RCT_EXTERN_METHOD(setPlaybackSpeed:(double)speed)
RCT_EXTERN_METHOD(setVolume:(double)volume)
RCT_EXTERN_METHOD(clear)

RCT_EXTERN_METHOD(ambientPlay:(NSDictionary *)options)
RCT_EXTERN_METHOD(ambientStop)
RCT_EXTERN_METHOD(ambientSetVolume:(double)volume)
RCT_EXTERN_METHOD(ambientPause)
RCT_EXTERN_METHOD(ambientResume)
RCT_EXTERN_METHOD(ambientSeekTo:(double)positionMs)

RCT_EXTERN_METHOD(carPlaySetShelves:(NSArray *)shelves)
RCT_EXTERN_METHOD(carPlaySetChapters:(NSArray *)chapters)
RCT_EXTERN_METHOD(carPlaySetRates:(NSArray *)rates)
RCT_EXTERN_METHOD(carPlayLog:(NSString *)message)
RCT_EXTERN_METHOD(carPlayShowAlert:(NSString *)message)
RCT_EXTERN_METHOD(carPlayGetStatus:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
