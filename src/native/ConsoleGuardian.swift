// SPDX-License-Identifier: MIT
// Console Mode escape hatch. Watches connected game controllers even while an
// emulator is frontmost, and prints "exit-hold" when Create/Share + Options/Menu
// stay held for the requested time. It only reports; the manager decides what,
// if anything, to stop. It exits when its standard input closes (manager gone).
//
// Usage: console-guardian --hold-seconds <1-30>
import Foundation
import GameController

let args = CommandLine.arguments
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
