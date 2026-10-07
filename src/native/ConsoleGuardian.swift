// SPDX-License-Identifier: MIT
// Console Mode escape hatch. Watches connected game controllers even while an
// emulator is frontmost, and prints "exit-hold" when Create/Share + Options/Menu
// stay held for the requested time. It only reports; the manager decides what,
// if anything, to stop. It exits when its standard input closes (manager gone).
//
// Usage: console-guardian --hold-seconds <1-30>
//        console-guardian --list   (connected controllers as JSON, then exit)
import Foundation
import GameController

let args = CommandLine.arguments

/// One-shot inventory for the Controllers page: capabilities as JSON, then exit.
func listControllers() -> Never {
    // Discovery is asynchronous (about 1-2 s for an already-connected pad):
    // wait until controllers appear, up to a bounded deadline.
    let deadline = Date(timeIntervalSinceNow: 2.5)
    while GCController.controllers().isEmpty && Date() < deadline {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
    }
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.2))
    let list: [[String: Any]] = GCController.controllers().prefix(16).map { controller in
        var entry: [String: Any] = [
            "name": String((controller.vendorName ?? "Controller").prefix(128)),
            "category": String(controller.productCategory.prefix(64)),
            "extended": controller.extendedGamepad != nil,
            "haptics": controller.haptics != nil,
            "motion": controller.motion != nil,
            "light": controller.light != nil,
        ]
        if let battery = controller.battery {
            entry["battery"] = Int((battery.batteryLevel * 100).rounded())
            entry["charging"] = battery.batteryState == .charging
            entry["full"] = battery.batteryState == .full
        }
        return entry
    }
    let data = (try? JSONSerialization.data(withJSONObject: list)) ?? Data("[]".utf8)
    FileHandle.standardOutput.write(data)
    exit(0)
}
if args.count == 2, args[1] == "--list" { listControllers() }

guard args.count == 3, args[1] == "--hold-seconds",
    let seconds = Double(args[2]), seconds >= 1, seconds <= 30 else {
    fputs("Usage: console-guardian --hold-seconds <1-30>\n", stderr)
    exit(1)
}

// Without this, controller input is delivered only while this process is frontmost.
GCController.shouldMonitorBackgroundEvents = true

var heldSince: Date?
var reported = false

/// Create/Share is buttonOptions; Options/Menu is buttonMenu (PlayStation layout).
func comboHeld() -> Bool {
    GCController.controllers().contains { controller in
        guard let pad = controller.extendedGamepad else { return false }
        return (pad.buttonOptions?.isPressed ?? false) && pad.buttonMenu.isPressed
    }
}

// Exit when the manager closes our input pipe, so the helper never outlives it.
FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty { exit(0) }
}

GCController.startWirelessControllerDiscovery(completionHandler: nil)
print("ready")
fflush(stdout)

Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
    if comboHeld() {
        let start = heldSince ?? Date()
        heldSince = start
        if !reported && Date().timeIntervalSince(start) >= seconds {
            reported = true
            print("exit-hold")
            fflush(stdout)
        }
    } else {
        // Require a full release before another report.
        heldSince = nil
        reported = false
    }
}
RunLoop.main.run()
