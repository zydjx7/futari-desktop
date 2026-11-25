#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <ApplicationServices/ApplicationServices.h>
#import <math.h>
#import <stdbool.h>

typedef struct { double frame[4], visible[4], primaryTop, scale; } FTScreen;
static void (*notifyRust)(int,double,double);
static __weak NSWindow *stage;
static NSScreen *screen;
static NSPanel *hitPanel, *propPanel;
static NSTimer *finderTimer;
static unsigned locks;
static BOOL interactive, desktopActive = YES;
static void mainSync(dispatch_block_t block) {
    if (NSThread.isMainThread) block(); else dispatch_sync(dispatch_get_main_queue(),block);
}
static NSScreen *target(void) {
    for (NSScreen *s in NSScreen.screens)
        if ([s.deviceDescription[@"NSScreenNumber"] isEqual:screen.deviceDescription[@"NSScreenNumber"]]) return s;
    return NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}
static void putRect(double out[4], NSRect r) {
    out[0]=r.origin.x; out[1]=r.origin.y; out[2]=r.size.width; out[3]=r.size.height;
}
void ft_screen(intptr_t window, FTScreen *out) {
    mainSync(^{
        NSScreen *s=target();
        putRect(out->frame,s.frame); putRect(out->visible,s.visibleFrame);
        out->primaryTop=NSMaxY(NSScreen.screens.firstObject.frame);
        out->scale=s.backingScaleFactor ?: 1;
    });
}
void ft_cursor(double *x,double *y) {
    mainSync(^{NSPoint p=NSEvent.mouseLocation; *x=p.x; *y=p.y;});
}
static void pointerEvent(int code) {
    NSPoint p=NSEvent.mouseLocation;
    notifyRust(code,p.x,p.y);
}
@interface FTHitView : NSView {
    BOOL dragging, pressed;
    NSPoint start;
}
@property(nonatomic,strong) NSData *runs;
@property(nonatomic,strong) NSTimer *timer;
@property(nonatomic,weak) NSWindow *surface;
@property(nonatomic) int offsetX, offsetY;
- (void)refreshHit;
- (void)clearHit;
@end
@implementation FTHitView
- (BOOL)isFlipped {return YES;}
- (void)drawRect:(NSRect)dirty {
    [NSColor.clearColor setFill];
    NSRectFillUsingOperation(dirty,NSCompositingOperationCopy);
    const int (*r)[4]=self.runs.bytes;
    CGFloat scale=self.surface.backingScaleFactor ?: 1;
    [[NSColor colorWithWhite:0 alpha:.01] setFill];
    for(NSUInteger i=0;i<self.runs.length/sizeof(*r);i++){
        NSRect rect=NSMakeRect(r[i][0]/scale,r[i][1]/scale,(r[i][2]-r[i][0])/scale,(r[i][3]-r[i][1])/scale);
        NSRectFill(rect);
    }
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event {
    if(event.clickCount==2){pressed=NO;pointerEvent(5);return;}
    pressed=YES;dragging=NO;start=NSEvent.mouseLocation;
}
- (void)mouseDragged:(NSEvent *)event {
    NSPoint now=NSEvent.mouseLocation;
    if(!pressed) return;
    if(!dragging && hypot(now.x-start.x,now.y-start.y)>4) {
        dragging=YES;notifyRust(6,start.x,start.y);
    }
    if(dragging)pointerEvent(7);
}
- (void)mouseUp:(NSEvent *)event {
    if(pressed && dragging)pointerEvent(7);
    if(pressed)pointerEvent(dragging ? 8 : 4);
    pressed=NO;dragging=NO;
}
- (void)rightMouseDown:(NSEvent *)event {pointerEvent(5);}
- (void)refreshHit {
    BOOL hit = pressed;
    if (self.surface.visible && self.runs.length && !hit) {
        NSPoint p=[self.surface convertPointFromScreen:NSEvent.mouseLocation];
        CGFloat s=self.surface.backingScaleFactor;
        int x=floor(p.x*s)-self.offsetX, y=floor((self.surface.frame.size.height-p.y)*s)-self.offsetY;
        const int (*r)[4]=self.runs.bytes;
        for(NSUInteger i=0;i<self.runs.length/sizeof(*r);i++)
            if(x>=r[i][0] && x<r[i][2] && y>=r[i][1] && y<r[i][3]){hit=YES;break;}
    }
    self.window.ignoresMouseEvents=!hit;
}
- (void)clearHit {
    if(dragging)pointerEvent(8);
    pressed=dragging=NO;
    [self.timer invalidate];self.timer=nil;self.runs=nil;
    self.window.ignoresMouseEvents=YES;[self.window orderOut:nil];
}
@end
@interface FTHitPanel : NSPanel @end
@implementation FTHitPanel
- (BOOL)canBecomeKeyWindow {return NO;}
- (BOOL)canBecomeMainWindow {return NO;}
@end
static void hideHit(void){[(FTHitView *)hitPanel.contentView clearHit];}
void ft_hide_hit(void){mainSync(^{hideHit();});}
void ft_shape(intptr_t window,int x,int y,const int (*rows)[4],size_t count,bool furniture) {
    mainSync(^{
        NSWindow *surface=(__bridge NSWindow *)(void *)window;
        NSPanel *panel=furniture ? propPanel : hitPanel;
        FTHitView *v=(FTHitView *)panel.contentView;
        if(!surface.visible || interactive || !count){[v clearHit];return;}
        v.surface=surface;v.offsetX=x;v.offsetY=y;
        v.runs=[NSData dataWithBytes:rows length:count*sizeof(*rows)];
        int width=0,height=0;
        for(size_t i=0;i<count;i++){width=MAX(width,rows[i][2]);height=MAX(height,rows[i][3]);}
        CGFloat s=surface.backingScaleFactor;
        [panel setFrame:NSMakeRect(NSMinX(surface.frame)+x/s,NSMaxY(surface.frame)-(y+height)/s,width/s,height/s) display:NO];
        [v setNeedsDisplay:YES];
        panel.level=surface.level;
        [panel orderWindow:NSWindowAbove relativeTo:surface.windowNumber];
        if(!v.timer){
            v.timer=[NSTimer timerWithTimeInterval:1./60 repeats:YES block:^(NSTimer *t){[v refreshHit];}];
            [NSRunLoop.mainRunLoop addTimer:v.timer forMode:NSRunLoopCommonModes];
        }
        [v refreshHit];
    });
}
static BOOL external(void) {
    NSRunningApplication *front=NSWorkspace.sharedWorkspace.frontmostApplication;
    return front && front.processIdentifier!=NSProcessInfo.processInfo.processIdentifier;
}
bool ft_external(void){__block BOOL result;mainSync(^{result=external();});return result;}
bool ft_desktop(void) {
    __block BOOL result;
    mainSync(^{
        NSRunningApplication *front=NSWorkspace.sharedWorkspace.frontmostApplication;
        if(external()){
            desktopActive=[front.bundleIdentifier isEqualToString:@"com.apple.finder"];
            if(desktopActive){
                // Window metadata only. No pixels, window titles or screen capture.
                NSArray *windows=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,kCGNullWindowID));
                for(NSDictionary *w in windows){
                    if([w[(__bridge NSString *)kCGWindowOwnerPID] intValue]==front.processIdentifier && [w[(__bridge NSString *)kCGWindowLayer] intValue]==0){
                        CGRect bounds;
                        NSDictionary *box=w[(__bridge NSString *)kCGWindowBounds];
                        NSRect f=target().frame;
                        CGRect display=CGRectMake(f.origin.x,NSMaxY(NSScreen.screens.firstObject.frame)-NSMaxY(f),f.size.width,f.size.height);
                        if(box && CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)box,&bounds) && CGRectIntersectsRect(display,bounds)){
                            desktopActive=NO;break;
                        }
                    }
                }
            }
        }
        result=desktopActive;
    });
    return result;
}
// Observe Finder's original event while leaving the stage click-through.
void ft_ground(bool enabled) {
    static id monitor;
    mainSync(^{
        if (!enabled) {
            if (monitor) [NSEvent removeMonitor:monitor];
            monitor=nil;
            return;
        }
        if (monitor) return;
        __block BOOL candidate=NO;
        monitor=[NSEvent addGlobalMonitorForEventsMatchingMask:(NSEventMaskLeftMouseDown |
            NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp) handler:^(NSEvent *e) {
            if (e.type==NSEventTypeLeftMouseDown) {
                candidate=e.clickCount==1 && !(e.modifierFlags & (NSEventModifierFlagOption |
                    NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagShift));
                return;
            }
            if (e.type==NSEventTypeLeftMouseDragged) { candidate=NO; return; }
            if (!candidate || !e.CGEvent) return;
            candidate=NO;
            CGWindowID wid=(CGWindowID)CGEventGetIntegerValueField(e.CGEvent,kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent);
            NSArray *info=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow,wid));
            NSDictionary *w=info.firstObject;
            if (!w || [w[(__bridge NSString *)kCGWindowLayer] intValue]!=CGWindowLevelForKey(kCGDesktopIconWindowLevelKey)) return;
            pid_t pid=[w[(__bridge NSString *)kCGWindowOwnerPID] intValue];
            if (![[NSRunningApplication runningApplicationWithProcessIdentifier:pid].bundleIdentifier isEqualToString:@"com.apple.finder"]) return;
            CGPoint at=CGEventGetLocation(e.CGEvent);
            NSPoint p=NSMakePoint(at.x,NSMaxY(NSScreen.screens.firstObject.frame)-at.y);
            if (!NSPointInRect(p,target().visibleFrame)) return;
            if (AXIsProcessTrusted()) {
                AXUIElementRef finder=AXUIElementCreateApplication(pid), hit=NULL;
                AXUIElementCopyElementAtPosition(finder,at.x,at.y,&hit);
                CFRelease(finder);
                if (hit) {
                    CFTypeRef role=NULL;
                    AXUIElementCopyAttributeValue(hit,kAXRoleAttribute,&role);
                    CFRelease(hit);
                    BOOL icon=role && (CFEqual(role,CFSTR("AXImage")) || CFEqual(role,CFSTR("AXButton"))
                        || CFEqual(role,CFSTR("AXTextField")) || CFEqual(role,CFSTR("AXStaticText")));
                    if (role) CFRelease(role);
                    if (icon) return;
                }
            }
            notifyRust(11,p.x,p.y);
        }];
    });
}
void ft_wallpaper(intptr_t window,bool visible,bool above) {
    mainSync(^{
        NSWindow *w=(__bridge NSWindow *)(void *)window;
        if(!visible){[w orderOut:nil];return;}
        w.ignoresMouseEvents=YES;w.hasShadow=NO;
        w.collectionBehavior=NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorStationary|NSWindowCollectionBehaviorIgnoresCycle;
        w.level=CGWindowLevelForKey(above ? kCGDesktopIconWindowLevelKey : kCGDesktopWindowLevelKey)+1;
        [w setFrame:target().frame display:YES];[w orderFrontRegardless];
    });
}
void ft_furnishings(intptr_t window,bool visible) {
    mainSync(^{
        NSWindow *w=(__bridge NSWindow *)(void *)window;
        if (!visible) { [(FTHitView *)propPanel.contentView clearHit]; [w orderOut:nil]; return; }
        w.opaque=NO; w.backgroundColor=NSColor.clearColor;
        ft_wallpaper(window,true,true);
        if(propPanel.visible) [propPanel orderWindow:NSWindowAbove relativeTo:w.windowNumber];
    });
}
void ft_present(intptr_t window,bool visible,bool active,bool top,bool desktop) {
    mainSync(^{
        NSWindow *w=(__bridge NSWindow *)(void *)window;
        stage=w;interactive=active;
        if(desktop && !finderTimer){
            finderTimer=[NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer){
                if(!locks && [NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier isEqualToString:@"com.apple.finder"]){
                    BOOL previous=desktopActive;
                    if(ft_desktop()!=previous)notifyRust(2,0,0);
                }
            }];
            finderTimer.tolerance=.2;
        } else if(!desktop){[finderTimer invalidate];finderTimer=nil;}
        hideHit();
        if(!visible){[w orderOut:nil];return;}
        w.opaque=NO;w.backgroundColor=NSColor.clearColor;w.hasShadow=NO;
        w.ignoresMouseEvents=!active;
        w.collectionBehavior=NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary|NSWindowCollectionBehaviorStationary|NSWindowCollectionBehaviorIgnoresCycle;
        w.level=top ? NSFloatingWindowLevel : CGWindowLevelForKey(kCGDesktopIconWindowLevelKey)+2;
        [w setFrame:target().frame display:YES];
        if(active && (top || ft_desktop())){[NSApp activateIgnoringOtherApps:YES];[w makeKeyAndOrderFront:nil];}
        else [w orderFrontRegardless];
    });
}
void ft_card(intptr_t window,double x,double y){
    mainSync(^{
        NSWindow *w=(__bridge NSWindow *)(void *)window;
        NSRect f=w.frame, work=target().visibleFrame;
        f.origin.x=fmax(NSMinX(work),fmin(x-f.size.width/2,NSMaxX(work)-f.size.width));
        f.origin.y=fmax(NSMinY(work),fmin(y+8,NSMaxY(work)-f.size.height));
        w.level=NSFloatingWindowLevel+1;
        w.collectionBehavior=NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary;
        [w setFrame:f display:YES];[NSApp activateIgnoringOtherApps:YES];[w makeKeyAndOrderFront:nil];
    });
}
void ft_hide(intptr_t w){mainSync(^{[(__bridge NSWindow *)(void *)w orderOut:nil];});}
bool ft_folder(const char *path){
    __block BOOL result;
    mainSync(^{
        NSURL *url=[NSURL fileURLWithFileSystemRepresentation:path isDirectory:YES relativeToURL:nil];
        result=[NSWorkspace.sharedWorkspace openURL:url];
    });
    return result;
}
static void observe(NSNotificationCenter *center,NSString *name,void (^action)(void)){
    [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *n){action();}];
}
static void lockReason(unsigned bit,BOOL on) {
    unsigned previous=locks;
    if(on)locks|=bit;else locks&=~bit;
    if(!!previous!=!!locks)notifyRust(9,locks!=0,0);
}
static OSStatus shortcutPressed(EventHandlerCallRef next, EventRef event, void *context) {
    EventHotKeyID key;
    if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, NULL,
                          sizeof(key), NULL, &key) != noErr || key.signature != 'Futa' || key.id > 1)
        return eventNotHandledErr;
    notifyRust(key.id, 0, 0);
    return noErr;
}

