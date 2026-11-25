import ApplicationServices
import Foundation

let app = AXUIElementCreateApplication(Int32(CommandLine.arguments[1])!)
guard AXIsProcessTrusted() else { print("UI driver has no accessibility permission"); exit(2) }
func value(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var out: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, name as CFString, &out) == .success else { return nil }
    return out
}
func walk(_ root: AXUIElement, _ test: (AXUIElement) -> Bool, _ depth: Int = 0) -> AXUIElement? {
    if test(root) { return root }
    guard depth < 16 else { return nil }
    for child in value(root, "AXChildren") as? [AXUIElement] ?? [] {
        if let match = walk(child, test, depth+1) { return match }
    }
    return nil
}
func press(_ label: String, role: String, root: () -> AXUIElement) {
    for _ in 0..<24 {
        if let element = walk(root(), { e in
            let names = ["AXTitle","AXDescription","AXValue"].compactMap { value(e,$0) as? String }
            return (value(e,"AXRole") as? String) == role && (label.isEmpty || names.contains(where: { $0.contains(label) }))
        }), AXUIElementPerformAction(element,"AXPress" as CFString) == .success {
            print("Pressed", role, label)
            return
        }
        Thread.sleep(forTimeInterval: 0.4)
    }
    print("Missing control:",role,label)
    exit(3)
}
func tray() -> AXUIElement { if let e = value(app,"AXExtrasMenuBar") { return e as! AXUIElement }; return app }
press("",role:"AXMenuBarItem",root:tray)
press("翻开手账",role:"AXMenuItem",root:tray)
press("设置",role:"AXButton",root:{app})
press("发现新内容",role:"AXButton",root:{app})
