import ApplicationServices
import AppKit
import Foundation
import Vision

let app = AXUIElementCreateApplication(Int32(CommandLine.arguments[1])!)
guard AXIsProcessTrusted() else { exit(2) }
func value(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var out: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, name as CFString, &out) == .success else { return nil }
    return out
}
func walk(_ root: AXUIElement, _ test: (AXUIElement) -> Bool, _ depth: Int = 0) -> AXUIElement? {
    if test(root) { return root }
    guard depth < 18 else { return nil }
    for child in value(root, "AXChildren") as? [AXUIElement] ?? [] {
        if let match = walk(child, test, depth+1) { return match }
    }
    return nil
}
func click(_ pos: CGPoint) {
    for kind in [CGEventType.mouseMoved,.leftMouseDown,.leftMouseUp] {
        CGEvent(mouseEventSource:nil,mouseType:kind,mouseCursorPosition:pos,mouseButton:.left)?.post(tap:.cghidEventTap)
        Thread.sleep(forTimeInterval:0.08)
    }
}
func screen(_ label: String) -> CGPoint? {
    let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("mac-qa-screen.png")
    let proc=Process()
    proc.executableURL=URL(fileURLWithPath:"/usr/sbin/screencapture")
    proc.arguments=["-x","-m",file.path]
    try? proc.run()
    proc.waitUntilExit()
    let req=VNRecognizeTextRequest()
    req.recognitionLanguages=["zh-Hans","en-US"]
    req.recognitionLevel = .accurate
    try? VNImageRequestHandler(url:file).perform([req])
    let results=req.results ?? []
    print("Looking for",label,"visible text:",results.compactMap{$0.topCandidates(1).first?.string}.joined(separator:" / "))
    let display=CGDisplayBounds(CGMainDisplayID())
    for obs in results {
        let str=obs.topCandidates(1).first?.string.replacingOccurrences(of:" ",with:"") ?? ""
        if str.contains(label) {
            return CGPoint(x:obs.boundingBox.midX*display.width,y:(1-obs.boundingBox.midY)*display.height)
        }
    }
    return nil
}
func press(_ label: String) {
    for _ in 0..<5 {
        if let e=walk(app,{ item in
            (value(item,"AXRole") as? String)=="AXButton" && ["AXTitle","AXValue","AXDescription"].contains { (value(item,$0) as? String)?.contains(label)==true }
        }), AXUIElementPerformAction(e,"AXPress" as CFString) == .success { print("AX pressed",label); return }
        if let point=screen(label){click(point); print("Clicked",label);return}
        Thread.sleep(forTimeInterval:1)
    }
    exit(3)
}
AXUIElementSetAttributeValue(app,"AXManualAccessibility" as CFString,kCFBooleanTrue)
guard let bar=value(app,"AXExtrasMenuBar"), let item=walk(bar as! AXUIElement,{(value($0,"AXRole") as? String)=="AXMenuBarItem"}), let raw=value(item,"AXPosition"), let dims=value(item,"AXSize") else {exit(4)}
var pos=CGPoint.zero, size=CGSize.zero
AXValueGetValue(raw as! AXValue,.cgPoint,&pos)
AXValueGetValue(dims as! AXValue,.cgSize,&size)
click(CGPoint(x:pos.x+size.width/2,y:pos.y+size.height/2))
Thread.sleep(forTimeInterval:0.7)
press("手账")
Thread.sleep(forTimeInterval:2)
press("设置")
Thread.sleep(forTimeInterval:0.8)
press("发现新内容")