static NSPanel *makeHitPanel(void){
    NSPanel *panel=[[FTHitPanel alloc] initWithContentRect:NSZeroRect styleMask:NSWindowStyleMaskBorderless|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    panel.contentView=[FTHitView new];panel.opaque=NO;
    // An entirely clear native window is omitted from WindowServer hit testing.
    panel.backgroundColor=NSColor.clearColor;
    panel.hasShadow=NO;panel.hidesOnDeactivate=NO;panel.ignoresMouseEvents=YES;
    panel.collectionBehavior=NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary|NSWindowCollectionBehaviorIgnoresCycle;
    return panel;
}
void ft_install(void (*callback)(int,double,double), int registered[2]){
    notifyRust=callback;
    // Tauri sets the Accessory policy during setup, before its launch callbacks.
    screen=NSScreen.mainScreen;
    for(NSScreen *s in NSScreen.screens)if(NSPointInRect(NSEvent.mouseLocation,s.frame)){screen=s;break;}
    hitPanel=makeHitPanel();propPanel=makeHitPanel();
    EventTypeSpec pressed = { kEventClassKeyboard, kEventHotKeyPressed };
    if (InstallApplicationEventHandler(shortcutPressed, 1, &pressed, NULL, NULL) == noErr) {
        const UInt32 codes[] = { kVK_ANSI_J, kVK_ANSI_K };
        static EventHotKeyRef refs[2];
        for (UInt32 i = 0; i < 2; i++) {
            EventHotKeyID key = { 'Futa', i };
            registered[i] = RegisterEventHotKey(codes[i], optionKey,
                key, GetApplicationEventTarget(), kEventHotKeyExclusive, &refs[i]) == noErr;
        }
    }
    NSNotificationCenter *ws=NSWorkspace.sharedWorkspace.notificationCenter;
    observe(ws,NSWorkspaceDidActivateApplicationNotification,^{callback(2,0,0);});
    observe(ws,NSWorkspaceActiveSpaceDidChangeNotification,^{callback(2,0,0);});
    observe(NSNotificationCenter.defaultCenter,NSWindowDidChangeOcclusionStateNotification,^{callback(2,0,0);});
    observe(NSNotificationCenter.defaultCenter,NSApplicationDidChangeScreenParametersNotification,^{callback(3,0,0);});
    observe(ws,NSWorkspaceWillSleepNotification,^{lockReason(1,YES);});
    observe(ws,NSWorkspaceDidWakeNotification,^{lockReason(1,NO);});
    observe(ws,NSWorkspaceScreensDidSleepNotification,^{lockReason(2,YES);});
    observe(ws,NSWorkspaceScreensDidWakeNotification,^{lockReason(2,NO);});
    observe(ws,NSWorkspaceSessionDidResignActiveNotification,^{lockReason(4,YES);});
    observe(ws,NSWorkspaceSessionDidBecomeActiveNotification,^{lockReason(4,NO);});
    NSDistributedNotificationCenter *dc=NSDistributedNotificationCenter.defaultCenter;
    observe(dc,@"com.apple.screenIsLocked",^{lockReason(8,YES);});
    observe(dc,@"com.apple.screenIsUnlocked",^{lockReason(8,NO);});
    [NSTimer scheduledTimerWithTimeInterval:60 repeats:YES block:^(NSTimer *t){callback(10,0,0);}];
}
